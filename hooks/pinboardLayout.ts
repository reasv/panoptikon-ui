"use client"
import type { LayoutItem } from "react-grid-layout";
import { fetchClient } from "@/lib/api";
import { components } from "@/lib/panoptikon";
import { RefObject, useEffect, useRef } from "react";
import { CropRect, PinLock, computeAutoCrop } from "@/lib/pinboardCrop";
import { GridParams, minPinUnits, rowStep } from "@/lib/pinboardGrid";
import {
    ArrangedItem,
    GridRect,
    PackItem,
    apportionToTotal,
    evictFromBox,
    groupRowsByOverlap,
    growToFill,
    growToFillInBox,
    justifyRows,
    packMosaic,
    packRegion,
    packRegionInBox,
    packRows,
    packRowsAroundObstacles,
} from "@/lib/pinboardPack";

// Session-wide reroll counter: every fill-type action renders the variant
// this counter selects, so a rerolled composition is what later auto-fills
// continue from instead of snapping back to variant 0. Module-level on
// purpose — the hook is instantiated once per pin menu plus once for the
// board, and they must agree.
let mosaicVariant = 0

// Layout keys are `${recordIndex}-${sha256Prefix}` (the same image can be
// pinned more than once); the sha256 part is what the API understands
function keyToSha256(key: string): string {
    return key.split("-")[1]
}

