"use client"
import type { LayoutItem } from "react-grid-layout";
import { fetchClient } from "@/lib/api";
import { components } from "@/lib/panoptikon";
import { RefObject, useEffect, useRef } from "react";
import {
    AUTO_CROP_MAX_LETTERBOX_PX,
    CropRect,
    OrientationOp,
    PinLock,
    PinOrientation,
    composeCrops,
    composeOrientation,
    computeAutoCrop,
    isIdentityOrientation,
    orientRect,
    orientedSize,
} from "@/lib/pinboardCrop";
import { GridParams, minPinUnits, rowStep } from "@/lib/pinboardGrid";
import { resolveOverlapsDown } from "@/lib/pinboardOverlap";
import { fastVerticalCompactor } from "react-grid-layout/extras";
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
    nearestUniformIndex,
    packMosaic,
    packRegion,
    packRegionInBox,
    packRows,
    packRowsAroundObstacles,
    packUniform,
    packUniformInBox,
    rankUniformFactorizations,
} from "@/lib/pinboardPack";

// Session-wide reroll counter: every fill-type action renders the variant
// this counter selects, so a rerolled composition is what later auto-fills
// continue from instead of snapping back to variant 0. Module-level on
// purpose — the hook is instantiated once per pin menu plus once for the
// board, and they must agree.
let mosaicVariant = 0

// The uniform packer's counterpart of mosaicVariant: the cell ASPECT the
// last uniform reroll chose, which later uniform fills track by picking
// the nearest feasible factorization — never a rank index, which a
// different item count would teleport (see rankUniformFactorizations).
// Null until a reroll chooses; module-level for the same reason as above.
let uniformAspect: number | null = null

// The aspect the last committed uniform fill actually used (its best-scored
// pick when no reroll has chosen): the reroll's starting point, so a reroll
// advances from what's on screen — not from the ranking's head, which would
// skip the best factorization when uniform has never been shown yet.
let uniformShownAspect: number | null = null

