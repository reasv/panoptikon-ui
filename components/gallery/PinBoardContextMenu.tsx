import { fetchClient } from "@/lib/api";
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "../ui/context-menu";
import { components } from "@/lib/panoptikon";
import { useEffect, useRef } from "react";
import { useGalleryFullscreen } from "@/lib/state/gallery";
import { CropRect } from "@/lib/pinboardCrop";

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
    onDuplicate,
    pinboardRef,
    dbs,
    columns,
    rowHeight,
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
    onDuplicate: () => void,
    pinboardRef: React.RefObject<HTMLDivElement>,
    columns: number,
    rowHeight: number,
    dbs: {
        index_db: string | null
        user_data_db: string | null
    }
}) {
    function openURL() {
        window.open(file_url, "_blank")
    }
    const layoutBuildData = useRef<LayoutBuildData | null>(null)
    useEffect(() => {
        layoutBuildData.current = null
    }, [layout, crops, dbs, columns, rowHeight])

    async function changeLayout(itemsPerRow: number, restrictToVisible = false) {
        if (!layoutBuildData.current) {
            const buildData = await getLayoutBuildData({ layout, crops, dbs, columns, rowHeight, pinboardRef })
            layoutBuildData.current = buildData
        }
        const buildData = layoutBuildData.current
        const newLayout = buildLayout(buildData, itemsPerRow, restrictToVisible)
        onLayoutChange(newLayout)
    }

    function layoutFixedRows(rows: number) {
        const itemsPerRow = Math.ceil(layout.length / rows)
        changeLayout(itemsPerRow, true)
    }
    async function changeItemSize(increase: number) {
        if (!layoutBuildData.current) {
            const buildData = await getLayoutBuildData({ layout, crops, dbs, columns, rowHeight, pinboardRef })
            layoutBuildData.current = buildData
        }
        const buildData = layoutBuildData.current
        const newLayout = layout.map(l => {
            if (l.i === layoutKey) {
                const [w, h] = croppedDimensions(buildData, l.i)
                return {
                    ...l,
                    w: l.w + increase,
                    h: findOptimalHeight(l.w + increase, rowHeight, buildData.columnWidth, w, h),
                }
            }
            return l
        })
        onLayoutChange(newLayout)
    }
    async function setItemSize(size: number) {
        if (!layoutBuildData.current) {
            const buildData = await getLayoutBuildData({ layout, crops, dbs, columns, rowHeight, pinboardRef })
            layoutBuildData.current = buildData
        }
        const buildData = layoutBuildData.current
        const newLayout = layout.map(l => {
            if (l.i === layoutKey) {
                const [w, h] = croppedDimensions(buildData, l.i)
                return {
                    ...l,
                    w: size,
                    h: findOptimalHeight(size, rowHeight, buildData.columnWidth, w, h),
                }
            }
            return l
        })
        onLayoutChange(newLayout)
    }
    const [fs, setFs] = useGalleryFullscreen()
    return (
        <ContextMenuContent>
            <ContextMenuItem onClick={() => openURL()}>Open in New Tab</ContextMenuItem>
            <ContextMenuItem onClick={onDuplicate}>Duplicate</ContextMenuItem>
            <ContextMenuItem onClick={onToggleCrop}>
                {cropMode ? "Finish Cropping" : "Crop Image"}
            </ContextMenuItem>
            {hasCrop && <ContextMenuItem onClick={onClearCrop}>Clear Crop</ContextMenuItem>}
            <ContextMenuSub>
                <ContextMenuSubTrigger inset>Resize Item</ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-48">
                    <ContextMenuItem onClick={() => setItemSize(2)}>Width 2/36 (1/18)</ContextMenuItem>
                    <ContextMenuItem onClick={() => setItemSize(4)}>Width 4/36 (1/9)</ContextMenuItem>
                    <ContextMenuItem onClick={() => setItemSize(6)}>Width 6/36 (1/6)</ContextMenuItem>
                    <ContextMenuItem onClick={() => setItemSize(9)}>Width 9/36 (1/4)</ContextMenuItem>
                    <ContextMenuItem onClick={() => setItemSize(12)}>Width 12/36 (1/3)</ContextMenuItem>
                    <ContextMenuItem onClick={() => setItemSize(24)}>Width 24/36 (2/3)</ContextMenuItem>
                    <ContextMenuItem onClick={() => setItemSize(36)}>Width 36/36 (Full)</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => changeItemSize(1)}>+1/36 Width</ContextMenuItem>
                    <ContextMenuItem onClick={() => changeItemSize(4)}>+4/36 Width</ContextMenuItem>
                    <ContextMenuItem onClick={() => changeItemSize(6)}>+6/36 Width</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => changeItemSize(-1)}>-1/36 Width</ContextMenuItem>
                    <ContextMenuItem onClick={() => changeItemSize(-4)}>-4/36 Width</ContextMenuItem>
                    <ContextMenuItem onClick={() => changeItemSize(-6)}>-6/36 Width</ContextMenuItem>
                </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => setFs(!fs)}>
                {fs ? "Restore Pinboard Size" : "Maximize Pinboard"}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => changeLayout(3)}>Layout 3 Items/Row</ContextMenuItem>
            <ContextMenuItem onClick={() => changeLayout(4)}>Layout 4 Items/Row</ContextMenuItem>
            <ContextMenuItem onClick={() => changeLayout(5)}>Layout 5 Items/Row</ContextMenuItem>
            <ContextMenuItem onClick={() => changeLayout(6)}>Layout 6 Items/Row</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => layoutFixedRows(1)}>Layout 1 Row</ContextMenuItem>
            <ContextMenuItem onClick={() => layoutFixedRows(2)}>Layout 2 Rows</ContextMenuItem>
            <ContextMenuItem onClick={() => layoutFixedRows(3)}>Layout 3 Rows</ContextMenuItem>
            <ContextMenuItem onClick={() => layoutFixedRows(4)}>Layout 4 Rows</ContextMenuItem>
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