// Shared pinboard layout/auto-crop actions, extracted from the context menu
// so other callers (e.g. the PinBoard itself) can invoke the same actions.
// One instance exists per caller; the cached build data is invalidated
// whenever its inputs change, so instances can't act on stale measurements.
export function usePinboardLayoutActions({
    layout,
    crops,
    autoCrops,
    locks = {},
    highWater = 0,
    layoutAutoCrop = false,
    selectionAutoCrop = true,
    dbs,
    grid,
    pinboardRef,
    onLayoutChange,
}: {
    layout: LayoutItem[],
    // Manual crops (the layout-math base) and derived fit-to-cell auto crops
    crops: Record<string, CropRect | null>,
    autoCrops: Record<string, CropRect | null>,
    // Per-item layout locks: "anchor" (position+size fixed, an obstacle
    // every fill packs around) or "size" (treated the same by layout
    // actions; only manual drags distinguish them)
    locks?: Record<string, PinLock>,
    // The board's layout-height ratchet in grid rows (see pinboardGrid.ts)
    highWater?: number,
    // The standing auto-crop settings, one per verb class: layoutAutoCrop
    // (the pbc URL flag) governs the board-layout family — fills, reroll,
    // refit, reflow, rows, justify, grow — and selectionAutoCrop (the psc
    // flag, toggled from the selection toolbar) governs the multi-select
    // verbs, arrange and swap. See verbAutoCrops for what they do.
    layoutAutoCrop?: boolean,
    selectionAutoCrop?: boolean,
    dbs: {
        index_db: string | null
        user_data_db: string | null
    },
    grid: GridParams,
    pinboardRef: RefObject<HTMLDivElement | null>,
    // autoCropOverrides ride along with the layout so both land in one
    // record write (one URL update, one history entry); newHighWater, when
    // given, updates the board's ratchet in that same write
    onLayoutChange: (
        layout: LayoutItem[],
        autoCropOverrides?: Record<string, CropRect | null>,
        newHighWater?: number,
    ) => void,
}) {
    const layoutBuildData = useRef<LayoutBuildData | null>(null)
    useEffect(() => {
        layoutBuildData.current = null
    }, [layout, crops, dbs, grid])

    // Cached build data, or null when the container can't be measured (in
    // which case layout actions no-op rather than destroy the arrangement)
    async function ensureBuildData(): Promise<LayoutBuildData | null> {
        if (!layoutBuildData.current) {
            layoutBuildData.current = await getLayoutBuildData({ layout, crops, dbs, grid, pinboardRef })
        }
        return layoutBuildData.current
    }

    const isLocked = (key: string) => !!locks[key]
    const isAnchored = (key: string) => locks[key] === "anchor"
    const isSizeLocked = (key: string) => locks[key] === "size"
    const hasLocks = layout.some(l => isLocked(l.i))
    const hasAnchors = layout.some(l => isAnchored(l.i))

    async function changeLayout(itemsPerRow: number, restrictToVisible = false) {
        // Rebuilds the whole board row by row from scratch; it cannot hold
        // a locked item in place, so with locks present it must not run
        if (hasLocks) return
        const buildData = await ensureBuildData()
        if (!buildData) return
        const newLayout = buildLayout(buildData, itemsPerRow, restrictToVisible)
        onLayoutChange(newLayout,
            verbAutoCrops(buildData, newLayout, new Set(newLayout.map(l => l.i)), layoutAutoCrop))
    }

    // Grid rows above the fold: the block a fill action must span exactly,
    // so that items parked below the fold can't compact up into view
    function foldRows(buildData: LayoutBuildData): number {
        return Math.max(1, Math.floor(
            (buildData.containerHeight - 2 * grid.padding + grid.margin) / rowStep(grid)
        ))
    }

    function toPackItem(buildData: LayoutBuildData, l: LayoutItem): PackItem {
        const [width, height] = croppedDimensions(buildData, l.i)
        return { key: l.i, width, height }
    }

    // Fit-to-cell auto crop for an item at a given cell size, computed from
    // the manual-cropped base (croppedDimensions is manual-only). Returns
    // undefined when the item's natural dimensions are unknown (metadata
    // fetch failed) — callers must leave that item's auto slot untouched
    // rather than crop against a made-up 1:1 aspect.
    function autoCropForCell(
        buildData: LayoutBuildData,
        key: string,
        w: number,
        h: number,
    ): CropRect | null | undefined {
        const item = buildData.metadata[key]?.item
        if (!item?.width || !item?.height) return undefined
        const [baseW, baseH] = croppedDimensions(buildData, key)
        const cellW = pixelWidth(w, buildData.columnWidth, buildData.grid.margin)
        const cellH = pixelHeight(h, buildData.grid)
        return computeAutoCrop(baseW / baseH, cellW, cellH)
    }

    // Auto-crop maintenance for a verb write. An auto crop is a fit to a
    // specific cell size — pure derived state with no standing per-item
    // meaning (the old "sticky" rule re-fitted any item that happened to
    // carry one, an invisible flag assigned by layout history). With the
    // verb class's governing setting ON, every item the verb laid out —
    // plus any bystander whose cell size the write changes, like evicted
    // peekers — is fitted to its cell from the manual-crop base (never
    // from the previous auto value, so repeated actions can't ratchet the
    // crop tighter). With the setting OFF, auto crops the write makes
    // stale (cell size changed) are dropped instead, letterboxing the
    // true image. Bystanders whose cell size is unchanged keep their
    // stored crop, which is still exact.
    function verbAutoCrops(
        buildData: LayoutBuildData,
        newLayout: LayoutItem[],
        touched: Set<string>,
        recrop: boolean,
    ): Record<string, CropRect | null> {
        const oldSize = new Map(layout.map(l => [l.i, `${l.w}x${l.h}`]))
        const overrides: Record<string, CropRect | null> = {}
        for (const l of newLayout) {
            const sizeChanged = oldSize.get(l.i) !== `${l.w}x${l.h}`
            if (recrop && (touched.has(l.i) || sizeChanged)) {
                const next = autoCropForCell(buildData, l.i, l.w, l.h)
                // Unknown natural dimensions (metadata fetch failed): leave
                // the slot alone rather than fit a made-up aspect
                if (next !== undefined) overrides[l.i] = next
            } else if (!recrop && sizeChanged && autoCrops[l.i]) {
                overrides[l.i] = null
            }
        }
        return overrides
    }

    // The rectangle a fill action targets: the current fold or the board's
    // ratcheted high water, whichever is larger. Fills report the height
    // they targeted back through onLayoutChange, so the ratchet only ever
    // moves when a fill actually runs.
    function targetRows(buildData: LayoutBuildData): number {
        return Math.max(foldRows(buildData), highWater)
    }

    // Anchored items inside the target rectangle, as obstacles to pack
    // around (size-locked items are travellers, not obstacles)
    function anchoredObstacles(total: number): GridRect[] {
        return layout
            .filter(l => isAnchored(l.i) && l.y < total)
            .map(l => ({ x: l.x, y: l.y, w: l.w, h: l.h }))
    }

    // Travellers: size-locked participants of a pack verb. Honoring the
    // lock's contract (keeps w x h, may move), each is placed into the
    // target box at its exact size — at the free position nearest its aim
    // point (ties break top-to-bottom, left-to-right) — and the placed
    // rect joins the obstacles the flexible items then tile around.
    // Returns a user-facing refusal message when a traveller can't be
    // placed; the caller aborts, so the verb is atomic or not at all.
    function placeTravellers(
        travellers: LayoutItem[],
        box: GridRect,
        obstacles: GridRect[],
        aimFor: (l: LayoutItem) => { x: number, y: number },
    ): { placed: LayoutItem[], rects: GridRect[] } | string {
        const overlapping = (a: GridRect, b: GridRect) =>
            a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        const placed: LayoutItem[] = []
        const rects: GridRect[] = []
        for (const l of travellers) {
            if (l.w > box.w || l.h > box.h) {
                return "A size-locked item is too big for the target area — unlock or deselect it"
            }
            const aim = aimFor(l)
            let best: { x: number, y: number, d: number } | null = null
            for (let y = box.y; y <= box.y + box.h - l.h; y++) {
                for (let x = box.x; x <= box.x + box.w - l.w; x++) {
                    const d = (x - aim.x) ** 2 + (y - aim.y) ** 2
                    if (best && d >= best.d) continue
                    const r = { x, y, w: l.w, h: l.h }
                    if (obstacles.some(o => overlapping(r, o))) continue
                    if (rects.some(o => overlapping(r, o))) continue
                    best = { x, y, d }
                }
            }
            if (!best) {
                return "No room for a size-locked item in the target area — unlock or deselect it"
            }
            rects.push({ x: best.x, y: best.y, w: l.w, h: l.h })
            placed.push({ ...l, x: best.x, y: best.y })
        }
        return { placed, rects }
    }

    // Repack into a 2D mosaic filling the target rectangle, around any
    // locked items. With visibleOnly, items whose top edge is below the
    // target (the cutting board) are left untouched and settle back just
    // under the packed block — and only in that case (something actually
    // parked below) is the block forced to span the target exactly even at
    // the cost of distortion, because an under-filled block would let the
    // cutting board compact up into view. When everything is visible the
    // two actions are equivalent.
    async function doFill({
        visibleOnly = false,
        skipIfCovered = false,
        keepProportions = false,
        resetRatchet = false,
    }: {
        visibleOnly?: boolean,
        skipIfCovered?: boolean,
        // Aim each item at its CURRENT share of the board area instead of
        // uniform shares: reflow freely, keep the proportions the user made
        keepProportions?: boolean,
        // Refit to the current view: target the fold even when the ratchet
        // is higher, and lower the ratchet to it
        resetRatchet?: boolean,
    }): Promise<string | null> {
        const buildData = await ensureBuildData()
        if (!buildData) return null
        const total = resetRatchet ? foldRows(buildData) : targetRows(buildData)
        // A layout already reaching the target was made for this viewport or
        // a bigger one (both viewport-growth triggers are height-only, so the
        // width can't have changed under it) — repainting it would make
        // shrink-and-regrow a destructive round trip. >= rather than >: a
        // fill spans the target exactly, it doesn't overshoot. Only the
        // viewport-growth trigger passes this; pin edits must relayout even
        // a covering board to integrate the new item.
        if (skipIfCovered) {
            const maxY = buildData.sortedLayout.reduce((acc, l) => Math.max(acc, l.y + l.h), 0)
            if (maxY >= total) return null
        }
        // Size-locked items travel: placed at their exact size near their
        // current spot (a fill maps the board onto itself, so "where you
        // put it" is its reading-order home), then the flexible items
        // tile around the placed rects
        const travellers = buildData.sortedLayout.filter(l =>
            isSizeLocked(l.i) && (!visibleOnly || l.y < total))
        const participants = buildData.sortedLayout.filter(l =>
            !isLocked(l.i) && (!visibleOnly || l.y < total))
        if (participants.length === 0 && travellers.length === 0) return null
        const packedKeys = new Set([...participants, ...travellers].map(l => l.i))
        const rest = layout.filter(l => !packedKeys.has(l.i))
        const anchorObstacles = anchoredObstacles(total)
        const placement = placeTravellers(travellers,
            { x: 0, y: 0, w: grid.columns, h: total }, anchorObstacles,
            l => ({ x: l.x, y: l.y }))
        if (typeof placement === "string") return placement
        const obstacles = [...anchorObstacles, ...placement.rects]
        const items = participants.map(l => toPackItem(buildData, l))
        const weights = keepProportions ? participants.map(l => l.w * l.h) : undefined
        const packed = items.length === 0 ? [] : obstacles.length > 0
            ? packRegion({
                items, obstacles, grid,
                columnWidth: buildData.columnWidth,
                totalGridRows: total,
                variant: mosaicVariant, weights,
                ...minPinUnits(grid, buildData.columnWidth),
            })
            : packMosaic({
                items, grid,
                columnWidth: buildData.columnWidth,
                totalGridRows: total,
                fill: rest.length > 0 ? "force" : "auto",
                variant: mosaicVariant, weights,
                ...minPinUnits(grid, buildData.columnWidth),
            })
        // A packer that can't produce a composition returns [] — committing
        // that would erase the packed items' records (rebuildRecords drops
        // records absent from the reported layout). No layout beats data loss.
        if (items.length > 0 && packed.length === 0) {
            return "Couldn't fill the viewport around the fixed items"
        }
        const newLayout = [...packed, ...placement.placed, ...rest]
        onLayoutChange(newLayout,
            verbAutoCrops(buildData, newLayout,
                new Set(participants.map(l => l.i)), layoutAutoCrop), total)
        return null
    }

    function fillViewport(visibleOnly: boolean, skipIfCovered = false) {
        return doFill({ visibleOnly, skipIfCovered })
    }

    // Cycle to the next distinct near-best composition and re-fill. The
    // counter is session-wide, so subsequent auto-fills keep the chosen
    // variant instead of snapping back to the first one.
    function rerollLayout() {
        mosaicVariant++
        return doFill({})
    }

    // Reset the ratchet to the current viewport and fill it — the explicit
    // opt-out for a board that moved to a smaller screen for good
    function refitToView() {
        return doFill({ resetRatchet: true })
    }

    // Reflow freely but aim every item at its current share of the board:
    // importance is expressed by how you've already sized things
    function reflowKeepProportions() {
        return doFill({ keepProportions: true })
    }

    // "Split the space evenly among N rows" — explicitly row-based. With
    // locked items on the board the rows instead flow around them like text
    // around floats (the packer chooses row counts per free segment; the
    // requested count doesn't survive that geometry).
    async function fillViewportRows(rowCount: number): Promise<string | null> {
        const buildData = await ensureBuildData()
        if (!buildData) return null
        const total = targetRows(buildData)
        const travellers = buildData.sortedLayout.filter(l => isSizeLocked(l.i))
        const participants = buildData.sortedLayout.filter(l => !isLocked(l.i))
        if (participants.length === 0 && travellers.length === 0) return null
        const packedKeys = new Set([...participants, ...travellers].map(l => l.i))
        const rest = layout.filter(l => !packedKeys.has(l.i))
        const anchorObstacles = anchoredObstacles(total)
        const placement = placeTravellers(travellers,
            { x: 0, y: 0, w: grid.columns, h: total }, anchorObstacles,
            l => ({ x: l.x, y: l.y }))
        if (typeof placement === "string") return placement
        const obstacles = [...anchorObstacles, ...placement.rects]
        const items = participants.map(l => toPackItem(buildData, l))
        const packed = items.length === 0 ? [] : obstacles.length > 0
            ? packRowsAroundObstacles({
                items, obstacles, grid,
                columnWidth: buildData.columnWidth,
                total,
                ...minPinUnits(grid, buildData.columnWidth),
            })
            : packRows({
                items, grid,
                columnWidth: buildData.columnWidth,
                totalGridRows: total,
                rowCount,
                ...minPinUnits(grid, buildData.columnWidth),
            })
        if (items.length > 0 && packed.length === 0) {
            return "Couldn't fill the rows around the fixed items"
        }
        const newLayout = [...packed, ...placement.placed, ...rest]
        onLayoutChange(newLayout,
            verbAutoCrops(buildData, newLayout,
                new Set(participants.map(l => l.i)), layoutAutoCrop), total)
        return null
    }

    // Resize-only: keep the current row groupings and reading order, give
    // each row its natural full-width justified height. Re-emits every row
    // stacked from the top, which cannot hold an ANCHORED item in place —
    // so with anchors present it must not run. Size-locked members keep
    // their w x h: the flexible members of their row justify in the
    // remaining width, and the row advances by its tallest member — a
    // size-locked item shorter than its row just sits shorter (obvious,
    // isolated, and gone the moment it's unlocked), and one taller sets
    // the pace ("justify around the bigger one").
    async function justifyCurrentRows(): Promise<string | null> {
        if (hasAnchors) return null
        const buildData = await ensureBuildData()
        if (!buildData) return null
        const { minW, minH } = minPinUnits(grid, buildData.columnWidth)
        const rows = groupRowsByOverlap(buildData.sortedLayout)
        if (!rows.some(row => row.some(l => isSizeLocked(l.i)))) {
            const newLayout = justifyRows({
                groups: rows.map(row => row.map(l => toPackItem(buildData, l))),
                grid, columnWidth: buildData.columnWidth,
                minW, minH,
            })
            onLayoutChange(newLayout,
                verbAutoCrops(buildData, newLayout, new Set(newLayout.map(l => l.i)), layoutAutoCrop))
            return null
        }
        const step = rowStep(grid)
        const newLayout: LayoutItem[] = []
        const touched = new Set<string>()
        let y = 0
        for (const row of rows) {
            if (row.length === 0) continue
            const fixed = row.filter(l => isSizeLocked(l.i))
            const flex = row.filter(l => !isSizeLocked(l.i))
            const fixedCols = fixed.reduce((acc, l) => acc + l.w, 0)
            const freeCols = grid.columns - fixedCols
            // Natural justified height for the flexible members over the
            // width the fixed members leave them (the plain natural-height
            // formula with the fixed pixel widths subtracted)
            let hFlex = 0
            let counts: number[] = []
            const justifiable = flex.length > 0 && freeCols >= flex.length
            if (justifiable) {
                const items = flex.map(l => toPackItem(buildData, l))
                const aspects = items.map(it => (it.width || 1) / (it.height || 1))
                const freePx = pixelWidth(grid.columns, buildData.columnWidth, grid.margin)
                    - (row.length - 1) * grid.margin
                    - fixed.reduce((acc, l) =>
                        acc + pixelWidth(l.w, buildData.columnWidth, grid.margin), 0)
                const naturalPx = freePx / aspects.reduce((acc, v) => acc + v, 0)
                hFlex = Math.max(minH, Math.round((naturalPx + grid.margin) / step))
                const targetPx = hFlex * step - grid.margin
                const ideal = aspects.map(a =>
                    (a * targetPx + grid.margin) / (buildData.columnWidth + grid.margin))
                const effMin = Math.max(1, Math.min(minW, Math.floor(freeCols / flex.length)))
                counts = apportionToTotal(ideal, freeCols, effMin)
            }
            // Emit in reading order; non-justifiable rows (all locked, or
            // the locks leave no width) keep every member's current size
            // and just reflow at the cursor
            let x = 0
            let fi = 0
            let advance = 1
            for (const l of row) {
                const w = isSizeLocked(l.i) || !justifiable ? l.w : counts[fi]
                const h = isSizeLocked(l.i) || !justifiable ? l.h : hFlex
                if (!isSizeLocked(l.i)) {
                    if (justifiable) touched.add(l.i)
                    fi++
                }
                newLayout.push({ ...l, x, y, w, h })
                advance = Math.max(advance, h)
                x += w
            }
            y += advance
        }
        onLayoutChange(newLayout,
            verbAutoCrops(buildData, newLayout, touched, layoutAutoCrop))
        return null
    }

    // Grow the current arrangement to fill the target rectangle without
    // rearranging: recover the layout's guillotine structure and re-solve
    // sizes only. Arrangements that don't decompose exactly fall back to a
    // row-stack structure INSIDE growToFill — every path goes through the
    // exact-fill emitter, so growing can never come up short of the target
    // (a justify-style fallback here once did, shrinking the board).
    // Structure recovery can't hold a locked rect in place while resizing
    // everything around it, so with locks inside the target the grow
    // degrades to a proportional reflow around them: anchored items stay
    // put, size-locked items keep their w x h near their current spot,
    // and everything else re-tiles at its current share of the space —
    // the arrangement may shift, but the sizes' intent survives.
    async function growInPlace(): Promise<string | null> {
        const buildData = await ensureBuildData()
        if (!buildData) return null
        const total = targetRows(buildData)
        const mins = minPinUnits(grid, buildData.columnWidth)
        if (layout.some(l => isLocked(l.i) && l.y < total)) {
            const travellers = buildData.sortedLayout.filter(l =>
                isSizeLocked(l.i) && l.y < total)
            const participants = buildData.sortedLayout.filter(l =>
                !isLocked(l.i) && l.y < total)
            const packedKeys = new Set([...participants, ...travellers].map(l => l.i))
            const rest = layout.filter(l => !packedKeys.has(l.i))
            const anchorObstacles = anchoredObstacles(total)
            const placement = placeTravellers(travellers,
                { x: 0, y: 0, w: grid.columns, h: total }, anchorObstacles,
                l => ({ x: l.x, y: l.y }))
            if (typeof placement === "string") return placement
            const packed = participants.length === 0 ? [] : packRegion({
                items: participants.map(l => toPackItem(buildData, l)),
                obstacles: [...anchorObstacles, ...placement.rects],
                grid,
                columnWidth: buildData.columnWidth,
                totalGridRows: total,
                variant: mosaicVariant,
                weights: participants.map(l => l.w * l.h),
                ...mins,
            })
            if (participants.length > 0 && packed.length === 0) {
                return "Couldn't grow the board around the fixed items"
            }
            const newLayout = [...packed, ...placement.placed, ...rest]
            onLayoutChange(newLayout,
                verbAutoCrops(buildData, newLayout,
                    new Set(participants.map(l => l.i)), layoutAutoCrop), total)
            return null
        }
        const participants = buildData.sortedLayout.filter(l => l.y < total)
        if (participants.length === 0) return null
        const packedKeys = new Set(participants.map(l => l.i))
        const rest = layout.filter(l => !packedKeys.has(l.i))
        const arranged: ArrangedItem[] = participants.map(l => ({
            ...toPackItem(buildData, l), x: l.x, y: l.y, w: l.w, h: l.h,
        }))
        const packed = growToFill({
            items: arranged, grid,
            columnWidth: buildData.columnWidth,
            totalGridRows: total,
            ...mins,
        })
        if (packed.length === 0) return null
        const newLayout = [...packed, ...rest]
        onLayoutChange(newLayout,
            verbAutoCrops(buildData, newLayout, packedKeys, layoutAutoCrop), total)
        return null
    }

    // Exchange two items' rects: each fills exactly the void the other
    // leaves, nothing else moves, and the sticky auto-crops absorb the
    // aspect mismatch of the traded cells. A size-locked item swaps too —
    // it keeps its own w x h and lands at the free spot nearest the
    // partner's old corner (its flexible partner adopts the full vacated
    // rect, so equal-size locked pairs are a clean position swap). Only
    // anchors refuse: a position lock can't take the other's place.
    async function swapItems(keyA: string, keyB: string): Promise<string | null> {
        if (isAnchored(keyA) || isAnchored(keyB)) {
            return "An anchored item can't swap — unanchor it first"
        }
        const buildData = await ensureBuildData()
        if (!buildData) return null
        const a = layout.find(l => l.i === keyA)
        const b = layout.find(l => l.i === keyB)
        if (!a || !b) return null
        let newA: LayoutItem, newB: LayoutItem
        if (!isSizeLocked(keyA) && !isSizeLocked(keyB)) {
            newA = { ...a, x: b.x, y: b.y, w: b.w, h: b.h }
            newB = { ...b, x: a.x, y: a.y, w: a.w, h: a.h }
        } else {
            // The board is open-ended below, so give the placement scan
            // room past everything — a spot always exists down there
            const maxY = layout.reduce((acc, l) => Math.max(acc, l.y + l.h), 0)
            const board = { x: 0, y: 0, w: grid.columns, h: maxY + a.h + b.h }
            const others = layout
                .filter(l => l.i !== keyA && l.i !== keyB)
                .map(l => ({ x: l.x, y: l.y, w: l.w, h: l.h }))
            // Each item aims at its partner's old corner; a flexible one
            // simply takes the partner's whole rect first and becomes an
            // obstacle for the locked one's placement
            const fixedRects: GridRect[] = []
            if (!isSizeLocked(keyA)) {
                newA = { ...a, x: b.x, y: b.y, w: b.w, h: b.h }
                fixedRects.push({ x: newA.x, y: newA.y, w: newA.w, h: newA.h })
                const placed = placeTravellers([b], board, [...others, ...fixedRects],
                    () => ({ x: a.x, y: a.y }))
                if (typeof placed === "string") return placed
                newB = placed.placed[0]
            } else if (!isSizeLocked(keyB)) {
                newB = { ...b, x: a.x, y: a.y, w: a.w, h: a.h }
                fixedRects.push({ x: newB.x, y: newB.y, w: newB.w, h: newB.h })
                const placed = placeTravellers([a], board, [...others, ...fixedRects],
                    () => ({ x: b.x, y: b.y }))
                if (typeof placed === "string") return placed
                newA = placed.placed[0]
            } else {
                const placed = placeTravellers([a, b], board, others,
                    l => l.i === keyA ? { x: b.x, y: b.y } : { x: a.x, y: a.y })
                if (typeof placed === "string") return placed
                ;[newA, newB] = placed.placed
            }
        }
        const byKey = new Map([[keyA, newA], [keyB, newB]])
        const newLayout = layout.map(l => byKey.get(l.i) ?? l)
        // Only cells that actually changed size need crop maintenance —
        // a size-locked item's cell never does
        const touched = new Set([keyA, keyB].filter(k => !isSizeLocked(k)))
        onLayoutChange(newLayout,
            verbAutoCrops(buildData, newLayout, touched, selectionAutoCrop))
        return null
    }

    // Mosaic the selected items within their combined bounding box — the
    // box is claimed for the selection. Anchored items are never
    // rearranged: selected ones only stretch the box (their spot is part
    // of the region being arranged), and every anchored item intersecting
    // the box — selected or not — becomes an obstacle the mosaic packs
    // around. Size-locked selected items travel at their fixed size
    // (placeTravellers). Unselected non-anchored items caught inside the
    // box are cleared out first by evictFromBox's local moves (slide
    // sideways / shrink to the edge / drop below the box — size-locked
    // bystanders move whole or stay); whatever can't leave cheaply stays
    // put as an obstacle too. Without the obstacle handling the
    // arrangement would overlap those rects and RGL's compactor would
    // shove the overlapping items apart, scattering the board. (The
    // compactor may still settle the arranged block upward if there is
    // free space above it, as with every arrangement verb.)
    // With keepProportions ("Reflow Selection") each item aims at its
    // current share of the box area instead of a uniform share.
    // With shuffle ("Shuffle") the participants are packed in a random
    // order instead of reading order, retried until the geometry actually
    // differs — the reroll for a selection. The packer itself is
    // deterministic and order-preserving, so an already-arranged selection
    // is a fixed point of plain Arrange; permuting its input is what
    // reaches the compositions the DP would otherwise never consider.
    async function arrangeSelection(
        keys: string[], keepProportions = false, shuffle = false,
    ): Promise<string | null> {
        const buildData = await ensureBuildData()
        if (!buildData) return null
        const keySet = new Set(keys)
        const selectedItems = buildData.sortedLayout.filter(l => keySet.has(l.i))
        // Anchored selected items stay exactly where they are — they're
        // already inside the box, so holding still IS their arrangement.
        // Size-locked selected items are travellers: re-placed at their
        // fixed size (near their current spot; at a random spot under
        // shuffle), and the flexible rest tiles the remaining space.
        const travellers = selectedItems.filter(l => isSizeLocked(l.i))
        const participants = selectedItems.filter(l => !isLocked(l.i))
        if (participants.length + travellers.length < 2) return null
        const x0 = Math.min(...selectedItems.map(l => l.x))
        const y0 = Math.min(...selectedItems.map(l => l.y))
        const x1 = Math.max(...selectedItems.map(l => l.x + l.w))
        const y1 = Math.max(...selectedItems.map(l => l.y + l.h))
        const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
        const packedKeys = new Set([...participants, ...travellers].map(l => l.i))
        const mins = minPinUnits(grid, buildData.columnWidth)
        const { rest, extraObstacles } = evictFromBox({
            layout, box,
            participantKeys: packedKeys,
            sizeLockedKeys: new Set(layout.filter(l => isSizeLocked(l.i)).map(l => l.i)),
            anchoredKeys: new Set(layout.filter(l => isAnchored(l.i)).map(l => l.i)),
            columns: grid.columns,
            ...mins,
        })
        const baseObstacles = [
            ...layout
                .filter(l => isAnchored(l.i)
                    && l.x < x1 && l.x + l.w > x0 && l.y < y1 && l.y + l.h > y0)
                .map(l => ({ x: l.x, y: l.y, w: l.w, h: l.h })),
            ...extraObstacles,
        ]
        const currentAim = (l: LayoutItem) => ({ x: l.x, y: l.y })
        const randomAim = (l: LayoutItem) => ({
            x: box.x + Math.floor(Math.random() * Math.max(1, box.w - l.w + 1)),
            y: box.y + Math.floor(Math.random() * Math.max(1, box.h - l.h + 1)),
        })
        const packItems = participants.map(l => toPackItem(buildData, l))
        const attempt = (order: PackItem[], aimFor: (l: LayoutItem) => { x: number, y: number }) => {
            const placement = placeTravellers(travellers, box, baseObstacles, aimFor)
            if (typeof placement === "string") return placement
            const packed = order.length > 0
                ? packRegionInBox({
                    items: order,
                    obstacles: [...baseObstacles, ...placement.rects],
                    grid,
                    columnWidth: buildData.columnWidth,
                    box,
                    variant: mosaicVariant,
                    // Weights stay off under shuffle: a reroll
                    // redistributes the space, it doesn't re-derive it
                    // from the last outcome. (Non-shuffle order is exactly
                    // packItems, so the weights align with the items.)
                    weights: keepProportions && !shuffle
                        ? participants.map(l => l.w * l.h) : undefined,
                    ...mins,
                })
                : []
            return { packed, placement }
        }
        let result = attempt(packItems, currentAim)
        if (typeof result === "string") return result
        if (shuffle) {
            const current = new Map([...participants, ...travellers].map(l =>
                [l.i, `${l.x},${l.y},${l.w},${l.h}`]))
            const unchanged = (candidate: LayoutItem[]) =>
                candidate.every(l => current.get(l.i) === `${l.x},${l.y},${l.w},${l.h}`)
            // A tiny selection has few distinct orders (2 items: two), so
            // an identical draw is common — redraw a few times rather than
            // presenting a "reroll" that visibly did nothing. All orders
            // exhausted-by-luck: commit the last draw anyway (the no-change
            // guard in onLayoutChange makes that a true no-op).
            for (let tries = 0; tries < 8; tries++) {
                const order = [...packItems]
                for (let i = order.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1))
                    const tmp = order[i]; order[i] = order[j]; order[j] = tmp
                }
                const candidate = attempt(order, randomAim)
                if (typeof candidate === "string") continue
                if (participants.length > 0 && candidate.packed.length === 0) continue
                result = candidate
                if (!unchanged([...candidate.packed, ...candidate.placement.placed])) break
            }
        }
        if (participants.length > 0 && result.packed.length === 0) {
            return "Couldn't arrange the selection around the fixed items"
        }
        const newLayout = [...result.packed, ...result.placement.placed, ...rest]
        onLayoutChange(newLayout,
            verbAutoCrops(buildData, newLayout,
                new Set(participants.map(l => l.i)), selectionAutoCrop))
        return null
    }

    // Send the selection to a preset region: the region is cleared out and
    // the selected items are packed to tile it completely, reflow-style
    // (each aims at its current share of the space, so relative sizes
    // survive the move). The selection may come from anywhere on the
    // board — this is how a group of items is handed a column of its own.
    // Non-selected, non-anchored items overlapping the region are evicted
    // BELOW the board's target line (fold or ratchet), where they stack
    // past whatever already sits there — a staging band. Since the packed
    // region spans the full target height, the vertical compactor can't
    // pull evictees back up through it, and regions built earlier don't
    // overlap this one, so filling the board region by region never
    // disturbs the previous fill. Anchored bystanders in the region stay
    // put as obstacles.
    // The whole selection travels: size-locked selected items keep their
    // w x h and are placed first-fit into the region (reading order,
    // row-major scan), then the flexible items tile the remaining space
    // around them. Anchored selected items can't travel at all, so the
    // verb refuses outright — silently sending only part of the group
    // was a footgun. Returns a user-facing error message for the toast,
    // or null on success; the not-actionable cases (unmeasured
    // container, stale keys) stay silent no-ops.
    async function sendSelectionToRegion(
        keys: string[], preset: RegionPreset,
    ): Promise<string | null> {
        const buildData = await ensureBuildData()
        if (!buildData) return null
        const keySet = new Set(keys)
        const selectedItems = buildData.sortedLayout.filter(l => keySet.has(l.i))
        if (selectedItems.length === 0) return null
        const anchoredCount = selectedItems.filter(l => isAnchored(l.i)).length
        if (anchoredCount > 0) {
            return anchoredCount === 1
                ? "An anchored item is selected — unanchor or deselect it first"
                : `${anchoredCount} anchored items are selected — unanchor or deselect them first`
        }
        const sizeLocked = selectedItems.filter(l => locks[l.i] === "size")
        const flexible = selectedItems.filter(l => !isLocked(l.i))
        const total = targetRows(buildData)
        const box = regionBox(preset, grid.columns, total)
        const overlapping = (a: GridRect, b: GridRect) =>
            a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        const inBox = (l: LayoutItem) =>
            overlapping({ x: l.x, y: l.y, w: l.w, h: l.h }, box)
        const packedKeys = new Set(selectedItems.map(l => l.i))
        const rest = layout.filter(l => !packedKeys.has(l.i)).map(l => ({ ...l }))
        // Evictees keep their size and x and drop straight down from the
        // region's bottom edge to the first free spot — size locks don't
        // matter (nothing resizes), anchors are never moved. Processed
        // top-to-bottom so the staging band roughly preserves their order.
        const evictees = rest
            .filter(l => !keySet.has(l.i) && !isAnchored(l.i) && inBox(l))
            .sort((a, b) => a.y - b.y || a.x - b.x)
        const evictKeys = new Set(evictees.map(l => l.i))
        const solid: GridRect[] = rest
            .filter(l => !evictKeys.has(l.i))
            .map(l => ({ x: l.x, y: l.y, w: l.w, h: l.h }))
        for (const l of evictees) {
            const r = { x: l.x, y: box.y + box.h, w: l.w, h: l.h }
            for (; ;) {
                const hit = solid.find(o => overlapping(r, o))
                if (!hit) break
                r.y = hit.y + hit.h
            }
            l.y = r.y
            solid.push(r)
        }
        const obstacles = rest
            .filter(l => !evictKeys.has(l.i) && isLocked(l.i) && inBox(l))
            .map(l => ({ x: l.x, y: l.y, w: l.w, h: l.h }))
        // Travellers land at the free spot nearest their current position,
        // so the group's rough geography survives the move
        const placement = placeTravellers(sizeLocked, box, obstacles,
            l => ({ x: l.x, y: l.y }))
        if (typeof placement === "string") return placement
        const { placed: placedItems, rects: placedRects } = placement
        const packed = flexible.length > 0
            ? packRegionInBox({
                items: flexible.map(l => toPackItem(buildData, l)),
                obstacles: [...obstacles, ...placedRects],
                grid,
                columnWidth: buildData.columnWidth,
                box,
                variant: mosaicVariant,
                weights: flexible.map(l => l.w * l.h),
                ...minPinUnits(grid, buildData.columnWidth),
            })
            : []
        if (flexible.length > 0 && packed.length === 0) {
            return "Couldn't fit the selection around the region's fixed items"
        }
        const newLayout = [...packed, ...placedItems, ...rest]
        // The region explicitly targets the full line, so the write moves
        // the ratchet like a fill does. Size-locked travellers keep their
        // cell size, so only the flexible items need auto-crop maintenance.
        onLayoutChange(newLayout,
            verbAutoCrops(buildData, newLayout,
                new Set(flexible.map(l => l.i)), selectionAutoCrop), total)
        return null
    }

    // Fit each given item to its current cell — the selection toolbar's
    // crop-now action, fired when its auto-crop toggle turns on
    async function autoCropSelection(keys: string[]) {
        const buildData = await ensureBuildData()
        if (!buildData) return
        const keySet = new Set(keys)
        const overrides: Record<string, CropRect | null> = {}
        for (const l of layout) {
            if (!keySet.has(l.i)) continue
            const next = autoCropForCell(buildData, l.i, l.w, l.h)
            if (next !== undefined) overrides[l.i] = next
        }
        onLayoutChange(layout, overrides)
    }

    async function changeItemSize(layoutKey: string, increase: number) {
        if (isLocked(layoutKey)) return
        const buildData = await ensureBuildData()
        if (!buildData) return
        const { minW, minH } = minPinUnits(grid, buildData.columnWidth)
        const newLayout = layout.map(l => {
            if (l.i === layoutKey) {
                const [w, h] = croppedDimensions(buildData, l.i)
                const newW = Math.max(minW, l.w + increase)
                return {
                    ...l,
                    w: newW,
                    h: findOptimalHeight(newW, grid, buildData.columnWidth, w, h, minH),
                }
            }
            return l
        })
        // An explicit size command is gesture-like: it does not re-fit, it
        // just drops the auto crop its own resize made stale
        onLayoutChange(newLayout, verbAutoCrops(buildData, newLayout, new Set(), false))
    }
    async function setItemSize(layoutKey: string, size: number) {
        if (isLocked(layoutKey)) return
        const buildData = await ensureBuildData()
        if (!buildData) return
        const { minW, minH } = minPinUnits(grid, buildData.columnWidth)
        const newLayout = layout.map(l => {
            if (l.i === layoutKey) {
                const [w, h] = croppedDimensions(buildData, l.i)
                const newW = Math.max(minW, size)
                return {
                    ...l,
                    w: newW,
                    h: findOptimalHeight(newW, grid, buildData.columnWidth, w, h, minH),
                }
            }
            return l
        })
        onLayoutChange(newLayout, verbAutoCrops(buildData, newLayout, new Set(), false))
    }
    // Fit every item (or only those starting above the fold) to its current
    // cell by writing its auto-crop slot. Near-fits (>= 98% of the base)
    // get null. The geometry is untouched: the current layout plus the
    // overrides map goes through the same atomic mechanism as the layout
    // actions.
    async function autoCropToCells(visibleOnly: boolean) {
        const buildData = await ensureBuildData()
        if (!buildData) return
        const total = foldRows(buildData)
        const overrides: Record<string, CropRect | null> = {}
        for (const l of layout) {
            if (visibleOnly && l.y >= total) continue
            const next = autoCropForCell(buildData, l.i, l.w, l.h)
            if (next !== undefined) overrides[l.i] = next
        }
        onLayoutChange(layout, overrides)
    }
    // Clear every auto slot, manual crops untouched. No aspect math, so no
    // build data needed — this works even when the container is unmeasurable.
    function clearAutoCrops() {
        const overrides: Record<string, CropRect | null> = {}
        for (const l of layout) overrides[l.i] = null
        onLayoutChange(layout, overrides)
    }
    // The same restricted to the selection: the counterpart of the
    // toolbar's crop-now, for un-cropping just the selected items
    function clearAutoCropSelection(keys: string[]) {
        const overrides: Record<string, CropRect | null> = {}
        for (const key of keys) overrides[key] = null
        onLayoutChange(layout, overrides)
    }
    // One-time horizontal "gravity": items slide left/right until they hit
    // the board edge, an anchored item, or another settled item — so
    // anchors just hold their ground and everything else packs against
    // them. Pure x sliding without resizing, so no build data needed. On an
    // anchor-free board this lands every row flush, same as the old whole-
    // row repack. Center has no gravity direction (it packs whole rows
    // flush about their middle), so it alone still needs an anchor-free
    // board. Size locks never matter here: nothing changes size.
    function shiftLayout(mode: ShiftMode) {
        if (mode === "center") {
            if (hasAnchors) return
            onLayoutChange(shiftLayoutHorizontally(layout, mode, grid.columns))
            return
        }
        const movable = new Set(layout.filter(l => !isAnchored(l.i)).map(l => l.i))
        onLayoutChange(gravityShiftLayout(layout, mode, grid.columns, movable))
    }
    // The same gravity restricted to the selection: only selected items
    // fall, and they stop at ANY other item — so nothing outside the
    // selection ever moves. Anchored items inside the selection simply
    // stay put as obstacles. Center packs the selection flush with
    // leftward gravity first, then slides each y-overlap cluster right by
    // half its remaining free space — so unlike the global Center (a
    // whole-row repack) it composes with anchors like the other two.
    function shiftSelection(keys: string[], dir: "left" | "right" | "center") {
        const movable = new Set(keys.filter(k => !isAnchored(k)))
        if (movable.size === 0) return
        onLayoutChange(dir === "center"
            ? gravityCenterShiftLayout(layout, grid.columns, movable)
            : gravityShiftLayout(layout, dir, grid.columns, movable))
    }
    // Mirror the arrangement (not the images) about the centre of the items'
    // own bounding box, so the group stays put and items swap places. A
    // grid-wide flip is this plus a Shift. Vertical is inherently swap-only:
    // the grid re-compacts upward, so the mirrored rows just settle back.
    // A flip is a rigid bijection — an anchored item is a fixed point off
    // the axis and breaks it, so anchors disable this. Size locks don't:
    // mirroring moves items but never resizes them.
    function mirrorLayout(axis: MirrorAxis) {
        if (hasAnchors) return
        onLayoutChange(mirrorLayoutArrangement(layout, axis))
    }
    // Mirror the selected items about the centre of their bounding box,
    // touching nothing outside the selection. The flip keeps the selected
    // rects disjoint from EACH OTHER (it's rigid), so the only conflicts
    // are with non-selected geometry poking into the mirrored silhouette —
    // the flipped puzzle piece needn't fit its old hole. Conflicts are
    // resolved per item and only ever at the selection's expense: clip the
    // mirrored rect away from whatever it overlaps, edge by edge, keeping
    // the largest remainder; when clipping can't reach the minimum size
    // (or the item is size-locked and may not shrink), drop it straight
    // down from its mirrored spot to the first free row instead. Anchored
    // items IN the selection can't flip (fixed point off the axis), so
    // they disable the verb; anchors outside the selection are irrelevant.
    async function mirrorSelection(keys: string[], axis: MirrorAxis) {
        const keySet = new Set(keys)
        const selectedItems = layout.filter(l => keySet.has(l.i))
        if (selectedItems.length < 2) return
        if (selectedItems.some(l => isAnchored(l.i))) return
        const buildData = await ensureBuildData()
        if (!buildData) return
        const { minW, minH } = minPinUnits(grid, buildData.columnWidth)
        const lo = axis === "horizontal"
            ? Math.min(...selectedItems.map(l => l.x))
            : Math.min(...selectedItems.map(l => l.y))
        const hi = axis === "horizontal"
            ? Math.max(...selectedItems.map(l => l.x + l.w))
            : Math.max(...selectedItems.map(l => l.y + l.h))
        const flip = (l: LayoutItem): LayoutItem => axis === "horizontal"
            ? { ...l, x: lo + hi - (l.x + l.w) }
            : { ...l, y: lo + hi - (l.y + l.h) }
        const overlapping = (a: GridRect, b: GridRect) =>
            a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        // Everything already placed is solid: non-selected items always,
        // plus each mirrored item once it's resolved
        const solid: GridRect[] = layout
            .filter(l => !keySet.has(l.i))
            .map(l => ({ x: l.x, y: l.y, w: l.w, h: l.h }))
        const resolved: LayoutItem[] = []
        const mirrored = selectedItems.map(flip)
            .sort((a, b) => a.y - b.y || a.x - b.x)
        for (const m of mirrored) {
            const r = { x: m.x, y: m.y, w: m.w, h: m.h }
            const canResize = locks[m.i] !== "size"
            let fits = false
            for (; ;) {
                const hit = solid.find(o => overlapping(r, o))
                if (!hit) { fits = true; break }
                if (!canResize) break
                // Four ways to clear this conflict; keep the biggest rect
                // that still meets the minimums
                const options = [
                    { x: hit.x + hit.w, y: r.y, w: r.x + r.w - (hit.x + hit.w), h: r.h },
                    { x: r.x, y: r.y, w: hit.x - r.x, h: r.h },
                    { x: r.x, y: hit.y + hit.h, w: r.w, h: r.y + r.h - (hit.y + hit.h) },
                    { x: r.x, y: r.y, w: r.w, h: hit.y - r.y },
                ].filter(o => o.w >= minW && o.h >= minH)
                if (options.length === 0) break
                const best = options.reduce((a, b) => a.w * a.h >= b.w * b.h ? a : b)
                r.x = best.x; r.y = best.y; r.w = best.w; r.h = best.h
            }
            if (!fits) {
                // Drop: keep the mirrored x and size, slide down past every
                // conflict to the first free row (the board is open-ended
                // below, so this always succeeds)
                r.w = m.w; r.h = m.h; r.x = m.x; r.y = m.y
                for (; ;) {
                    const hit = solid.find(o => overlapping(r, o))
                    if (!hit) break
                    r.y = hit.y + hit.h
                }
            }
            resolved.push({ ...m, ...r })
            solid.push(r)
        }
        const byKey = new Map(resolved.map(l => [l.i, l]))
        const newLayout = layout.map(l => byKey.get(l.i) ?? l)
        onLayoutChange(newLayout,
            verbAutoCrops(buildData, newLayout, keySet, selectionAutoCrop))
    }
    // Grow the selection into the empty space around it. The bounding box
    // expands sideways along the selection's own rows until it meets the
    // board edge or a non-selected item, then up and down over that full
    // width the same way — so by construction the added bands are empty,
    // and the only obstacles are things that already poked into the
    // original bbox (plus locked selected items, which stay exactly in
    // place). The bottom edge, where the board is open-ended, grows to the
    // fills' own target line (fold or ratchet) instead of forever.
    // Obstacle-free selections keep their arrangement: structure recovery
    // re-solves sizes only. With obstacles the structure can't survive, so
    // the selection reflows around them in reading order, each item aiming
    // at its current share of the area.
    async function growSelection(keys: string[]): Promise<string | null> {
        const buildData = await ensureBuildData()
        if (!buildData) return null
        const keySet = new Set(keys)
        const selectedItems = buildData.sortedLayout.filter(l => keySet.has(l.i))
        const travellers = selectedItems.filter(l => isSizeLocked(l.i))
        const participants = selectedItems.filter(l => !isLocked(l.i))
        if (participants.length === 0) {
            return "Nothing in the selection can resize — unlock an item first"
        }
        const x0 = Math.min(...selectedItems.map(l => l.x))
        const y0 = Math.min(...selectedItems.map(l => l.y))
        const x1 = Math.max(...selectedItems.map(l => l.x + l.w))
        const y1 = Math.max(...selectedItems.map(l => l.y + l.h))
        const fixed = layout.filter(l => !keySet.has(l.i))
        // Sideways: bounded by items overlapping the bbox's own rows
        let left = 0, right = grid.columns
        for (const o of fixed) {
            if (o.y < y1 && y0 < o.y + o.h) {
                if (o.x + o.w <= x0) left = Math.max(left, o.x + o.w)
                else if (o.x >= x1) right = Math.min(right, o.x)
            }
        }
        // Vertically: bounded by items overlapping the EXPANDED width, so
        // diagonal neighbors bound the bands rather than sit inside them
        let top = 0
        let bottom = Math.max(targetRows(buildData), y1)
        for (const o of fixed) {
            if (o.x < right && o.x + o.w > left) {
                if (o.y + o.h <= y0) top = Math.max(top, o.y + o.h)
                else if (o.y >= y1) bottom = Math.min(bottom, o.y)
            }
        }
        bottom = Math.max(bottom, y1)
        const box = { x: left, y: top, w: right - left, h: bottom - top }
        const mins = minPinUnits(grid, buildData.columnWidth)
        // Anchored selected items stay in place as obstacles; size-locked
        // selected items travel at their fixed size (near their current
        // spot) and the placed rects become obstacles for the grow
        const baseObstacles = [
            ...selectedItems.filter(l => isAnchored(l.i)),
            ...fixed.filter(l =>
                l.x < x1 && l.x + l.w > x0 && l.y < y1 && l.y + l.h > y0),
        ].map(l => ({ x: l.x, y: l.y, w: l.w, h: l.h }))
        const placement = placeTravellers(travellers, box, baseObstacles,
            l => ({ x: l.x, y: l.y }))
        if (typeof placement === "string") return placement
        const obstacles = [...baseObstacles, ...placement.rects]
        const packedKeys = new Set(participants.map(l => l.i))
        const rest = layout.filter(l =>
            !packedKeys.has(l.i) && !placement.placed.some(p => p.i === l.i))
        const packed = obstacles.length > 0
            ? packRegionInBox({
                items: participants.map(l => toPackItem(buildData, l)),
                obstacles, grid,
                columnWidth: buildData.columnWidth,
                box, variant: mosaicVariant,
                weights: participants.map(l => l.w * l.h),
                ...mins,
            })
            : growToFillInBox({
                items: participants.map(l => ({
                    ...toPackItem(buildData, l), x: l.x, y: l.y, w: l.w, h: l.h,
                })),
                grid,
                columnWidth: buildData.columnWidth,
                box,
                ...mins,
            })
        if (packed.length === 0) {
            return "Couldn't grow the selection around the fixed items"
        }
        const newLayout = [...packed, ...placement.placed, ...rest]
        onLayoutChange(newLayout,
            verbAutoCrops(buildData, newLayout, packedKeys, selectionAutoCrop))
        return null
    }

    return {
        ensureBuildData,
        changeLayout,
        fillViewport,
        fillViewportRows,
        justifyCurrentRows,
        autoCropToCells,
        clearAutoCrops,
        changeItemSize,
        setItemSize,
        shiftLayout,
        shiftSelection,
        mirrorLayout,
        mirrorSelection,
        rerollLayout,
        refitToView,
        reflowKeepProportions,
        growInPlace,
        growSelection,
        swapItems,
        arrangeSelection,
        sendSelectionToRegion,
        autoCropSelection,
        clearAutoCropSelection,
        // Lock presence flags for the menus: hasLocks greys the verbs that
        // rebuild whole rows (any lock breaks them), hasAnchors the ones
        // that only a fixed position breaks (center, mirror)
        hasLocks,
        hasAnchors,
    }
}

