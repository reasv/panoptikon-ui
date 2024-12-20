import { fetchClient } from "@/lib/api";
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "../ui/context-menu";
import { components } from "@/lib/panoptikon";
import { useEffect, useRef } from "react";
import { useGalleryFullscreen } from "@/lib/state/gallery";

export function PinBoardCtx({
    sha256,
    file_url,
    onLayoutChange,
    layout,
    pinboardRef,
    dbs,
    columns,
    rowHeight,
}: {
    sha256: string
    file_url: string
    onLayoutChange: (layout: ReactGridLayout.Layout[]) => void
    layout: ReactGridLayout.Layout[],
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
    }, [layout, dbs, columns, rowHeight])

    async function changeLayout(itemsPerRow: number, restrictToVisible = false) {
        if (!layoutBuildData.current) {
            const buildData = await getLayoutBuildData({ layout, dbs, columns, rowHeight, pinboardRef })
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
            const buildData = await getLayoutBuildData({ layout, dbs, columns, rowHeight, pinboardRef })
            layoutBuildData.current = buildData
        }
        const buildData = layoutBuildData.current
        const newLayout = layout.map(l => {
            if (l.i === sha256) {
                return {
                    ...l,
                    w: l.w + increase,
                    h: findOptimalHeight(l.w + increase, rowHeight, buildData.columnWidth, buildData.metadata[l.i]?.item.width || 1, buildData.metadata[l.i]?.item.height || 1),
                }
            }
            return l
        })
        onLayoutChange(newLayout)
    }
    async function setItemSize(size: number) {
        if (!layoutBuildData.current) {
            const buildData = await getLayoutBuildData({ layout, dbs, columns, rowHeight, pinboardRef })
            layoutBuildData.current = buildData
        }
        const buildData = layoutBuildData.current
        const newLayout = layout.map(l => {
            if (l.i === sha256) {
                return {
                    ...l,
                    w: size,
                    h: findOptimalHeight(size, rowHeight, buildData.columnWidth, buildData.metadata[l.i]?.item.width || 1, buildData.metadata[l.i]?.item.height || 1),
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

async function fetchMetadata(sha256s: string[], dbs: { index_db: string | null, user_data_db: string | null }) {
    const fetchPromises = sha256s.map(sha256 =>
        fetchClient.GET("/api/items/item", {
            params: {
                query: {
                    ...dbs,
                    id: sha256,
                    id_type: "sha256",
                }
            }
        }).then(response => ({ [sha256]: response.data }))
    );

    const results = await Promise.all(fetchPromises);

    return results.reduce((acc, curr) => ({ ...acc, ...curr }), {});
}

interface LayoutBuildData {
    metadata: {
        [x: string]: {
            item: components["schemas"]["ItemRecord"];
            files: components["schemas"]["FileRecord"][];
        } | undefined
    },
    columnWidth: number,
    rowHeight: number,
    columns: number,
    visibleRows: number,
    sortedLayout: ReactGridLayout.Layout[],
}

async function getLayoutBuildData(
    {
        layout,
        dbs,
        columns,
        rowHeight,
        pinboardRef,
    }: {
        layout: ReactGridLayout.Layout[],
        dbs: {
            index_db: string | null,
            user_data_db: string | null,
        },
        columns: number,
        rowHeight: number,
        pinboardRef: React.RefObject<HTMLDivElement>,
    }
): Promise<LayoutBuildData> {
    const sha256s = layout.map(l => l.i)
    const metadata = await fetchMetadata(sha256s, dbs)
    const columnWidth = pinboardRef.current?.clientWidth ? pinboardRef.current.clientWidth / columns : 1
    const visibleRows = Math.ceil(pinboardRef.current?.clientHeight ? pinboardRef.current.clientHeight / rowHeight : 1)
    const sortedLayout = sortLayout(layout)
    return { metadata, columnWidth, rowHeight, columns, visibleRows, sortedLayout }
}

function sortLayout(layout: ReactGridLayout.Layout[]): ReactGridLayout.Layout[] {
    console.log("Sorting layout")
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
    console.log("Sorted layout")
    return sortedLayout;
}

function buildLayout(buildData: LayoutBuildData, itemsPerRow: number, restrictToVisible: boolean): ReactGridLayout.Layout[] {
    return buildRowLayout(
        itemsPerRow,
        buildData.sortedLayout.map(l => ({
            sha256: l.i,
            width: buildData.metadata[l.i]?.item.width || 1,
            height: buildData.metadata[l.i]?.item.height || 1,
        })),
        buildData.rowHeight,
        buildData.columnWidth,
        buildData.columns,
        buildData.visibleRows,
        restrictToVisible,
    )
}

function buildRowLayout(
    itemsPerRow: number,
    items: { sha256: string, width: number, height: number }[],
    rowHeight: number,
    columnWidth: number,
    columns: number,
    visibleRows: number,
    restrictToVisible = false,
): ReactGridLayout.Layout[] {
    // Split the items into rows
    const rows: { sha256: string, width: number, height: number }[][] = []
    let currentRow: { sha256: string, width: number, height: number }[] = []
    for (const item of items) {
        if (currentRow.length < itemsPerRow) {
            currentRow.push(item)
        } else {
            rows.push(currentRow)
            currentRow = [item]
        }
    }
    // Add the last row
    rows.push(currentRow)
    // Max height per row for all rows to fit in the visible area
    let heightPerRow = Math.round(visibleRows / rows.length)
    // Split the rows into columns, giving proportionally more columns to items with a higher width to height ratio
    // The total width of the row and the actual widths of the items are not taken into account
    const layout: ReactGridLayout.Layout[] = []
    let currentY = 0
    let currentX = 0
    for (const row of rows) {
        // Calculate the width to height ratio of each item
        const ratios = row.map(item => item.width / item.height)
        // Calculate the total width to height ratio of the row
        const totalRatio = ratios.reduce((acc, curr) => acc + curr, 0)
        // Calculate the number of columns for each item
        const columnCounts = ratios.map(ratio => Math.round((ratio / totalRatio) * columns))
        const remainingColumns = columns - columnCounts.reduce((acc, curr) => acc + curr, 0)
        // Add the remaining columns to the items with the highest width to height ratio
        const maxRatioIndex = ratios.indexOf(Math.max(...ratios))
        columnCounts[maxRatioIndex] += remainingColumns
        // Use the total number of columns to calculate the number of columns that are actually used
        const layoutRow: ReactGridLayout.Layout[] = []
        for (let i = 0; i < row.length; i++) {
            const item = row[i]
            let h = findOptimalHeight(columnCounts[i], rowHeight, columnWidth, item.width, item.height)
            if (restrictToVisible) {
                h = Math.min(h, heightPerRow)
            }
            layoutRow.push({
                i: item.sha256,
                x: currentX,
                y: currentY,
                w: columnCounts[i],
                h,
            })
            currentX += columnCounts[i]
        }
        currentY += Math.max(...layoutRow.map(l => l.h))
        currentX = 0
        layout.push(...layoutRow)
    }
    return layout
}

function findOptimalHeight(
    w: number,
    rowHeight: number,
    columnWidth: number,
    itemWidth: number,
    itemHeight: number,
) {
    const h = Math.round(w * itemHeight / itemWidth)
    const realWidth = w * columnWidth
    const itemAspectRatio = itemWidth / itemHeight
    let smallestAspectRatioDifference = Infinity
    let bestHeight = h
    for (let i = -3; i < 3; i++) {
        const newHeight = h + i
        const realHeight = newHeight * rowHeight // Try different heights
        const realAspectRatio = realWidth / realHeight
        const aspectRatioDifference = Math.abs(realAspectRatio - itemAspectRatio)
        if (aspectRatioDifference < smallestAspectRatioDifference) {
            smallestAspectRatioDifference = aspectRatioDifference
            bestHeight = newHeight
        }
    }
    return bestHeight
}