// react-grid-layout defaults; the pinboard grid doesn't override margin or
// containerPadding, so cells are 10px apart and the container has 10px padding
const GRID_MARGIN = 10
const GRID_PADDING = 10

// Pixel size of an item spanning w columns / h rows, including the margins
// between the cells it spans
function pixelWidth(w: number, columnWidth: number): number {
    return w * columnWidth + (w - 1) * GRID_MARGIN
}
function pixelHeight(h: number, rowHeight: number): number {
    return h * rowHeight + (h - 1) * GRID_MARGIN
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
    rowHeight: number,
    columns: number,
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
        columns,
        rowHeight,
        pinboardRef,
    }: {
        layout: ReactGridLayout.Layout[],
        crops: Record<string, CropRect | null>,
        dbs: {
            index_db: string | null,
            user_data_db: string | null,
        },
        columns: number,
        rowHeight: number,
        pinboardRef: React.RefObject<HTMLDivElement>,
    }
): Promise<LayoutBuildData> {
    const keys = layout.map(l => l.i)
    const metadata = await fetchMetadata(keys, dbs)
    const clientWidth = pinboardRef.current?.clientWidth || 1
    const containerHeight = pinboardRef.current?.clientHeight || 1
    // Exact pixel width of one column: the container width minus its padding
    // and the margins between columns, split evenly
    const columnWidth = Math.max(1, (clientWidth - 2 * GRID_PADDING - (columns - 1) * GRID_MARGIN) / columns)
    const sortedLayout = sortLayout(layout)
    return { metadata, crops, columnWidth, rowHeight, columns, containerHeight, sortedLayout }
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
        buildData.rowHeight,
        buildData.columnWidth,
        buildData.columns,
        buildData.containerHeight,
        restrictToVisible,
    )
}

function buildRowLayout(
    itemsPerRow: number,
    items: { sha256: string, width: number, height: number }[],
    rowHeight: number,
    columnWidth: number,
    columns: number,
    containerHeight: number,
    restrictToVisible = false,
): ReactGridLayout.Layout[] {
    if (items.length === 0) return []
    // Split the items into rows
    const rows: { sha256: string, width: number, height: number }[][] = []
    for (let i = 0; i < items.length; i += itemsPerRow) {
        rows.push(items.slice(i, i + itemsPerRow))
    }
    // Total grid rows that fit in the container: h grid rows occupy
    // h*rowHeight + (h-1)*margin px, plus the container's own padding
    const totalRowBudget = Math.max(rows.length, Math.floor(
        (containerHeight - 2 * GRID_PADDING + GRID_MARGIN) / (rowHeight + GRID_MARGIN)
    ))
    const baseRowBudget = Math.floor(totalRowBudget / rows.length)
    const layout: ReactGridLayout.Layout[] = []
    let currentY = 0
    rows.forEach((row, rowIndex) => {
        // Leftover budget rows go to the first rows, one each
        const heightBudget = baseRowBudget + (rowIndex < totalRowBudget % rows.length ? 1 : 0)
        const ratios = row.map(item => item.width / item.height)
        const totalRatio = ratios.reduce((acc, curr) => acc + curr, 0)
        // Height of the row if it spans all columns with every item at its true aspect
        const naturalHeight =
            (pixelWidth(columns, columnWidth) - (row.length - 1) * GRID_MARGIN) / totalRatio
        let targetHeight = naturalHeight
        if (restrictToVisible) {
            const budgetPx = pixelHeight(heightBudget, rowHeight)
            // Too tall to fit at full width: shrink the whole row (narrower
            // boxes at the same aspect) instead of clamping heights, which
            // would letterbox the items
            if (naturalHeight > budgetPx) targetHeight = budgetPx
        }
        // Ideal (fractional) column count per item at the target height
        const idealColumns = ratios.map(ratio =>
            (ratio * targetHeight + GRID_MARGIN) / (columnWidth + GRID_MARGIN)
        )
        const columnCounts = apportionColumns(idealColumns, columns)
        const usedColumns = columnCounts.reduce((acc, curr) => acc + curr, 0)
        // Center rows that don't span the full width
        let currentX = Math.floor((columns - usedColumns) / 2)
        const heights: number[] = []
        for (let i = 0; i < row.length; i++) {
            let h = findOptimalHeight(columnCounts[i], rowHeight, columnWidth, row[i].width, row[i].height)
            if (restrictToVisible) h = Math.min(h, heightBudget)
            heights.push(h)
            layout.push({
                i: row[i].sha256,
                x: currentX,
                y: currentY,
                w: columnCounts[i],
                h,
            })
            currentX += columnCounts[i]
        }
        currentY += Math.max(...heights)
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
    rowHeight: number,
    columnWidth: number,
    itemWidth: number,
    itemHeight: number,
) {
    // Grid rows whose pixel height best matches the item's aspect at this width
    const idealPx = pixelWidth(w, columnWidth) * itemHeight / itemWidth
    return Math.max(1, Math.round((idealPx + GRID_MARGIN) / (rowHeight + GRID_MARGIN)))
}