// Takes layout keys (`${index}-${sha256}`), fetches each unique sha256 once,
// and returns metadata keyed by the original layout key
async function fetchMetadata(keys: string[], dbs: { index_db: string | null, user_data_db: string | null }) {
    const uniqueShas = Array.from(new Set(
        keys.map(keyToSha256).filter(sha => sha && sha !== "__preview")
    ))
    // A failed lookup silently degrades the item to a 1:1 square, so retry
    // once before giving up on it
    async function fetchItem(sha256: string) {
        for (let attempt = 0; ; attempt++) {
            const response = await fetchClient.GET("/api/items/item", {
                params: {
                    query: {
                        ...dbs,
                        id: sha256,
                        id_type: "sha256",
                    }
                }
            })
            if (response.data || attempt >= 1) return [sha256, response.data] as const
        }
    }
    const results = await Promise.all(uniqueShas.map(fetchItem));
    const bySha = Object.fromEntries(results);

    return Object.fromEntries(keys.map(key => [key, bySha[keyToSha256(key)]]));
}

// Pixel size of an item spanning w columns / h rows, including the margins
// between the cells it spans
function pixelWidth(w: number, columnWidth: number, margin: number): number {
    return w * columnWidth + (w - 1) * margin
}
function pixelHeight(h: number, grid: GridParams): number {
    return h * grid.rowHeight + (h - 1) * grid.margin
}

