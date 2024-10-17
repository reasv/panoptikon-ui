import Image from 'next/image'
import { cn, getFileURL } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"
import { useGalleryFullscreen, useGalleryPinBoardLayout } from '@/lib/state/gallery'
import { PinButton } from './PinButton'
import { useMemo } from 'react'
import ReactGridLayout, { Responsive, WidthProvider } from "react-grid-layout"
import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"
import { ScrollArea } from '../ui/scroll-area'
import { SelectButton } from './SelectButton'

const ResponsiveGridLayout = WidthProvider(Responsive)

export function PinBoard(
    {
        thumbnailsOpen,
    }: {
        thumbnailsOpen: boolean
    }
) {
    const dbs = useSelectedDBs()[0]
    const [savedLayout, setSavedLayout] = useGalleryPinBoardLayout()
    const [layout, pinnedFiles]: [ReactGridLayout.Layout[], [number, string, string][]] = useMemo(() => {
        const newLayout: ReactGridLayout.Layout[] = []
        const pinned: [number, string, string][] = []
        for (let i = 0; i < savedLayout.length; i += 5) {
            const [item_id, x, y, w, h] = savedLayout.slice(i, i + 5)
            newLayout.push({
                i: item_id.toString(),
                x, y, w, h
            })
            pinned.push([
                item_id,
                getFileURL(dbs, "file", "item_id", item_id),
                getFileURL(dbs, "thumbnail", "item_id", item_id)
            ])
        }
        return [newLayout, pinned]
    }, [savedLayout])

    const onLayoutChange = (currentLayout: ReactGridLayout.Layout[]) => {
        const layoutToSave = currentLayout.map(layout => {
            return [parseInt(layout.i), layout.x, layout.y, layout.w, layout.h]
        })
        const flattenedLayout = layoutToSave.flat()
        setSavedLayout(flattenedLayout)
    }
    const [fs, setFs] = useGalleryFullscreen()
    return (
        <ScrollArea className="overflow-y-auto">
            <div
                className={cn("relative flex-grow",
                    thumbnailsOpen ? "h-[calc(100vh-570px)]" : "h-[calc(100vh-215px)]", fs ? "h-[97vh]" : ""
                )}
            >
                <ResponsiveGridLayout
                    className="layout"
                    layouts={{ lg: layout }}
                    breakpoints={{ lg: 0, }}
                    cols={{ lg: 12, }}
                    rowHeight={150}
                    onLayoutChange={(currentLayout) => onLayoutChange(currentLayout)}
                    draggableHandle=".drag-handle"
                    isResizable={true}
                    isDraggable={true}
                    compactType="vertical" // Compacts items vertically to keep them visible on screen
                    preventCollision={false}
                >
                    {pinnedFiles.map(([item_id, thumbnail, file]) => {
                        const key = item_id.toString() // Unique key for react-grid-layout
                        return (
                            <div key={key} className="relative bg-gray-800 border rounded shadow group">
                                <div className="drag-handle cursor-move absolute top-0 left-0 w-full h-full">
                                    <Image
                                        src={thumbnail}
                                        alt={`Item ID ${item_id}`}
                                        fill
                                        className="rounded object-contain"
                                        unoptimized={true}
                                    />
                                </div>
                                <PinButton item_id={item_id} hidePins={true} />
                                <SelectButton item_id={item_id} />
                            </div>
                        )
                    })}
                </ResponsiveGridLayout>
            </div>
        </ScrollArea>
    )
}