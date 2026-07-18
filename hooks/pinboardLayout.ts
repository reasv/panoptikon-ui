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
    evictFromBox,
    groupRowsByOverlap,
    growToFill,
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
    const hasLocks = layout.some(l => isLocked(l.i))

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

    // Locked items inside the target rectangle, as obstacles to pack around
    function lockedObstacles(total: number): GridRect[] {
        return layout
            .filter(l => isLocked(l.i) && l.y < total)
            .map(l => ({ x: l.x, y: l.y, w: l.w, h: l.h }))
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
    }) {
        const buildData = await ensureBuildData()
        if (!buildData) return
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
            if (maxY >= total) return
        }
        const participants = buildData.sortedLayout.filter(l =>
            !isLocked(l.i) && (!visibleOnly || l.y < total))
        if (participants.length === 0) return
        const packedKeys = new Set(participants.map(l => l.i))
        const rest = layout.filter(l => !packedKeys.has(l.i))
        const obstacles = lockedObstacles(total)
        const items = participants.map(l => toPackItem(buildData, l))
        const weights = keepProportions ? participants.map(l => l.w * l.h) : undefined
        const packed = obstacles.length > 0
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
        if (packed.length === 0) return
        const newLayout = [...packed, ...rest]
        onLayoutChange(newLayout,
            verbAutoCrops(buildData, newLayout, packedKeys, layoutAutoCrop), total)
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
    async function fillViewportRows(rowCount: number) {
        const buildData = await ensureBuildData()
        if (!buildData) return
        const total = targetRows(buildData)
        const participants = buildData.sortedLayout.filter(l => !isLocked(l.i))
        if (participants.length === 0) return
        const packedKeys = new Set(participants.map(l => l.i))
        const rest = layout.filter(l => !packedKeys.has(l.i))
        const obstacles = lockedObstacles(total)
        const items = participants.map(l => toPackItem(buildData, l))
        const packed = obstacles.length > 0
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
        if (packed.length === 0) return
        const newLayout = [...packed, ...rest]
        onLayoutChange(newLayout,
            verbAutoCrops(buildData, newLayout, packedKeys, layoutAutoCrop), total)
    }

    // Resize-only: keep the current row groupings and reading order, give
    // each row its natural full-width justified height. Re-emits every row
    // stacked from the top, which cannot hold a locked item in place — so
    // with locks present it must not run.
    async function justifyCurrentRows() {
        if (hasLocks) return
        const buildData = await ensureBuildData()
        if (!buildData) return
        const groups = groupRowsByOverlap(buildData.sortedLayout)
            .map(row => row.map(l => toPackItem(buildData, l)))
        const newLayout = justifyRows({
            groups, grid, columnWidth: buildData.columnWidth,
            ...minPinUnits(grid, buildData.columnWidth),
        })
        onLayoutChange(newLayout,
            verbAutoCrops(buildData, newLayout, new Set(newLayout.map(l => l.i)), layoutAutoCrop))
    }

    // Grow the current arrangement to fill the target rectangle without
    // rearranging: recover the layout's guillotine structure and re-solve
    // sizes only. Arrangements that don't decompose exactly fall back to a
    // row-stack structure INSIDE growToFill — every path goes through the
    // exact-fill emitter, so growing can never come up short of the target
    // (a justify-style fallback here once did, shrinking the board).
    // Structure recovery can't hold a locked rect in place while resizing
    // everything around it, so with locked items inside the target this
    // verb no-ops rather than move them.
    async function growInPlace() {
        const buildData = await ensureBuildData()
        if (!buildData) return
        const total = targetRows(buildData)
        if (layout.some(l => isLocked(l.i) && l.y < total)) return
        const participants = buildData.sortedLayout.filter(l => l.y < total)
        if (participants.length === 0) return
        const packedKeys = new Set(participants.map(l => l.i))
        const rest = layout.filter(l => !packedKeys.has(l.i))
        const arranged: ArrangedItem[] = participants.map(l => ({
            ...toPackItem(buildData, l), x: l.x, y: l.y, w: l.w, h: l.h,
        }))
        const packed = growToFill({
            items: arranged, grid,
            columnWidth: buildData.columnWidth,
            totalGridRows: total,
            ...minPinUnits(grid, buildData.columnWidth),
        })
        if (packed.length === 0) return
        const newLayout = [...packed, ...rest]
        onLayoutChange(newLayout,
            verbAutoCrops(buildData, newLayout, packedKeys, layoutAutoCrop), total)
    }

    // Exchange two items' rects: each fills exactly the void the other
    // leaves, nothing else moves, and the sticky auto-crops absorb the
    // aspect mismatch of the traded cells
    async function swapItems(keyA: string, keyB: string) {
        if (isLocked(keyA) || isLocked(keyB)) return
        const buildData = await ensureBuildData()
        if (!buildData) return
        const a = layout.find(l => l.i === keyA)
        const b = layout.find(l => l.i === keyB)
        if (!a || !b) return
        const newLayout = layout.map(l =>
            l.i === keyA ? { ...l, x: b.x, y: b.y, w: b.w, h: b.h }
                : l.i === keyB ? { ...l, x: a.x, y: a.y, w: a.w, h: a.h }
                    : l)
        onLayoutChange(newLayout,
            verbAutoCrops(buildData, newLayout, new Set([keyA, keyB]), selectionAutoCrop))
    }

    // Mosaic the selected items within their combined bounding box — the
    // box is claimed for the selection. Locked items are never rearranged:
    // selected ones only stretch the box (their spot is part of the region
    // being arranged), and EVERY locked item intersecting the box —
    // selected or not — becomes an obstacle the mosaic packs around.
    // Unselected UNLOCKED items caught inside the box are cleared out first
    // by evictFromBox's local moves (slide sideways / shrink to the edge /
    // drop below the box); whatever can't leave cheaply stays put as an
    // obstacle too. Without the obstacle handling the arrangement would
    // overlap those rects and RGL's compactor would shove the overlapping
    // items apart, scattering the board. (The compactor may still settle
    // the arranged block upward if there is free space above it, as with
    // every arrangement verb.)
    async function arrangeSelection(keys: string[]) {
        const buildData = await ensureBuildData()
        if (!buildData) return
        const keySet = new Set(keys)
        const selectedItems = buildData.sortedLayout.filter(l => keySet.has(l.i))
        const participants = selectedItems.filter(l => !isLocked(l.i))
        if (participants.length < 2) return
        const x0 = Math.min(...selectedItems.map(l => l.x))
        const y0 = Math.min(...selectedItems.map(l => l.y))
        const x1 = Math.max(...selectedItems.map(l => l.x + l.w))
        const y1 = Math.max(...selectedItems.map(l => l.y + l.h))
        const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
        const packedKeys = new Set(participants.map(l => l.i))
        const mins = minPinUnits(grid, buildData.columnWidth)
        const { rest, extraObstacles } = evictFromBox({
            layout, box,
            participantKeys: packedKeys,
            lockedKeys: new Set(layout.filter(l => isLocked(l.i)).map(l => l.i)),
            anchoredKeys: new Set(layout.filter(l => locks[l.i] === "anchor").map(l => l.i)),
            columns: grid.columns,
            ...mins,
        })
        const obstacles = [
            ...layout
                .filter(l => isLocked(l.i)
                    && l.x < x1 && l.x + l.w > x0 && l.y < y1 && l.y + l.h > y0)
                .map(l => ({ x: l.x, y: l.y, w: l.w, h: l.h })),
            ...extraObstacles,
        ]
        const packed = packRegionInBox({
            items: participants.map(l => toPackItem(buildData, l)),
            obstacles,
            grid,
            columnWidth: buildData.columnWidth,
            box,
            variant: mosaicVariant,
            ...mins,
        })
        if (packed.length === 0) return
        const newLayout = [...packed, ...rest]
        onLayoutChange(newLayout,
            verbAutoCrops(buildData, newLayout, packedKeys, selectionAutoCrop))
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
    // One-time horizontal "gravity": slide every item to the left/right/center
    // of its row without resizing. Pure x repacking, so no build data needed.
    // Moves every item in a row, which cannot hold a locked item in place —
    // so with locks present it must not run (same for mirror below).
    function shiftLayout(mode: ShiftMode) {
        if (hasLocks) return
        onLayoutChange(shiftLayoutHorizontally(layout, mode, grid.columns))
    }
    // Mirror the arrangement (not the images) about the centre of the items'
    // own bounding box, so the group stays put and items swap places. A
    // grid-wide flip is this plus a Shift. Vertical is inherently swap-only:
    // the grid re-compacts upward, so the mirrored rows just settle back.
    function mirrorLayout(axis: MirrorAxis) {
        if (hasLocks) return
        onLayoutChange(mirrorLayoutArrangement(layout, axis))
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
        mirrorLayout,
        rerollLayout,
        refitToView,
        reflowKeepProportions,
        growInPlace,
        swapItems,
        arrangeSelection,
        autoCropSelection,
        // Whether any item is locked — the menu greys out the verbs that
        // no-op with locks present
        hasLocks,
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