interface LayoutBuildData {
    metadata: {
        [x: string]: {
            item: components["schemas"]["ItemRecordResponse"];
            files: components["schemas"]["FileRecordResponse"][];
        } | undefined
    },
    crops: Record<string, CropRect | null>,
    columnWidth: number,
    grid: GridParams,
    containerHeight: number,
    sortedLayout: LayoutItem[],
}

// Effective source dimensions of an item: the image size scaled by its
// MANUAL crop rect (the rebase), so cropped items keep the aspect of the
// user's chosen region. Auto crops are deliberately excluded: they are
// derived from cell sizes, so feeding them back into the layout math would
// make every layout action see the previous action's output as the truth.
function croppedDimensions(buildData: LayoutBuildData, key: string): [number, number] {
    const item = buildData.metadata[key]?.item
    const crop = buildData.crops[key]
    return [
        (item?.width || 1) * (crop?.w ?? 1),
        (item?.height || 1) * (crop?.h ?? 1),
    ]
}

async function getLayoutBuildData(
    {
        layout,
        crops,
        dbs,
        grid,
        pinboardRef,
    }: {
        layout: LayoutItem[],
        crops: Record<string, CropRect | null>,
        dbs: {
            index_db: string | null,
            user_data_db: string | null,
        },
        grid: GridParams,
        pinboardRef: RefObject<HTMLDivElement | null>,
    }
): Promise<LayoutBuildData | null> {
    const keys = layout.map(l => l.i)
    const clientWidth = pinboardRef.current?.clientWidth || 0
    const containerHeight = pinboardRef.current?.clientHeight || 0
    // An unmeasurable container (display: none, background tab with
    // rendering suspended...) would quietly produce a garbage layout —
    // computing against a 0x0 viewport crams everything into one tiny row.
    // No layout is better than a destructive one.
    if (clientWidth < 100 || containerHeight < 100) return null
    const metadata = await fetchMetadata(keys, dbs)
    // Exact pixel width of one column: the container width minus its padding
    // and the margins between columns, split evenly
    const columnWidth = Math.max(1, (clientWidth - 2 * grid.padding - (grid.columns - 1) * grid.margin) / grid.columns)
    const sortedLayout = sortLayout(layout)
    return { metadata, crops, columnWidth, grid, containerHeight, sortedLayout }
}