// Default for the optional `orients` param. Module-scope because it sits in
// the build-data invalidation deps below: an inline `= {}` default would be
// a fresh object every render, so any caller omitting the param would throw
// away the cached measurements on every render.
const NO_ORIENTS: Record<string, PinOrientation | null> = Object.freeze({})

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
    orients = NO_ORIENTS,
    highWater = 0,
    float = false,
    uniform = false,
    cropKey = null,
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
    // Per-item D4 orientations. The whole of this file works in DISPLAY
    // space (crops are stored there too), so orientation enters only by
    // swapping the natural dimensions of odd quarter turns — see
    // croppedDimensions, which every fit, pack and resize path reads from.
    orients?: Record<string, PinOrientation | null>,
    // The board's layout-height ratchet in grid rows (see pinboardGrid.ts)
    highWater?: number,
    // Gravity OFF (the token's float switch): RGL's compactor is not
    // running, so the verbs that grow an item's footprint must resolve the
    // collisions they create themselves — see resolveGrowth.
    float?: boolean,
    // The board's auto-layout algorithm (the token's uniform switch): the
    // fill-type verbs and the auto-layout trigger tile identical cells
    // instead of composing a mosaic. The explicit Uniform verbs force the
    // uniform packer regardless.
    uniform?: boolean,
    // The board's open crop item, if any. A verb fired from another pin
    // mid-session must never move the crop window, so with gravity off it
    // enters the overlap resolution as an immovable wall (with gravity on
    // the board's own crop-mode compaction does that job).
    cropKey?: string | null,
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
    // given, updates the board's ratchet in that same write.
    // orientationOverrides/manualCropOverrides are the same mechanism for
    // the remaining two hField slots — the orientation verbs need all four
    // in ONE write, since a rotation changes the geometry AND both crop
    // rects AND the orientation, and two record writes in a tick clobber
    // each other (see rebuildRecords in GalleryPinBoard).
    // history overrides the write's history mode; only doFill's callers
    // reach it (see its `history` option). Omitted everywhere else, which
    // means push — a verb the user invoked is its own undo step.
    onLayoutChange: (
        layout: LayoutItem[],
        autoCropOverrides?: Record<string, CropRect | null>,
        newHighWater?: number,
        orientationOverrides?: Record<string, PinOrientation | null>,
        manualCropOverrides?: Record<string, CropRect | null>,
        history?: "push" | "replace",
    ) => void,
}) {
    const layoutBuildData = useRef<LayoutBuildData | null>(null)
    useEffect(() => {
        layoutBuildData.current = null
    }, [layout, crops, orients, dbs, grid])

    // Cached build data, or null when the container can't be measured (in
    // which case layout actions no-op rather than destroy the arrangement)
    async function ensureBuildData(): Promise<LayoutBuildData | null> {
        if (!layoutBuildData.current) {
            layoutBuildData.current = await getLayoutBuildData({ layout, crops, orients, dbs, grid, pinboardRef })
        }
        return layoutBuildData.current
    }

    // The gravity-off completion of a footprint-growing verb (Resize Item /
    // Set Size, the rotations' box swap). With gravity ON this is identity:
    // RGL's compactor resolves the overlaps the new footprint creates, which
    // is what those verbs have always relied on. With it OFF nothing does,
    // so the colliders are pushed down here instead (see pinboardOverlap).
    // The changed boxes are clamped into the grid first: RGL's own
    // correctBounds would otherwise slide an over-wide box left AFTER this
    // pass, straight into a neighbour nothing would then move.
    // An open crop session pins its own item: with gravity on the crop-mode
    // block in GalleryPinBoard's onLayoutChange walls it off for the same
    // reason, and with gravity off that block is skipped, so the wall has to
    // come from here.
    function resolveGrowth(newLayout: LayoutItem[], changedKeys: string[]): LayoutItem[] {
        if (!float) return newLayout
        const changed = new Set(changedKeys)
        const clamped = newLayout.map(l => {
            if (!changed.has(l.i)) return l
            const w = Math.min(l.w, grid.columns)
            const x = Math.max(0, Math.min(l.x, grid.columns - w))
            return w === l.w && x === l.x ? l : { ...l, x, w }
        })
        return resolveOverlapsDown(clamped, changed, cropKey ? [cropKey] : undefined)
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
    // so that items parked below the fold can't compact up into view.
    // Takes the raw container height rather than build data: the removal
    // verbs need this line synchronously, and ensureBuildData is an async
    // metadata fetch a record splice has no use for.
    function foldRows(containerHeight: number): number {
        return Math.max(1, Math.floor(
            (containerHeight - 2 * grid.padding + grid.margin) / rowStep(grid)
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
    function targetRows(containerHeight: number): number {
        return Math.max(foldRows(containerHeight), highWater)
    }

    // Keys of the items parked below the board's working area — the staging
    // band evictions and region sends push things into. The line is the fill
    // target (fold or ratchet, whichever is deeper): using the ratchet keeps
    // the cut conservative on a window smaller than the one the board was
    // laid out for. "Mostly below" is the vertical midpoint STRICTLY past
    // the line, so an item the line bisects survives. Null when the
    // container can't be measured (hidden tab, unmounted scroll area) —
    // callers disable the verb rather than compute against a 0px viewport.
    // Locks are ignored: a lock pins geometry, not existence.
    function belowViewportKeys(): string[] | null {
        const containerHeight = pinboardRef.current?.clientHeight || 0
        if (containerHeight < 100) return null
        const line = targetRows(containerHeight)
        return layout
            .filter(l => !l.i.endsWith("__preview") && l.y + l.h / 2 > line)
            .map(l => l.i)
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
        algorithm,
        advanceUniform = false,
        history,
    }: {
        visibleOnly?: boolean,
        skipIfCovered?: boolean,
        // Aim each item at its CURRENT share of the board area instead of
        // uniform shares: reflow freely, keep the proportions the user made
        keepProportions?: boolean,
        // Refit to the current view: target the fold even when the ratchet
        // is higher, and lower the ratchet to it
        resetRatchet?: boolean,
        // The packer to fill with; absent means the board's algorithm flag
        // decides. The explicit Uniform verb is the one caller that forces
        // a value.
        algorithm?: "mosaic" | "uniform",
        // Reroll on a uniform fill: advance the session's sticky cell
        // aspect to the next ranked factorization before packing (the
        // uniform counterpart of bumping mosaicVariant — done in here
        // because the ranking needs the fill's own measured inputs)
        advanceUniform?: boolean,
        // History mode for the resulting record write. Default (push) is
        // right for every fill the user asked for — it is its own undo
        // step. "replace" is for a fill that merely FOLLOWS someone else's
        // structural write and belongs in that write's history entry: this
        // fill is async (it awaits a metadata fetch), so nuqs cannot merge
        // it with the write that triggered it, and a push would park a
        // second entry between the user and the board they want back.
        history?: "push" | "replace",
    }): Promise<string | null> {
        const buildData = await ensureBuildData()
        if (!buildData) return null
        const total = resetRatchet ? foldRows(buildData.containerHeight) : targetRows(buildData.containerHeight)
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
        const mins = minPinUnits(grid, buildData.columnWidth)
        const algo = algorithm ?? (uniform ? "uniform" : "mosaic")
        let packed: LayoutItem[]
        if (items.length === 0) {
            packed = []
        } else if (algo === "uniform") {
            // Identical cells, flowing around the obstacle rects by
            // skipping their cells. Weights don't apply — every cell is
            // the same by definition, so "keep proportions" has nothing
            // to keep here.
            const ranked = rankUniformFactorizations({
                items, obstacles, grid,
                columnWidth: buildData.columnWidth,
                totalGridRows: total, ...mins,
            })
            if (advanceUniform && ranked.length > 0) {
                // Advance from whatever is on screen: the reroll choice if
                // one exists, else the last uniform fill's own pick. With
                // neither (the flag was just flipped over a mosaic
                // arrangement) the first reroll must show the best-scored
                // factorization, not skip past it to the runner-up.
                const base = uniformAspect ?? uniformShownAspect
                uniformAspect = base == null
                    ? ranked[0].cellAspect
                    : ranked[(nearestUniformIndex(ranked, base) + 1)
                        % ranked.length].cellAspect
            }
            packed = packUniform({
                items, obstacles, grid,
                columnWidth: buildData.columnWidth,
                totalGridRows: total,
                chosenAspect: uniformAspect, ...mins,
            })
            if (packed.length > 0 && ranked.length > 0) {
                uniformShownAspect = ranked[uniformAspect == null
                    ? 0 : nearestUniformIndex(ranked, uniformAspect)].cellAspect
            }
        } else {
            packed = obstacles.length > 0
                ? packRegion({
                    items, obstacles, grid,
                    columnWidth: buildData.columnWidth,
                    totalGridRows: total,
                    variant: mosaicVariant, weights, ...mins,
                })
                : packMosaic({
                    items, grid,
                    columnWidth: buildData.columnWidth,
                    totalGridRows: total,
                    fill: rest.length > 0 ? "force" : "auto",
                    variant: mosaicVariant, weights, ...mins,
                })
        }
        // A packer that can't produce a composition returns [] — committing
        // that would erase the packed items' records (rebuildRecords drops
        // records absent from the reported layout). No layout beats data loss.
        if (items.length > 0 && packed.length === 0) {
            return algo === "uniform"
                ? "Couldn't fit identical cells at the minimum item size"
                : "Couldn't fill the viewport around the fixed items"
        }
        const newLayout = [...packed, ...placement.placed, ...rest]
        onLayoutChange(newLayout,
            verbAutoCrops(buildData, newLayout,
                new Set(participants.map(l => l.i)), layoutAutoCrop), total,
            undefined, undefined, history)
        return null
    }

    function fillViewport(
        visibleOnly: boolean,
        skipIfCovered = false,
        history?: "push" | "replace",
    ) {
        return doFill({ visibleOnly, skipIfCovered, history })
    }

    // The one-shot uniform fill: Fill Viewport's semantics exactly, with
    // the uniform packer forced regardless of the board's algorithm flag
    function uniformLayout() {
        return doFill({ algorithm: "uniform" })
    }

    // Cycle to the next distinct near-best composition and re-fill with
    // whatever algorithm the board flag selects. The choice is
    // session-wide either way — mosaicVariant, or the uniform cell aspect
    // (advanced inside doFill, where the ranking's inputs live) — so
    // subsequent auto-fills keep the chosen variant instead of snapping
    // back to the first one.
    function rerollLayout() {
        if (uniform) return doFill({ advanceUniform: true })
        mosaicVariant++
        return doFill({})
    }

    // Reset the ratchet to the current viewport and fill it — the explicit
    // opt-out for a board that moved to a smaller screen for good
    function refitToView() {
        return doFill({ resetRatchet: true })
    }

    // Reflow freely but aim every item at its current share of the board:
    // importance is expressed by how you've already sized things. Always
    // mosaic, even on a uniform board: identical cells have no proportions
    // to keep, so routing by the flag would silently turn this verb into a
    // plain uniform fill.
    function reflowKeepProportions() {
        return doFill({ keepProportions: true, algorithm: "mosaic" })
    }

    // "Split the space evenly among N rows" — explicitly row-based. With
    // locked items on the board the rows instead flow around them like text
    // around floats (the packer chooses row counts per free segment; the
    // requested count doesn't survive that geometry).
    async function fillViewportRows(rowCount: number): Promise<string | null> {
        const buildData = await ensureBuildData()
        if (!buildData) return null
        const total = targetRows(buildData.containerHeight)
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
        const total = targetRows(buildData.containerHeight)
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

    // Uniform the selected items within their combined bounding box:
    // arrangeSelection's exact structure — the box is claimed, intruders
    // are evicted or become obstacles, anchored selected items hold still,
    // size-locked ones travel — with the uniform packer splitting the box
    // into identical cells instead of the mosaic. The box is never grown:
    // cells below the minimum size refuse, the standard "couldn't fill"
    // path. The session's rerolled cell aspect deliberately doesn't apply
    // — that stickiness belongs to the fills.
    async function uniformSelection(keys: string[]): Promise<string | null> {
        const buildData = await ensureBuildData()
        if (!buildData) return null
        const keySet = new Set(keys)
        const selectedItems = buildData.sortedLayout.filter(l => keySet.has(l.i))
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
        const placement = placeTravellers(travellers, box, baseObstacles,
            l => ({ x: l.x, y: l.y }))
        if (typeof placement === "string") return placement
        const packed = participants.length > 0
            ? packUniformInBox({
                items: participants.map(l => toPackItem(buildData, l)),
                obstacles: [...baseObstacles, ...placement.rects],
                grid,
                columnWidth: buildData.columnWidth,
                box,
                ...mins,
            })
            : []
        if (participants.length > 0 && packed.length === 0) {
            return "Couldn't fit identical cells in the selection's area — the items would go below the minimum size"
        }
        const newLayout = [...packed, ...placement.placed, ...rest]
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
        const total = targetRows(buildData.containerHeight)
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

    // Move-to-Hole commit: place the selection into an explicit free rect
    // chosen by the targeting overlay. Same semantics as a region send with
    // the box handed in — except no eviction: the overlay only offers rects
    // that are free of non-selected items (the selection itself counts as
    // lifted), so anything intersecting the box here is a stale-mask
    // straggler and is flowed around as an obstacle rather than moved.
    // The rect is local, so the write never moves the height ratchet.
    async function sendSelectionToRect(
        keys: string[], box: GridRect,
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
        const sizeLocked = selectedItems.filter(l => isSizeLocked(l.i))
        const flexible = selectedItems.filter(l => !isLocked(l.i))
        const overlapping = (a: GridRect, b: GridRect) =>
            a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        const rest = layout.filter(l => !keySet.has(l.i))
        const obstacles = rest
            .filter(l => overlapping({ x: l.x, y: l.y, w: l.w, h: l.h }, box))
            .map(l => ({ x: l.x, y: l.y, w: l.w, h: l.h }))
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
            return "Couldn't fit the selection into that hole — try a bigger one"
        }
        const newLayout = [...packed, ...placedItems, ...rest]
        onLayoutChange(newLayout,
            verbAutoCrops(buildData, newLayout,
                new Set(flexible.map(l => l.i)), selectionAutoCrop))
        return null
    }

    // Commit one gesture of the Scale & Move session: the board hands in
    // the snapped grid rects for the selected items, computed from the
    // overlay's continuous transform. The rects are trusted geometry — the
    // session already clamped them into the board's columns and above the
    // snap-proof minimum size — so this verb only resolves the collisions
    // the new footprints create and maintains the members' auto crops.
    // Locks never reach here: the session refuses to open over anchored
    // or size-locked items.
    async function transformSelection(
        keys: string[], rects: Record<string, GridRect>,
    ): Promise<string | null> {
        const keySet = new Set(keys)
        const buildData = await ensureBuildData()
        if (!buildData) return null
        let changed = false
        const newLayout = layout.map(l => {
            const r = rects[l.i]
            if (!r || !keySet.has(l.i)) return l
            if (r.x === l.x && r.y === l.y && r.w === l.w && r.h === l.h) return l
            changed = true
            return { ...l, x: r.x, y: r.y, w: r.w, h: r.h }
        })
        if (!changed) return null
        // Collision resolution follows the board's physics. Gravity OFF:
        // push what the group now overlaps straight down, like every other
        // footprint-growing verb (resolveGrowth). Gravity ON, two stages:
        // first the same eviction pass (bystanders the group now overlaps
        // drop below it), THEN the full skyline settle — because RGL
        // re-runs its compactor on every layout sync, so whatever this
        // verb writes is going to be settled, and settling it HERE with
        // the same compactor makes the write the fixed point the board
        // will display. Neither stage alone survives contact with RGL:
        // committing raw rects lets RGL's own pass resolve the overlaps,
        // and compacting WITHOUT evicting first does the same thing that
        // pass would — both process items in original-y order, so a
        // bystander the group grew over settles into the vacated space
        // before the group's lower members are placed, and those members
        // then yield to IT: the bystander wedges into the group's span
        // and the group tears apart ("items rearrange after release").
        // Evicted first, it starts below the whole group and the settle
        // lands it at the group's bottom edge instead. Anchors enter both
        // stages as immovable statics (the layout rows carry their
        // flags), and no correctBounds pass is needed: the board's snap
        // already clamped the rects into the columns.
        const resolved = float
            ? resolveGrowth(newLayout, keys)
            : [...fastVerticalCompactor.compact(
                resolveOverlapsDown(newLayout, keys), grid.columns)]
        // Auto-crop maintenance: with the selection toolbar's auto-crop
        // toggle on, re-fit every member to its new cell like the other
        // selection verbs do. With it off, a member that already carries a
        // fit-to-cell crop gets that crop RE-FIT rather than dropped: the
        // gesture-resize rule (drop the stale crop, let the true image
        // letterbox) reads here as members shrinking in one direction for
        // no reason, since a group scale barely changes the cell's aspect.
        // Members that never had an auto crop keep their natural
        // letterbox, exactly as it looked before the scale.
        let overrides: Record<string, CropRect | null>
        if (selectionAutoCrop) {
            overrides = verbAutoCrops(buildData, resolved, keySet, true)
        } else {
            overrides = {}
            const oldSize = new Map(layout.map(l => [l.i, `${l.w}x${l.h}`]))
            for (const l of resolved) {
                if (!keySet.has(l.i) || !autoCrops[l.i]) continue
                if (oldSize.get(l.i) === `${l.w}x${l.h}`) continue
                const next = autoCropForCell(buildData, l.i, l.w, l.h)
                if (next !== undefined) overrides[l.i] = next
            }
        }
        onLayoutChange(resolved, overrides)
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
        const newLayout = resolveGrowth(layout.map(l => {
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
        }), [layoutKey])
        // An explicit size command is gesture-like: it does not re-fit, it
        // just drops the auto crop its own resize made stale
        onLayoutChange(newLayout, verbAutoCrops(buildData, newLayout, new Set(), false))
    }
    async function setItemSize(layoutKey: string, size: number) {
        if (isLocked(layoutKey)) return
        const buildData = await ensureBuildData()
        if (!buildData) return
        const { minW, minH } = minPinUnits(grid, buildData.columnWidth)
        const newLayout = resolveGrowth(layout.map(l => {
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
        }), [layoutKey])
        onLayoutChange(newLayout, verbAutoCrops(buildData, newLayout, new Set(), false))
    }

    // ---- Orientation (rotate / flip) ----------------------------------
    //
    // The three hField slots an orientation change touches, collected for
    // one write. Both crop slots are ALWAYS emitted for every key touched:
    // rebuildRecords reads the manual slot's presence as "the base moved",
    // and the explicit auto entry is what tells it the auto crop travelled
    // with it instead of going stale.
    interface OrientOverrides {
        orient: Record<string, PinOrientation | null>
        manual: Record<string, CropRect | null>
        auto: Record<string, CropRect | null>
    }

    // Carry one item through a sequence of user ops: the orientation
    // composes, and each crop slot is remapped through the SAME op so the
    // region it selects keeps framing the same content (a flip happens
    // inside the crop window, not behind it). The two slots are remapped
    // INDEPENDENTLY and never as their composition — composeCrops clamps at
    // MIN_CROP_FRAC, so remapping the composite is not the same map for
    // sub-2% composites. The auto slot's rect is expressed in the manual
    // window's own normalized frame, where the op is the identical map.
    function orientOne(key: string, ops: OrientationOp[], out: OrientOverrides) {
        let orient = orients[key] ?? null
        let manual = crops[key] ?? null
        let auto = autoCrops[key] ?? null
        for (const op of ops) {
            orient = composeOrientation(orient, op)
            if (manual) manual = orientRect(manual, op)
            if (auto) auto = orientRect(auto, op)
        }
        out.orient[key] = isIdentityOrientation(orient) ? null : orient
        out.manual[key] = manual
        out.auto[key] = auto
    }
    const emptyOrientOverrides = (): OrientOverrides =>
        ({ orient: {}, manual: {}, auto: {} })

    // The op sequence that returns an orientation to identity, built by
    // construction rather than by inverting the D4 closed form: undo the
    // mirror first (flipH is self-inverse and leaves the stored
    // quarterTurns alone), then unwind the turns one user-level "rotate
    // left" at a time. Each step is a real user op, so the crop rects can
    // ride the same sequence through orientRect and land exactly where a
    // manual undo would have put them.
    function inverseOps(o: PinOrientation): OrientationOp[] {
        const ops: OrientationOp[] = []
        let cur: PinOrientation = o
        if (cur.flipped) {
            ops.push("flipH")
            cur = composeOrientation(cur, "flipH")
        }
        while (cur.quarterTurns !== 0) {
            ops.push("ccw")
            cur = composeOrientation(cur, "ccw")
        }
        return ops
    }

    // A quarter turn swaps the box's PIXEL dimensions, not its grid units
    // (columns and rows have different pixel scales): the new column span is
    // the one whose pixel width best matches the current pixel height, and
    // the new row span the one whose pixel height best matches the current
    // pixel width. Taken unclamped that is a GENUINE pixel swap, which is
    // exactly what keeps the remapped auto crop an exact fit — the cell
    // shape rotates with the content, so the cell that framed the crop
    // before still frames the turned crop after. Re-deriving the height from
    // an aspect instead would be wrong for every item whose cell does not
    // match its base aspect (auto-cropped items — the default-on path — and
    // hand-letterboxed ones): it strands the remapped crop in a wrong-shaped
    // cell, letterboxed and with a jumped footprint. The aspect path is only
    // the FALLBACK for when the width clamps (board narrower than the former
    // height, or the min-pin floor) and the swap is unattainable: then
    // findOptimalHeight restores the aspect at the clamped width. That
    // aspect is the turned one — the natural dims swap with the quarter turn
    // AND the manual crop's w/h swap with it (orientRect), so the product's
    // factors just trade places; that is why the fallback can read the OLD
    // stored maps through croppedDimensions and pass them in ch/cw order and
    // still be exact. x/y are kept: RGL's compactor resolves the footprint
    // change, pushing neighbors down as it does for a resize — or, with
    // gravity off, resolveGrowth does it in the compactor's stead.
    function turnedBox(
        buildData: LayoutBuildData,
        l: LayoutItem,
        minW: number,
        minH: number,
    ): { w: number, h: number } {
        const [cw, ch] = croppedDimensions(buildData, l.i)
        const wantW = Math.round(
            (pixelHeight(l.h, grid) + grid.margin)
            / (buildData.columnWidth + grid.margin)
        )
        const newW = Math.min(grid.columns, Math.max(minW, wantW))
        return {
            w: newW,
            h: newW === wantW
                ? Math.max(minH, Math.round(
                    (pixelWidth(l.w, buildData.columnWidth, grid.margin) + grid.margin)
                    / rowStep(grid)))
                : findOptimalHeight(newW, grid, buildData.columnWidth, ch, cw, minH),
        }
    }

    // Turning ops resize the box, so they follow Resize Item's lock rule;
    // flips move nothing and are allowed on locked items.
    const isTurn = (op: OrientationOp) => op === "cw" || op === "ccw"

    // Commit an orientation change: the geometry (unchanged for flips) and
    // all three record slots in ONE write. `turnKeys` non-empty means the
    // boxes of those keys swap their pixel dimensions, which needs the
    // measured column width — unmeasurable container means no write at all,
    // like every other geometry verb.
    async function commitOrientation(
        out: OrientOverrides,
        turnKeys: string[],
    ): Promise<void> {
        if (turnKeys.length === 0) {
            onLayoutChange(layout, out.auto, undefined, out.orient, out.manual)
            return
        }
        const buildData = await ensureBuildData()
        if (!buildData) return
        const { minW, minH } = minPinUnits(grid, buildData.columnWidth)
        const turning = new Set(turnKeys)
        const newLayout = resolveGrowth(layout.map(l => turning.has(l.i)
            ? { ...l, ...turnedBox(buildData, l, minW, minH) }
            : l), turnKeys)
        onLayoutChange(newLayout, out.auto, undefined, out.orient, out.manual)
    }

    // Rotate or flip a single item's IMAGE. Silent no-op on a locked item
    // for the turning ops (the menu greys them; the guard is what makes the
    // rule hold for any other caller).
    async function orientItem(layoutKey: string, op: OrientationOp): Promise<void> {
        if (isTurn(op) && isLocked(layoutKey)) return
        const out = emptyOrientOverrides()
        orientOne(layoutKey, [op], out)
        await commitOrientation(out, isTurn(op) ? [layoutKey] : [])
    }

    // Back to the stored image, crops included. The box turns back only
    // when the orientation held an odd number of quarter turns — a 180 or a
    // bare mirror leaves the aspect alone — so that is also the only case
    // a lock can block.
    async function resetOrientation(layoutKey: string): Promise<void> {
        const current = orients[layoutKey] ?? null
        if (isIdentityOrientation(current)) return
        const turns = current!.quarterTurns % 2 === 1
        if (turns && isLocked(layoutKey)) return
        const out = emptyOrientOverrides()
        orientOne(layoutKey, inverseOps(current!), out)
        await commitOrientation(out, turns ? [layoutKey] : [])
    }

    // The same over a selection, one write for the whole group. Flips are
    // per-item, geometry-free and self-inverse, so they apply regardless of
    // locks. Rotation resizes every box, so a locked member makes it refuse
    // outright ("atomic or not at all", the placeTravellers convention) —
    // turning only part of the group would be the footgun the region-send
    // refusal already guards against.
    async function orientSelection(
        keys: string[], op: OrientationOp,
    ): Promise<string | null> {
        const keySet = new Set(keys)
        const items = layout.filter(l => keySet.has(l.i))
        if (items.length === 0) return null
        const turning = isTurn(op)
        if (turning) {
            const locked = items.filter(l => isLocked(l.i)).length
            if (locked > 0) {
                return locked === 1
                    ? "A locked item is selected — unlock or deselect it first"
                    : `${locked} locked items are selected — unlock or deselect them first`
            }
        }
        const out = emptyOrientOverrides()
        for (const l of items) orientOne(l.i, [op], out)
        await commitOrientation(out, turning ? items.map(l => l.i) : [])
        return null
    }

    // Fit every item (or only those starting above the fold) to its current
    // cell by writing its auto-crop slot. Near-fits (>= 98% of the base)
    // get null. The geometry is untouched: the current layout plus the
    // overrides map goes through the same atomic mechanism as the layout
    // actions.
    async function autoCropToCells(visibleOnly: boolean) {
        const buildData = await ensureBuildData()
        if (!buildData) return
        const total = foldRows(buildData.containerHeight)
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
        let bottom = Math.max(targetRows(buildData.containerHeight), y1)
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

    // ---- Compress ------------------------------------------------------
    //
    // Effective content size in DISPLAY (oriented) space: the oriented
    // natural dimensions scaled by the EFFECTIVE crop — the manual rebase
    // COMPOSED with the auto slot. croppedDimensions deliberately excludes
    // the auto crop (it is derived from cell sizes, so feeding it back would
    // make every layout action see the previous one's output as truth), but
    // the letterbox test asks a different question: what is on screen in
    // this cell right now. An auto-cropped item fills its cell exactly, and
    // reading it through the composition is what makes compress leave it
    // alone. Null when the natural dimensions are unknown (metadata fetch
    // failed): croppedDimensions' 1:1 fallback would read as letterboxing in
    // every non-square cell and trigger a resize the user never asked for,
    // so such an item is skipped instead of guessed at.
    function effectiveDimensions(
        buildData: LayoutBuildData, key: string,
    ): [number, number] | null {
        const item = buildData.metadata[key]?.item
        if (!item?.width || !item?.height) return null
        const [w, h] = orientedSize(item.width, item.height, buildData.orients[key])
        // autoCrops is read from the hook's props, not from buildData (which
        // caches only the manual slot) — always the live map
        const eff = composeCrops(buildData.crops[key] ?? null, autoCrops[key] ?? null)
        return [w * (eff?.w ?? 1), h * (eff?.h ?? 1)]
    }

    // Whether compressedSpan can measure this item at all. It returns null
    // for two different reasons — "no letterbox on this axis" and "no usable
    // natural dimensions" — and only the caller's refusal message needs to
    // tell them apart, so the unmeasurable case is probed separately rather
    // than widening compressedSpan's return type.
    function measurable(buildData: LayoutBuildData, key: string): boolean {
        const eff = effectiveDimensions(buildData, key)
        return !!eff && eff[0] > 0 && eff[1] > 0
    }

    // The un-letterboxed span of one axis in grid units, or null when there
    // is nothing to remove there. The bar width is `cell - content` at the
    // contain-fit size, so a NEGATIVE difference (cell tighter than the
    // content on this axis — bars on the other one) fails the threshold test
    // too: compress only ever shrinks, it never grows a box back. Bars
    // thinner than AUTO_CROP_MAX_LETTERBOX_PX are ignored for the same
    // reason computeAutoCrop refuses to crop them, and sub-grid-unit bars
    // round away through the [min, current] clamp.
    function compressedSpan(
        buildData: LayoutBuildData,
        l: LayoutItem,
        axis: "w" | "h",
        minW: number,
        minH: number,
    ): number | null {
        const eff = effectiveDimensions(buildData, l.i)
        if (!eff) return null
        const [effW, effH] = eff
        if (!(effW > 0) || !(effH > 0)) return null
        const aspect = effW / effH
        const cellW = pixelWidth(l.w, buildData.columnWidth, buildData.grid.margin)
        const cellH = pixelHeight(l.h, buildData.grid)
        if (axis === "w") {
            // Vertical bars: the contain-fit is height-bound, so the content
            // spans aspect * cellH px and the rest is letterbox
            const targetPx = aspect * cellH
            if (cellW - targetPx < AUTO_CROP_MAX_LETTERBOX_PX) return null
            const w = Math.min(l.w, Math.max(minW, Math.round(
                (targetPx + buildData.grid.margin) / (buildData.columnWidth + buildData.grid.margin))))
            return w < l.w ? w : null
        }
        const targetPx = cellW / aspect
        if (cellH - targetPx < AUTO_CROP_MAX_LETTERBOX_PX) return null
        const h = Math.min(l.h, Math.max(minH, Math.round(
            (targetPx + buildData.grid.margin) / rowStep(buildData.grid))))
        return h < l.h ? h : null
    }

    // Shrink each letterboxed selected item on one axis and keep the result
    // compact — gap PRESERVATION, not gravity: nothing is re-homed, each
    // mover keeps the distance it had toward the compression direction and
    // simply follows whatever shrank ahead of it. Nothing outside the
    // selection ever moves (the shiftSelection contract). Anchored selected
    // items neither move nor resize and stay obstacles; size-locked ones
    // take the push but not the resize (a move is inside their contract).
    async function compressSelection(
        keys: string[], dir: CompressDir,
    ): Promise<string | null> {
        const buildData = await ensureBuildData()
        if (!buildData) return null
        const keySet = new Set(keys)
        const selectedItems = buildData.sortedLayout.filter(l => keySet.has(l.i))
        if (selectedItems.length === 0) return null
        const { minW, minH } = minPinUnits(grid, buildData.columnWidth)
        const movers = selectedItems.filter(l => !isAnchored(l.i))
        if (movers.length === 0) {
            return selectedItems.length === 1
                ? "The selected item is anchored — unanchor it to compress it"
                : "Every selected item is anchored — unanchor one to compress them"
        }
        // Only cells that actually changed size need crop maintenance; a
        // pushed-but-unresized item's stored auto crop is still exact
        const resized = new Set<string>()
        // Size-locked items that WOULD have shrunk: the difference between
        // "nothing here is letterboxed" and "the locks are in the way"
        let blocked = 0
        // Items whose natural dimensions aren't known yet (metadata still in
        // flight or the fetch failed). They can't be tested for letterboxing
        // at all, so reporting "nothing is letterboxed" would be a lie the
        // user can't act on — a retry once metadata lands is the real advice.
        let unknown = 0
        // Refusal priority, most actionable first: a lock the user can
        // release beats a wait, and both beat the generic no-op message.
        // (The all-anchored case returns earlier, ahead of all three.)
        const refusal = () => blocked > 0
            ? (blocked === 1
                ? "A letterboxed item in the selection is size-locked — unlock it to compress it"
                : `${blocked} letterboxed items in the selection are size-locked — unlock one to compress them`)
            : unknown > 0
                ? (unknown === 1
                    ? "Couldn't measure a selected item — try again once its metadata loads"
                    : `Couldn't measure ${unknown} selected items — try again once their metadata loads`)
                : "Nothing in the selection is letterboxed that way"
        const byKey = new Map<string, LayoutItem>()
        if (dir === "up") {
            // Height shrink only, y untouched: the board's vertical
            // compactor pulls everything up into the freed rows by itself,
            // so gap bookkeeping here would only fight it. That is also why
            // there is no Compress Down — the engine maintains vertical
            // adjacency in one direction.
            for (const l of movers) {
                if (!measurable(buildData, l.i)) { unknown++; continue }
                const h = compressedSpan(buildData, l, "h", minW, minH)
                if (h === null) continue
                if (isSizeLocked(l.i)) { blocked++; continue }
                byKey.set(l.i, { ...l, h })
                resized.add(l.i)
            }
            if (resized.size === 0) return refusal()
            const newLayout = layout.map(l => byKey.get(l.i) ?? l)
            const overrides =
                verbAutoCrops(buildData, newLayout, resized, selectionAutoCrop)
            // COMPRESS EXEMPTION from the stale-crop rule. With the setting
            // OFF verbAutoCrops drops the auto crop of every cell whose size
            // changed, on the premise that a crop fitted to the old cell is
            // now wrong. That premise is false for the cells compress itself
            // resized: compressedSpan measures the COMPOSED (manual x auto)
            // content and sizes the cell to it, so the stored auto slot is
            // the exact fit for the new cell BY CONSTRUCTION — the freshest
            // it has ever been. Dropping it would restore the full frame and
            // letterbox the item on the other axis, i.e. undo the verb. The
            // stale-drop rule still governs bystanders, whose cells this
            // write resized without consulting their content.
            if (!selectionAutoCrop) for (const k of resized) delete overrides[k]
            onLayoutChange(newLayout, overrides)
            return null
        }
        const rowOverlap = (a: GridRect, b: GridRect) =>
            a.y < b.y + b.h && b.y < a.y + a.h
        // ENTITLEMENT geometry: the gap each mover is entitled to keep is
        // measured against the ORIGINAL rects of EVERYTHING — statics AND
        // other movers. The invariant this verb preserves is "each item keeps
        // the distance it had to its direction-side neighbour, whether or not
        // that neighbour is itself compressing", which is what makes a row of
        // flush items stay flush: A shrinks and B, whose original gap to A's
        // original edge was 0, follows to A's NEW edge and re-flushes.
        // Measuring the gap against statics only was the bug — with the
        // facing scan monotone in the settled set (settled ⊇ statics implies
        // facing(settled) >= facing(statics)), the clamp
        // min(l.x, facing(settled) + (l.x - facing(statics))) collapses to
        // l.x for every mover, so movers never followed their moved
        // neighbours and compression opened gaps instead of closing them.
        // A mover's own rect is excluded for free: the facing predicates
        // (o.x + o.w <= l.x on the left, o.x >= l.x + l.w on the right) are
        // both false for the item being placed.
        const originals: GridRect[] = layout
            .map(l => ({ x: l.x, y: l.y, w: l.w, h: l.h }))
        // Everything this verb never moves — non-selected items plus the
        // anchored selected ones. Used only to SEED the settled set (the
        // board edges enter as the facing scan's default value).
        const moverKeys = new Set(movers.map(l => l.i))
        const statics: GridRect[] = layout
            .filter(l => !moverKeys.has(l.i))
            .map(l => ({ x: l.x, y: l.y, w: l.w, h: l.h }))
        // The settled set grows with each processed mover's NEW rect, so a
        // mover placed against it lands behind whatever already shrank and
        // slid. Leading-edge order (ascending x for Left, descending right
        // edge for Right) is what guarantees a mover's direction-side
        // neighbours are settled before it is placed.
        const settled: GridRect[] = [...statics]
        const order = [...movers].sort((a, b) => dir === "left"
            ? a.x - b.x
            : (b.x + b.w) - (a.x + a.w))
        let moved = 0
        for (const l of order) {
            // Unmeasurable items still take the push — a move is not a
            // resize — they just can't contribute a shrink, so they are
            // counted for the refusal message and otherwise placed as-is
            if (!measurable(buildData, l.i)) unknown++
            const span = compressedSpan(buildData, l, "w", minW, minH)
            let w = l.w
            if (span !== null) {
                if (isSizeLocked(l.i)) blocked++
                else { w = span; resized.add(l.i) }
            }
            let x = l.x
            if (dir === "left") {
                // Facing edge of the nearest direction-side obstacle,
                // measured over the ORIGINAL geometry (the gap this item is
                // entitled to keep) and again over the settled set (where
                // that side is now). Flush items (gap 0) stay flush through
                // the whole cascade; free-floating ones keep their air.
                const facing = (rects: GridRect[]) => rects.reduce((acc, o) =>
                    rowOverlap(o, l) && o.x + o.w <= l.x
                        ? Math.max(acc, o.x + o.w) : acc, 0)
                const gap = l.x - facing(originals)
                // MONOTONICITY INVARIANT: a Compress Left mover never ends
                // up right of where it started. That plus the scan's
                // `o.x + o.w <= l.x` filter is the whole overlap-safety
                // argument. Left side: facing(settled) <= l.x, so
                // x = min(l.x, facing(settled) + gap) >= facing(settled) —
                // clear of every settled row-overlapping rect on the left.
                // Right side: x <= l.x and w <= l.w put the new span inside
                // the original one, which was already conflict-free; movers
                // still to be placed there see THIS rect once it joins the
                // settled set. The filter costs nothing for settled movers,
                // ASSUMING A VALID INPUT BOARD: row-overlapping rects in a
                // compacted layout are x-disjoint, so a mover processed
                // earlier had its right edge <= l.x to begin with and only
                // moved left. A pathological record (hand-edited URL state)
                // carrying pre-existing overlaps is not repaired here, but
                // it is never made worse either — on the no-move path the
                // new rect is a subset of the old one. The 0 floor is
                // likewise implied (facing >= 0) and kept as a cheap
                // board-edge guard.
                x = Math.max(0, Math.min(l.x, facing(settled) + gap))
            } else {
                // Mirror image: the RIGHT edge is the anchored one and moves
                // monotonically rightward, bounded above by facing(settled)
                // (>= l.x + l.w by the filter, <= columns by its default),
                // so x = right - w >= l.x — the left edge only ever moves
                // right, clearing everything on that side.
                const facing = (rects: GridRect[]) => rects.reduce((acc, o) =>
                    rowOverlap(o, l) && o.x >= l.x + l.w
                        ? Math.min(acc, o.x) : acc, grid.columns)
                const gap = facing(originals) - (l.x + l.w)
                x = Math.max(l.x + l.w, facing(settled) - gap) - w
            }
            settled.push({ x, y: l.y, w, h: l.h })
            if (x !== l.x || w !== l.w) byKey.set(l.i, { ...l, x, w })
            if (x !== l.x) moved++
        }
        if (resized.size === 0 && moved === 0) return refusal()
        const newLayout = layout.map(l => byKey.get(l.i) ?? l)
        const overrides =
            verbAutoCrops(buildData, newLayout, resized, selectionAutoCrop)
        // Same compress exemption as the Up branch: these cells were sized
        // from their COMPOSED content, so their stored auto crop is the fit
        // for the new cell by construction and must survive the psc-off
        // stale-drop, which would otherwise re-letterbox them vertically.
        if (!selectionAutoCrop) for (const k of resized) delete overrides[k]
        onLayoutChange(newLayout, overrides)
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
        orientItem,
        resetOrientation,
        orientSelection,
        shiftLayout,
        shiftSelection,
        compressSelection,
        mirrorLayout,
        mirrorSelection,
        rerollLayout,
        refitToView,
        reflowKeepProportions,
        uniformLayout,
        uniformSelection,
        growInPlace,
        growSelection,
        swapItems,
        arrangeSelection,
        sendSelectionToRegion,
        sendSelectionToRect,
        transformSelection,
        autoCropSelection,
        clearAutoCropSelection,
        // Key set for the below-viewport purge. The splice itself is a
        // RECORD write, which this hook has no access to (it writes
        // geometry through onLayoutChange), so the caller owning
        // updateRecords does the removal.
        belowViewportKeys,
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
    orients: Record<string, PinOrientation | null>,
    columnWidth: number,
    grid: GridParams,
    containerHeight: number,
    sortedLayout: LayoutItem[],
}

// Effective DISPLAY dimensions of an item: the image size as the pin's
// orientation shows it (w/h swapped on odd quarter turns) scaled by its
// MANUAL crop rect (the rebase), so cropped items keep the aspect of the
// user's chosen region. Orienting first is what keeps the crop fractions —
// which are stored in display space — applying to the right axes; every
// fit, pack and resize path reads its aspects from here, so that single
// swap is the whole of orientation support in the layout math. Auto crops
// are deliberately excluded: they are derived from cell sizes, so feeding
// them back into the layout math would make every layout action see the
// previous action's output as the truth.
function croppedDimensions(buildData: LayoutBuildData, key: string): [number, number] {
    const item = buildData.metadata[key]?.item
    const crop = buildData.crops[key]
    const [w, h] = orientedSize(item?.width || 1, item?.height || 1, buildData.orients[key])
    return [w * (crop?.w ?? 1), h * (crop?.h ?? 1)]
}

async function getLayoutBuildData(
    {
        layout,
        crops,
        orients,
        dbs,
        grid,
        pinboardRef,
    }: {
        layout: LayoutItem[],
        crops: Record<string, CropRect | null>,
        orients: Record<string, PinOrientation | null>,
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
    return { metadata, crops, orients, columnWidth, grid, containerHeight, sortedLayout }
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

// Compression directions. No "down": the grid compacts upward only, so a
// downward variant would be undone by the engine on the next settle.
export type CompressDir = "left" | "right" | "up"

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
