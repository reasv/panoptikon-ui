"use client"
import { fetchClient } from "@/lib/api";
import { components } from "@/lib/panoptikon";
import { RefObject, useEffect, useRef } from "react";
import { CropRect, computeAutoCrop } from "@/lib/pinboardCrop";
import { GridParams, rowStep } from "@/lib/pinboardGrid";
import { PackItem, groupRowsByOverlap, justifyRows, packMosaic, packRows } from "@/lib/pinboardPack";

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
    dbs,
    grid,
    pinboardRef,
    onLayoutChange,
}: {
    layout: ReactGridLayout.Layout[],
    // Manual crops (the layout-math base) and derived fit-to-cell auto crops
    crops: Record<string, CropRect | null>,
    autoCrops: Record<string, CropRect | null>,
    dbs: {
        index_db: string | null
        user_data_db: string | null
    },
    grid: GridParams,
    pinboardRef: RefObject<HTMLDivElement>,
    // autoCropOverrides ride along with the layout so both land in one
    // record write (one URL update, one history entry)
    onLayoutChange: (
        layout: ReactGridLayout.Layout[],
        autoCropOverrides?: Record<string, CropRect | null>,
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

    async function changeLayout(itemsPerRow: number, restrictToVisible = false) {
        const buildData = await ensureBuildData()
        if (!buildData) return
        const newLayout = buildLayout(buildData, itemsPerRow, restrictToVisible)
        onLayoutChange(newLayout, stickyAutoCrops(buildData, newLayout))
    }

    // Grid rows above the fold: the block a fill action must span exactly,
    // so that items parked below the fold can't compact up into view
    function foldRows(buildData: LayoutBuildData): number {
        return Math.max(1, Math.floor(
            (buildData.containerHeight - 2 * grid.padding + grid.margin) / rowStep(grid)
        ))
    }

    function toPackItem(buildData: LayoutBuildData, l: ReactGridLayout.Layout): PackItem {
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

    // An item with an auto slot is sticky "keep me fitted to my cell": every
    // action that computes new cell sizes recomputes those items' auto crops
    // for their NEW cells — always from the manual base, never from the
    // previous auto value, so repeated actions can't ratchet the crop tighter.
    // Items without an auto slot are left alone.
    function stickyAutoCrops(
        buildData: LayoutBuildData,
        newLayout: ReactGridLayout.Layout[],
    ): Record<string, CropRect | null> {
        const overrides: Record<string, CropRect | null> = {}
        for (const l of newLayout) {
            if (!autoCrops[l.i]) continue
            const next = autoCropForCell(buildData, l.i, l.w, l.h)
            if (next !== undefined) overrides[l.i] = next
        }
        return overrides
    }

    // The crop-all variant of stickyAutoCrops: fit EVERY item to its new
    // cell, seeding auto slots for items that had none. Auto-layout runs
    // with the auto-crop flag on use this so the whole board lands cropped
    // to its cells in the same write as the geometry.
    function allAutoCrops(
        buildData: LayoutBuildData,
        newLayout: ReactGridLayout.Layout[],
    ): Record<string, CropRect | null> {
        const overrides: Record<string, CropRect | null> = {}
        for (const l of newLayout) {
            const next = autoCropForCell(buildData, l.i, l.w, l.h)
            if (next !== undefined) overrides[l.i] = next
        }
        return overrides
    }

    // Repack into a 2D mosaic filling the viewport. With visibleOnly, items
    // whose top edge is below the fold (the cutting board) are left
    // untouched and settle back just under the packed block — and only in
    // that case (something actually parked below) is the block forced to
    // span the fold exactly even at the cost of distortion, because an
    // under-filled block would let the cutting board compact up into view.
    // When everything is visible the two actions are equivalent.
    async function fillViewport(visibleOnly: boolean, cropToCells = false) {
        const buildData = await ensureBuildData()
        if (!buildData) return
        const total = foldRows(buildData)
        const participants = visibleOnly
            ? buildData.sortedLayout.filter(l => l.y < total)
            : buildData.sortedLayout
        if (participants.length === 0) return
        const packedKeys = new Set(participants.map(l => l.i))
        const rest = layout.filter(l => !packedKeys.has(l.i))
        const packed = packMosaic({
            items: participants.map(l => toPackItem(buildData, l)),
            grid,
            columnWidth: buildData.columnWidth,
            totalGridRows: total,
            fill: rest.length > 0 ? "force" : "auto",
        })
        // A packer that can't produce a composition returns [] — committing
        // that would erase the packed items' records (rebuildRecords drops
        // records absent from the reported layout). No layout beats data loss.
        if (packed.length === 0) return
        const newLayout = [...packed, ...rest]
        onLayoutChange(newLayout, cropToCells
            ? allAutoCrops(buildData, newLayout)
            : stickyAutoCrops(buildData, newLayout))
    }

    // "Split the space evenly among N rows" — explicitly row-based
    async function fillViewportRows(rowCount: number) {
        const buildData = await ensureBuildData()
        if (!buildData) return
        const packed = packRows({
            items: buildData.sortedLayout.map(l => toPackItem(buildData, l)),
            grid,
            columnWidth: buildData.columnWidth,
            totalGridRows: foldRows(buildData),
            rowCount,
        })
        if (packed.length === 0) return
        onLayoutChange(packed, stickyAutoCrops(buildData, packed))
    }

    // Resize-only: keep the current row groupings and reading order, give
    // each row its natural full-width justified height
    async function justifyCurrentRows() {
        const buildData = await ensureBuildData()
        if (!buildData) return
        const groups = groupRowsByOverlap(buildData.sortedLayout)
            .map(row => row.map(l => toPackItem(buildData, l)))
        const newLayout = justifyRows({ groups, grid, columnWidth: buildData.columnWidth })
        onLayoutChange(newLayout, stickyAutoCrops(buildData, newLayout))
    }

    async function changeItemSize(layoutKey: string, increase: number) {
        const buildData = await ensureBuildData()
        if (!buildData) return
        const newLayout = layout.map(l => {
            if (l.i === layoutKey) {
                const [w, h] = croppedDimensions(buildData, l.i)
                return {
                    ...l,
                    w: l.w + increase,
                    h: findOptimalHeight(l.w + increase, grid, buildData.columnWidth, w, h),
                }
            }
            return l
        })
        onLayoutChange(newLayout, stickyAutoCrops(buildData, newLayout))
    }
    async function setItemSize(layoutKey: string, size: number) {
        const buildData = await ensureBuildData()
        if (!buildData) return
        const newLayout = layout.map(l => {
            if (l.i === layoutKey) {
                const [w, h] = croppedDimensions(buildData, l.i)
                return {
                    ...l,
                    w: size,
                    h: findOptimalHeight(size, grid, buildData.columnWidth, w, h),
                }
            }
            return l
        })
        onLayoutChange(newLayout, stickyAutoCrops(buildData, newLayout))
    }
    // Fit every item (or only those starting above the fold) to its current
    // cell by writing its auto-crop slot — which also sets the sticky
    // "keep me fitted" flag. Near-fits (>= 98% of the base) get null. The
    // geometry is untouched: the current layout plus the overrides map goes
    // through the same atomic mechanism as the layout actions.
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
    function shiftLayout(mode: ShiftMode) {
        onLayoutChange(shiftLayoutHorizontally(layout, mode, grid.columns))
    }
    // Mirror the arrangement (not the images) about the centre of the items'
    // own bounding box, so the group stays put and items swap places. A
    // grid-wide flip is this plus a Shift. Vertical is inherently swap-only:
    // the grid re-compacts upward, so the mirrored rows just settle back.
    function mirrorLayout(axis: MirrorAxis) {
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
    sortedLayout: ReactGridLayout.Layout[],
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
        layout: ReactGridLayout.Layout[],
        crops: Record<string, CropRect | null>,
        dbs: {
            index_db: string | null,
            user_data_db: string | null,
        },
        grid: GridParams,
        pinboardRef: RefObject<HTMLDivElement>,
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

function sortLayout(layout: ReactGridLayout.Layout[]): ReactGridLayout.Layout[] {
    // Copy and sort layout by `y` coordinate
    const heightSorted = [...layout].sort((a, b) => a.y - b.y);
    const sortedLayout: ReactGridLayout.Layout[] = [];
    let startIdx = 0;

    while (sortedLayout.length < layout.length) {
        const lowestYItem = heightSorted[startIdx];
        const centerY = lowestYItem.y + Math.floor(lowestYItem.h / 2);
        const currentRow: ReactGridLayout.Layout[] = [];

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
    layout: ReactGridLayout.Layout[],
    mode: ShiftMode,
    columns: number,
): ReactGridLayout.Layout[] {
    const heightSorted = [...layout].sort((a, b) => a.y - b.y)
    const result: ReactGridLayout.Layout[] = []
    let startIdx = 0

    while (result.length < layout.length) {
        const lowestYItem = heightSorted[startIdx]
        const centerY = lowestYItem.y + Math.floor(lowestYItem.h / 2)
        const currentRow: ReactGridLayout.Layout[] = []

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
    layout: ReactGridLayout.Layout[],
    axis: MirrorAxis,
): ReactGridLayout.Layout[] {
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

function buildLayout(buildData: LayoutBuildData, itemsPerRow: number, restrictToVisible: boolean): ReactGridLayout.Layout[] {
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
    )
}

function buildRowLayout(
    itemsPerRow: number,
    items: { sha256: string, width: number, height: number }[],
    grid: GridParams,
    columnWidth: number,
    containerHeight: number,
    restrictToVisible = false,
): ReactGridLayout.Layout[] {
    if (items.length === 0) return []
    const { columns, margin, padding } = grid
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
    const layout: ReactGridLayout.Layout[] = []
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
        const ceilColumns = idealColumns.map(v => Math.max(1, Math.ceil(v)))
        const columnCounts = ceilColumns.reduce((acc, curr) => acc + curr, 0) <= columns
            ? ceilColumns
            : apportionColumns(idealColumns, columns)
        const usedColumns = columnCounts.reduce((acc, curr) => acc + curr, 0)
        // Center rows that don't span the full width
        let currentX = Math.floor((columns - usedColumns) / 2)
        // Every item in a row shares one height (justified-row layout). Deriving
        // each item's height independently from its rounded column count let
        // siblings disagree, leaving the shorter ones undersized with a gap
        // below. Round the shared target height to grid rows once instead.
        let rowGridHeight = Math.max(1, Math.round((targetHeight + margin) / rowStep(grid)))
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
// item. Every item gets at least 1 column and the total stays <= maxColumns.
function apportionColumns(ideal: number[], maxColumns: number): number[] {
    const total = Math.min(maxColumns, Math.max(
        ideal.length,
        Math.round(ideal.reduce((acc, curr) => acc + curr, 0)),
    ))
    const counts = ideal.map(v => Math.max(1, Math.floor(v)))
    let used = counts.reduce((acc, curr) => acc + curr, 0)
    const byRemainder = ideal
        .map((v, i) => ({ i, frac: v - Math.floor(v) }))
        .sort((a, b) => b.frac - a.frac)
    for (let k = 0; used < total; k = (k + 1) % byRemainder.length, used++) {
        counts[byRemainder[k].i]++
    }
    // The 1-column minimum can push the total over the cap; take columns back
    // from the widest items until it fits
    while (used > total) {
        let widest = -1
        for (let i = 0; i < counts.length; i++) {
            if (counts[i] > 1 && (widest < 0 || counts[i] > counts[widest])) widest = i
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
) {
    // Grid rows whose pixel height best matches the item's aspect at this width
    const idealPx = pixelWidth(w, columnWidth, grid.margin) * itemHeight / itemWidth
    return Math.max(1, Math.round((idealPx + grid.margin) / rowStep(grid)))
}