function sortLayout(layout: LayoutItem[]): LayoutItem[] {
    // Copy and sort layout by `y` coordinate
    const heightSorted = [...layout].sort((a, b) => a.y - b.y);
    const sortedLayout: LayoutItem[] = [];
    let startIdx = 0;

    while (sortedLayout.length < layout.length) {
        const lowestYItem = heightSorted[startIdx];
        const centerY = lowestYItem.y + Math.floor(lowestYItem.h / 2);
        const currentRow: LayoutItem[] = [];

        // Collect items that are within the same logical row
        let i = startIdx;
        for (; i < heightSorted.length; i++) {
            const item = heightSorted[i];
            if (item.y > centerY) break;
            currentRow.push(item);
        }

        // Sort items in the current row by `x` coordinate
        currentRow.sort((a, b) => a.x - b.x);
        sortedLayout.push(...currentRow);
        startIdx = i;
    }
    return sortedLayout;
}

// Preset target regions for "Send to Region": full visible height, cut at
// halves or thirds of the board width — plus the whole viewport (fold or
// ratchet, whichever is taller), which hands the ENTIRE visible board to
// the selection and stages everything else below. Complementary pairs
// share their cut lines (left two-thirds + right third tile the board
// exactly), so regions filled one after the other compose without gaps or
// overlaps.
export type RegionPreset =
    | "viewport"
    | "left-half" | "right-half"
    | "left-third" | "center-third" | "right-third"
    | "left-two-thirds" | "right-two-thirds"

