import { fetchClient } from "@/lib/api";
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "../ui/context-menu";
import { components } from "@/lib/panoptikon";
import { useEffect, useRef } from "react";
import { useGalleryFullscreen, useGalleryPinGrid } from "@/lib/state/gallery";
import { CropRect, TrimRange } from "@/lib/pinboardCrop";
import { GridParams, rowStep } from "@/lib/pinboardGrid";
import { PackItem, groupRowsByOverlap, justifyRows, packRows } from "@/lib/pinboardPack";
import { useFileOpenActions } from "@/hooks/fileOpen";

// Layout keys are `${recordIndex}-${sha256Prefix}` (the same image can be
// pinned more than once); the sha256 part is what the API understands
function keyToSha256(key: string): string {
    return key.split("-")[1]
}

export function PinBoardCtx({
    layoutKey,
    sha256,
    file_url,
    onLayoutChange,
    layout,
    crops,
    cropMode,
    hasCrop,
    onToggleCrop,
    onClearCrop,
    trim,
    onTrimChange,
    onDuplicate,
    pinboardRef,
    dbs,
    grid,
    isV1,
    onUpgradeGrid,
}: {
    layoutKey: string
    sha256: string
    file_url: string
    onLayoutChange: (layout: ReactGridLayout.Layout[]) => void
    layout: ReactGridLayout.Layout[],
    crops: Record<string, CropRect | null>,
    cropMode: boolean,
    hasCrop: boolean,
    onToggleCrop: () => void,
    onClearCrop: () => void,
    trim: TrimRange | null,
    onTrimChange: (trim: TrimRange | null) => void,
    onDuplicate: () => void,
    pinboardRef: React.RefObject<HTMLDivElement>,
    grid: GridParams,
    isV1: boolean,
    onUpgradeGrid: () => void,
    dbs: {
        index_db: string | null
        user_data_db: string | null
    }
}) {
    function openURL() {
        window.open(file_url, "_blank")
    }
    // The pinboard stores the 10-char sha256 prefix; the open/folder endpoints
    // accept a prefix as the sha256 id, same as the pin's own item lookup.
    const { openFile, showInFolder, disableBackendOpen, relayEnabled } = useFileOpenActions({ sha256 })
    // In restricted mode the File actions degrade to things this pin already
    // offers: Open File becomes a new browser tab (== "Open in New Tab" below)
    // and Show in Folder becomes the FindButton the pin already renders. Only
    // a relay (real local open) makes the submenu worth showing there.
    const showFileMenu = relayEnabled || !disableBackendOpen
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
        onLayoutChange(newLayout)
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

    // Repack into justified rows filling the viewport exactly. With
    // visibleOnly, items whose top edge is below the fold (the cutting
    // board) are left untouched and settle back just under the packed
    // block; rowCount "auto" lets the row-break DP pick the row count.
    async function fillViewport(visibleOnly: boolean, rowCount: number | "auto" = "auto") {
        const buildData = await ensureBuildData()
        if (!buildData) return
        const total = foldRows(buildData)
        const participants = visibleOnly
            ? buildData.sortedLayout.filter(l => l.y < total)
            : buildData.sortedLayout
        if (participants.length === 0) return
        const packed = packRows({
            items: participants.map(l => toPackItem(buildData, l)),
            grid,
            columnWidth: buildData.columnWidth,
            totalGridRows: total,
            rowCount,
            // With a cutting board below the fold, an under-filled block
            // would let it compact up into view — the wall wins over
            // letterboxing. The plain fill has nothing below to wall off.
            forceFill: visibleOnly,
        })
        const packedKeys = new Set(packed.map(l => l.i))
        const rest = layout.filter(l => !packedKeys.has(l.i))
        onLayoutChange([...packed, ...rest])
    }

    // Resize-only: keep the current row groupings and reading order, give
    // each row its natural full-width justified height
    async function justifyCurrentRows() {
        const buildData = await ensureBuildData()
        if (!buildData) return
        const groups = groupRowsByOverlap(buildData.sortedLayout)
            .map(row => row.map(l => toPackItem(buildData, l)))
        onLayoutChange(justifyRows({ groups, grid, columnWidth: buildData.columnWidth }))
    }

    function layoutFixedRows(rows: number) {
        fillViewport(false, rows)
    }
    async function changeItemSize(increase: number) {
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
        onLayoutChange(newLayout)
    }
    async function setItemSize(size: number) {
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
        onLayoutChange(newLayout)
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
    const [fs, setFs] = useGalleryFullscreen()
    const [showGrid, setShowGrid] = useGalleryPinGrid()
    // Width presets are fixed fractions of the board width, so the menu is
    // the same on every grid resolution; the step sizes scale with the
    // resolution (1 v1 column = `stepUnit` columns on this grid)
    const widthPresets: [number, string][] = [
        [1 / 18, "1/18"],
        [1 / 9, "1/9"],
        [1 / 6, "1/6"],
        [1 / 4, "1/4"],
        [1 / 3, "1/3"],
        [2 / 3, "2/3"],
        [1, "Full"],
    ]
    const stepUnit = Math.max(1, Math.round(grid.columns / 36))
    return (
        <ContextMenuContent>
            <ContextMenuItem onClick={() => openURL()}>Open in New Tab</ContextMenuItem>
            {showFileMenu && (
                <ContextMenuSub>
                    <ContextMenuSubTrigger inset>File</ContextMenuSubTrigger>
                    <ContextMenuSubContent className="w-48">
                        <ContextMenuItem onClick={openFile}>Open File</ContextMenuItem>
                        <ContextMenuItem onClick={showInFolder}>Show File in Folder</ContextMenuItem>
                    </ContextMenuSubContent>
                </ContextMenuSub>
            )}
            <ContextMenuItem onClick={onDuplicate}>Duplicate</ContextMenuItem>
            <ContextMenuItem onClick={onToggleCrop}>
                {cropMode ? "Finish Cropping" : "Crop Image"}
            </ContextMenuItem>
            {hasCrop && <ContextMenuItem onClick={onClearCrop}>Clear Crop</ContextMenuItem>}
            {trim?.start != null && <ContextMenuItem
                onClick={() => onTrimChange(trim.end != null ? { start: null, end: trim.end } : null)}
            >
                Clear Loop Start
            </ContextMenuItem>}
            {trim?.end != null && <ContextMenuItem
                onClick={() => onTrimChange(trim.start != null ? { start: trim.start, end: null } : null)}
            >
                Clear Loop End
            </ContextMenuItem>}
            {trim?.start != null && trim?.end != null && <ContextMenuItem onClick={() => onTrimChange(null)}>
                Clear Loop Range
            </ContextMenuItem>}
            <ContextMenuSub>
                <ContextMenuSubTrigger inset>Resize Item</ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-48">
                    {widthPresets.map(([frac, label]) => {
                        const w = Math.max(1, Math.round(grid.columns * frac))
                        return (
                            <ContextMenuItem key={label} onClick={() => setItemSize(w)}>
                                Width {w}/{grid.columns} ({label})
                            </ContextMenuItem>
                        )
                    })}
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => changeItemSize(stepUnit)}>+{stepUnit}/{grid.columns} Width</ContextMenuItem>
                    <ContextMenuItem onClick={() => changeItemSize(4 * stepUnit)}>+{4 * stepUnit}/{grid.columns} Width</ContextMenuItem>
                    <ContextMenuItem onClick={() => changeItemSize(6 * stepUnit)}>+{6 * stepUnit}/{grid.columns} Width</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => changeItemSize(-stepUnit)}>-{stepUnit}/{grid.columns} Width</ContextMenuItem>
                    <ContextMenuItem onClick={() => changeItemSize(-4 * stepUnit)}>-{4 * stepUnit}/{grid.columns} Width</ContextMenuItem>
                    <ContextMenuItem onClick={() => changeItemSize(-6 * stepUnit)}>-{6 * stepUnit}/{grid.columns} Width</ContextMenuItem>
                </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => setFs(!fs)}>
                {fs ? "Restore Pinboard Size" : "Maximize Pinboard"}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => setShowGrid(!showGrid)}>
                {showGrid ? "Hide Grid" : "Show Grid"}
            </ContextMenuItem>
            {isV1 && <ContextMenuItem onClick={onUpgradeGrid}>
                Upgrade Board Grid
            </ContextMenuItem>}
            <ContextMenuSeparator />
            <ContextMenuSub>
                <ContextMenuSubTrigger inset>Layout</ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-56">
                    <ContextMenuItem onClick={() => fillViewport(false)}>Fill Viewport</ContextMenuItem>
                    <ContextMenuItem onClick={() => fillViewport(true)}>Fill Viewport (Visible Only)</ContextMenuItem>
                    <ContextMenuItem onClick={() => justifyCurrentRows()}>Justify Rows</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuSub>
                        <ContextMenuSubTrigger>Items per Row</ContextMenuSubTrigger>
                        <ContextMenuSubContent className="w-48">
                            {[3, 4, 5, 6].map(n => (
                                <ContextMenuItem key={n} onClick={() => changeLayout(n)}>
                                    {n} Items per Row
                                </ContextMenuItem>
                            ))}
                        </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuSub>
                        <ContextMenuSubTrigger>Rows</ContextMenuSubTrigger>
                        <ContextMenuSubContent className="w-48">
                            {[1, 2, 3, 4].map(n => (
                                <ContextMenuItem key={n} onClick={() => layoutFixedRows(n)}>
                                    {n} {n === 1 ? "Row" : "Rows"}
                                </ContextMenuItem>
                            ))}
                        </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuSub>
                        <ContextMenuSubTrigger>Shift</ContextMenuSubTrigger>
                        <ContextMenuSubContent className="w-48">
                            <ContextMenuItem onClick={() => shiftLayout("left")}>Shift Left</ContextMenuItem>
                            <ContextMenuItem onClick={() => shiftLayout("center")}>Center</ContextMenuItem>
                            <ContextMenuItem onClick={() => shiftLayout("right")}>Shift Right</ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem onClick={() => mirrorLayout("horizontal")}>Mirror Horizontally</ContextMenuItem>
                            <ContextMenuItem onClick={() => mirrorLayout("vertical")}>Mirror Vertically</ContextMenuItem>
                        </ContextMenuSubContent>
                    </ContextMenuSub>
                </ContextMenuSubContent>
            </ContextMenuSub>
        </ContextMenuContent>
    )
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
            item: components["schemas"]["ItemRecord"];
            files: components["schemas"]["FileRecord"][];
        } | undefined
    },
    crops: Record<string, CropRect | null>,
    columnWidth: number,
    grid: GridParams,
    containerHeight: number,
    sortedLayout: ReactGridLayout.Layout[],
}

// Effective source dimensions of an item: the image size scaled by its
// crop rect, so cropped items keep the aspect of what's actually shown
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
        pinboardRef: React.RefObject<HTMLDivElement>,
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