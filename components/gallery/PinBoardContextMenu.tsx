import { $api, fetchClient } from "@/lib/api";
import { ContextMenuContent, ContextMenuItem } from "../ui/context-menu";
import { components } from "@/lib/panoptikon";
import build from "next/dist/build";
import { useEffect, useRef } from "react";

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

    async function changeLayout(itemsPerRow: number) {
        if (!layoutBuildData.current) {
            const buildData = await getLayoutBuildData({ layout, dbs, columns, rowHeight, pinboardRef })
            layoutBuildData.current = buildData
        }
        const buildData = layoutBuildData.current
        const newLayout = buildLayout(buildData, itemsPerRow)
        onLayoutChange(newLayout)
    }

    return (
        <ContextMenuContent>
            <ContextMenuItem onClick={() => openURL()}>Open in New Tab</ContextMenuItem>
            <ContextMenuItem onClick={() => changeLayout(3)}>Layout 3 Items/Row</ContextMenuItem>
            <ContextMenuItem onClick={() => changeLayout(4)}>Layout 4 Items/Row</ContextMenuItem>
            <ContextMenuItem onClick={() => changeLayout(5)}>Layout 5 Items/Row</ContextMenuItem>
            <ContextMenuItem onClick={() => changeLayout(6)}>Layout 6 Items/Row</ContextMenuItem>
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
    // Sorting the layout by y value then x value, so that the layout is built from top to bottom, left to right
    const sortedLayout = layout.sort((a, b) => {
        if (a.y === b.y) {
            return a.x - b.x
        }
        return a.y - b.y
    })
    return { metadata, columnWidth, rowHeight, columns, visibleRows, sortedLayout }
}

function buildLayout(buildData: LayoutBuildData, itemsPerRow: number): ReactGridLayout.Layout[] {
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
    )
}

function buildRowLayout(
    itemsPerRow: number,
    items: { sha256: string, width: number, height: number }[],
    rowHeight: number,
    columnWidth: number,
    columns: number,
    visibleRows: number,
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
            layoutRow.push({
                i: item.sha256,
                x: currentX,
                y: currentY,
                w: columnCounts[i],
                h: Math.round(columnCounts[i] * item.height / item.width),
            })
            currentX += columnCounts[i]
        }
        currentY += Math.max(...layoutRow.map(l => l.h))
        currentX = 0
        layout.push(...layoutRow)
    }
    return layout
}