// Menu entries, in display order — shared by the toolbar dropdown and the
// context menu so the two lists can't drift apart
export const REGION_PRESETS: [RegionPreset, string][] = [
    ["viewport", "Entire Viewport"],
    ["left-half", "Left Half"],
    ["right-half", "Right Half"],
    ["left-third", "Left Third"],
    ["center-third", "Center Third"],
    ["right-third", "Right Third"],
    ["left-two-thirds", "Left Two-Thirds"],
    ["right-two-thirds", "Right Two-Thirds"],
]

function regionBox(preset: RegionPreset, columns: number, rows: number): GridRect {
    const half = Math.round(columns / 2)
    const third = Math.round(columns / 3)
    switch (preset) {
        case "viewport": return { x: 0, y: 0, w: columns, h: rows }
        case "left-half": return { x: 0, y: 0, w: half, h: rows }
        case "right-half": return { x: half, y: 0, w: columns - half, h: rows }
        case "left-third": return { x: 0, y: 0, w: third, h: rows }
        case "center-third": return { x: third, y: 0, w: columns - 2 * third, h: rows }
        case "right-third": return { x: columns - third, y: 0, w: third, h: rows }
        case "left-two-thirds": return { x: 0, y: 0, w: columns - third, h: rows }
        case "right-two-thirds": return { x: third, y: 0, w: columns - third, h: rows }
    }
}

export type ShiftMode = "left" | "right" | "center"

// Repack every item horizontally against one edge of its row (or centered),
// preserving each item's row, width and height — only `x` changes. Rows are
// the same y-overlap groups sortLayout uses. Within a row items keep their
// left-to-right order and are packed flush with no gaps, like horizontal
// gravity applied once.
function shiftLayoutHorizontally(
    layout: LayoutItem[],
    mode: ShiftMode,
    columns: number,
): LayoutItem[] {
    const heightSorted = [...layout].sort((a, b) => a.y - b.y)
    const result: LayoutItem[] = []
    let startIdx = 0

    while (result.length < layout.length) {
        const lowestYItem = heightSorted[startIdx]
        const centerY = lowestYItem.y + Math.floor(lowestYItem.h / 2)
        const currentRow: LayoutItem[] = []

        let i = startIdx
        for (; i < heightSorted.length; i++) {
            if (heightSorted[i].y > centerY) break
            currentRow.push(heightSorted[i])
        }
        startIdx = i

        currentRow.sort((a, b) => a.x - b.x)
        const rowWidth = currentRow.reduce((acc, l) => acc + l.w, 0)
        // Left edge of the packed row; clamp so an over-wide row still starts
        // at column 0 rather than going negative
        let x = mode === "left"
            ? 0
            : mode === "right"
                ? Math.max(0, columns - rowWidth)
                : Math.max(0, Math.floor((columns - rowWidth) / 2))
        for (const item of currentRow) {
            result.push({ ...item, x })
            x += item.w
        }
    }
    return result
}

// One-time horizontal gravity: each movable item slides toward the given
// edge until it hits the board border, a non-movable item, or a movable one
// that already settled. Sizes and rows never change, and non-movable items
// never move — which makes the same routine serve both the global shift
// (movable = everything not anchored) and the selection shift (movable =
// the selection, so everything else is an obstacle). Movers are processed
// edge-first so they can't leapfrog each other; within a row that
// preserves their order, since disjoint rects are ordered both by x and by
// their leading edge.
function gravityShiftLayout(
    layout: LayoutItem[],
    dir: "left" | "right",
    columns: number,
    movableKeys: Set<string>,
): LayoutItem[] {
    const settled = layout.filter(l => !movableKeys.has(l.i)).map(l => ({ ...l }))
    const movers = layout.filter(l => movableKeys.has(l.i)).map(l => ({ ...l }))
        .sort((a, b) => dir === "left" ? a.x - b.x : b.x - a.x)
    for (const l of movers) {
        if (dir === "left") {
            let edge = 0
            for (const o of settled) {
                if (o.y < l.y + l.h && l.y < o.y + o.h && o.x + o.w <= l.x) {
                    edge = Math.max(edge, o.x + o.w)
                }
            }
            l.x = edge
        } else {
            let edge = columns
            for (const o of settled) {
                if (o.y < l.y + l.h && l.y < o.y + o.h && o.x >= l.x + l.w) {
                    edge = Math.min(edge, o.x)
                }
            }
            l.x = edge - l.w
        }
        settled.push(l)
    }
    const byKey = new Map(settled.map(l => [l.i, l]))
    return layout.map(l => byKey.get(l.i)!)
}

// Selection-scoped Center: leftward gravity packs the movable items flush
// (same routine as Shift Left, so obstacles between them keep holding them
// apart), then each maximal y-overlap cluster of movers rigidly slides
// right by half its remaining free space. The rigid slide keeps internal
// spacing, the per-mover slack minimum keeps it collision-free, and
// clusters can't interfere with each other (no y-overlap by construction).
// Running it again re-packs left and lands on the same spot — idempotent
// like the other shifts. On a full-row selection of an anchor-free board
// this reproduces the global Center's flush centered row.
function gravityCenterShiftLayout(
    layout: LayoutItem[],
    columns: number,
    movableKeys: Set<string>,
): LayoutItem[] {
    const packed = gravityShiftLayout(layout, "left", columns, movableKeys)
    const movers = packed.filter(l => movableKeys.has(l.i))
    const settled = packed.filter(l => !movableKeys.has(l.i))
    const yOverlap = (a: LayoutItem, b: LayoutItem) =>
        a.y < b.y + b.h && b.y < a.y + a.h
    // Maximal chains: an item overlapping several existing clusters
    // bridges them into one
    const clusters: LayoutItem[][] = []
    for (const mv of movers) {
        const hits = clusters.filter(c => c.some(o => yOverlap(o, mv)))
        if (hits.length === 0) {
            clusters.push([mv])
            continue
        }
        hits[0].push(mv)
        for (const c of hits.slice(1)) {
            hits[0].push(...c)
            clusters.splice(clusters.indexOf(c), 1)
        }
    }
    for (const cluster of clusters) {
        let slack = Infinity
        for (const mv of cluster) {
            let edge = columns
            for (const o of settled) {
                if (yOverlap(o, mv) && o.x >= mv.x + mv.w) edge = Math.min(edge, o.x)
            }
            slack = Math.min(slack, edge - (mv.x + mv.w))
        }
        const dx = Math.floor(slack / 2)
        // gravityShiftLayout returns fresh copies, so mutating in place is
        // safe — `packed` and `movers` share the same objects
        if (dx > 0) for (const mv of cluster) mv.x += dx
    }
    return packed
}

export type MirrorAxis = "horizontal" | "vertical"

// Mirror the arrangement about the centre of the items' bounding box: an item
// spanning [start, start + size] on the mirrored axis moves to
// [min + max - (start + size), ...]. Only the arrangement flips — sizes, and
// the other axis, are untouched. Reflecting within the bounding box (rather
// than the whole grid) keeps the group in place and swaps items, which
// composes with the Shift actions for a grid-wide flip. Vertical mirroring is
// effectively a row swap since the grid re-compacts everything upward.
function mirrorLayoutArrangement(
    layout: LayoutItem[],
    axis: MirrorAxis,
): LayoutItem[] {
    if (layout.length === 0) return layout
    if (axis === "horizontal") {
        const min = Math.min(...layout.map(l => l.x))
        const max = Math.max(...layout.map(l => l.x + l.w))
        return layout.map(l => ({ ...l, x: min + max - (l.x + l.w) }))
    }
    const min = Math.min(...layout.map(l => l.y))
    const max = Math.max(...layout.map(l => l.y + l.h))
    return layout.map(l => ({ ...l, y: min + max - (l.y + l.h) }))
}

function buildLayout(buildData: LayoutBuildData, itemsPerRow: number, restrictToVisible: boolean): LayoutItem[] {
    return buildRowLayout(
        itemsPerRow,
        buildData.sortedLayout.map(l => {
            const [width, height] = croppedDimensions(buildData, l.i)
            return {
                sha256: l.i,
                width,
                height,
            }
        }),
        buildData.grid,
        buildData.columnWidth,
        buildData.containerHeight,
        restrictToVisible,
        minPinUnits(buildData.grid, buildData.columnWidth),
    )
}

function buildRowLayout(
    itemsPerRow: number,
    items: { sha256: string, width: number, height: number }[],
    grid: GridParams,
    columnWidth: number,
    containerHeight: number,
    restrictToVisible = false,
    mins: { minW: number, minH: number } = { minW: 1, minH: 1 },
): LayoutItem[] {
    if (items.length === 0) return []
    const { columns, margin, padding } = grid
    // Minimum width each item in a full row can actually get; an explicit
    // items-per-row beyond that capacity relaxes rather than overflowing
    const effMinW = Math.max(1, Math.min(mins.minW,
        Math.floor(columns / Math.min(itemsPerRow, items.length))))
    // Split the items into rows
    const rows: { sha256: string, width: number, height: number }[][] = []
    for (let i = 0; i < items.length; i += itemsPerRow) {
        rows.push(items.slice(i, i + itemsPerRow))
    }
    // Total grid rows that fit in the container: h grid rows occupy
    // h*rowHeight + (h-1)*margin px, plus the container's own padding
    const totalRowBudget = Math.max(rows.length, Math.floor(
        (containerHeight - 2 * padding + margin) / rowStep(grid)
    ))
    // Give every row the same height budget rather than flooring and handing
    // the remainder to the top rows (which singled out the last row as a grid
    // row shorter). Rounding fills the viewport; when it rounds up the final
    // row simply extends a little past the fold, which reads better than one
    // visibly undersized row.
    const uniformRowBudget = Math.max(1, Math.round(totalRowBudget / rows.length))
    const layout: LayoutItem[] = []
    let currentY = 0
    rows.forEach((row) => {
        const heightBudget = uniformRowBudget
        const ratios = row.map(item => item.width / item.height)
        const totalRatio = ratios.reduce((acc, curr) => acc + curr, 0)
        // Height of the row if it spans all columns with every item at its true aspect
        const naturalHeight =
            (pixelWidth(columns, columnWidth, margin) - (row.length - 1) * margin) / totalRatio
        let targetHeight = naturalHeight
        if (restrictToVisible) {
            const budgetPx = pixelHeight(heightBudget, grid)
            // Too tall to fit at full width: shrink the whole row (narrower
            // boxes at the same aspect) instead of clamping heights, which
            // would letterbox the items
            if (naturalHeight > budgetPx) targetHeight = budgetPx
        }
        // Ideal (fractional) column count per item at the target height
        const idealColumns = ratios.map(ratio =>
            (ratio * targetHeight + margin) / (columnWidth + margin)
        )
        // When the row doesn't fill the width there's room to round every item's
        // column count up, so each image is wide enough to reach the shared row
        // height rather than being left narrow-and-letterboxed. Fall back to
        // proportional apportionment only when the row is width-bound and the
        // columns must be squeezed to fit.
        const ceilColumns = idealColumns.map(v => Math.max(effMinW, Math.ceil(v)))
        const columnCounts = ceilColumns.reduce((acc, curr) => acc + curr, 0) <= columns
            ? ceilColumns
            : apportionColumns(idealColumns, columns, effMinW)
        const usedColumns = columnCounts.reduce((acc, curr) => acc + curr, 0)
        // Center rows that don't span the full width
        let currentX = Math.floor((columns - usedColumns) / 2)
        // Every item in a row shares one height (justified-row layout). Deriving
        // each item's height independently from its rounded column count let
        // siblings disagree, leaving the shorter ones undersized with a gap
        // below. Round the shared target height to grid rows once instead.
        // The restrict-to-visible budget cap deliberately wins over the
        // minimum: fitting the requested rows on screen is a direct order
        let rowGridHeight = Math.max(mins.minH, Math.round((targetHeight + margin) / rowStep(grid)))
        if (restrictToVisible) rowGridHeight = Math.min(rowGridHeight, heightBudget)
        for (let i = 0; i < row.length; i++) {
            layout.push({
                i: row[i].sha256,
                x: currentX,
                y: currentY,
                w: columnCounts[i],
                h: rowGridHeight,
            })
            currentX += columnCounts[i]
        }
        currentY += rowGridHeight
    })
    return layout
}

// Round fractional column shares to integers with largest-remainder
// apportionment, so rounding error is spread out instead of dumped on one
// item. Every item gets at least minEach columns (assumed already capped to
// what maxColumns can give each) and the total stays <= maxColumns.
function apportionColumns(ideal: number[], maxColumns: number, minEach = 1): number[] {
    const total = Math.min(maxColumns, Math.max(
        ideal.length,
        Math.round(ideal.reduce((acc, curr) => acc + curr, 0)),
    ))
    const counts = ideal.map(v => Math.max(minEach, Math.floor(v)))
    let used = counts.reduce((acc, curr) => acc + curr, 0)
    const byRemainder = ideal
        .map((v, i) => ({ i, frac: v - Math.floor(v) }))
        .sort((a, b) => b.frac - a.frac)
    for (let k = 0; used < total; k = (k + 1) % byRemainder.length, used++) {
        counts[byRemainder[k].i]++
    }
    // The minimum can push the total over the cap; take columns back from
    // the widest items until it fits
    while (used > total) {
        let widest = -1
        for (let i = 0; i < counts.length; i++) {
            if (counts[i] > minEach && (widest < 0 || counts[i] > counts[widest])) widest = i
        }
        if (widest < 0) break
        counts[widest]--
        used--
    }
    return counts
}

function findOptimalHeight(
    w: number,
    grid: GridParams,
    columnWidth: number,
    itemWidth: number,
    itemHeight: number,
    minH = 1,
) {
    // Grid rows whose pixel height best matches the item's aspect at this width
    const idealPx = pixelWidth(w, columnWidth, grid.margin) * itemHeight / itemWidth
    return Math.max(minH, Math.round((idealPx + grid.margin) / rowStep(grid)))
}
