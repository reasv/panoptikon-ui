import Image from 'next/image'
import { cn, getFullFileURLFromFileID, getThumbnailURLFromFileID } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"
import { useGalleryFullscreen, useGalleryPinBoardLayout, useGalleryPins } from '@/lib/state/gallery'
import { PinButton } from './PinButton'
import { useMemo, useState, useEffect } from 'react'
import ReactGridLayout, { Responsive, WidthProvider } from "react-grid-layout"
import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"
import { ScrollArea } from './ui/scroll-area'
import { SelectButton } from './SelectButton'

const ResponsiveGridLayout = WidthProvider(Responsive)

export function PinBoard(
    {
        selectedItem,
        thumbnailsOpen,
    }: {
        selectedItem: SearchResult,
        thumbnailsOpen: boolean
    }
) {
    const dbs = useSelectedDBs()[0]
    const [pins, setPins] = useGalleryPins()

    // Prepare the list of pinned files
    const pinnedFiles: [number, string, string][] = useMemo(() => {
        return pins.map((file_id) => [
            file_id,
            getThumbnailURLFromFileID(file_id, dbs),
            getFullFileURLFromFileID(file_id, dbs)
        ])
    }, [pins, dbs])

    // Initialize layout state
    const [layout, setLayout] = useState<ReactGridLayout.Layout[]>([])
    const [savedLayout, setSavedLayout] = useGalleryPinBoardLayout()
    // Handle layout changes
    const onLayoutChange = (currentLayout: ReactGridLayout.Layout[]) => {
        setLayout((prevLayout) => {
            if (prevLayout.length === 0 && pinnedFiles.length > 0 && savedLayout.length > 0) {
                // Layout has not been initialized yet, but we have pinned files and saved layout
                console.log("Initializing layout from saved layout")
                // Initialize layout from saved layout
                // Saved layout is a flat array of [file_id, x, y, w, h] values, so we need to group them into groups of 5
                const newLayout: ReactGridLayout.Layout[] = []
                for (let i = 0; i < savedLayout.length; i += 5) {
                    const [file_id, x, y, w, h] = savedLayout.slice(i, i + 5)
                    newLayout.push({
                        i: file_id.toString(),
                        x, y, w, h
                    })
                }
                // Add items from current layout that are not in saved layout
                currentLayout.forEach(item => {
                    if (!newLayout.some(layout => layout.i === item.i)) {
                        newLayout.push(item)
                    }
                })
                return newLayout.filter(item => pinnedFiles.some(([file_id]) => file_id.toString() === item.i))
            }
            return currentLayout
        })
        const layoutToSave = pinnedFiles.map(([file_id]) => {
            const key = file_id.toString()
            const item = currentLayout.find(item => item.i === key)
            return item ? item : null
        }).filter(item => item !== null).map(layout => {
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
                    breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                    cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                    rowHeight={150}
                    onLayoutChange={(currentLayout) => onLayoutChange(currentLayout)}
                    draggableHandle=".drag-handle"
                    isResizable={true}
                    isDraggable={true}
                    compactType="vertical" // Compacts items vertically to keep them visible on screen
                    preventCollision={false}
                >
                    {pinnedFiles.map(([file_id, thumbnail, file]) => {
                        const key = file_id.toString() // Unique key for react-grid-layout
                        return (
                            <div key={key} className="relative bg-gray-800 border rounded shadow group">
                                <div className="drag-handle cursor-move absolute top-0 left-0 w-full h-full">
                                    <a
                                        href={file}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.preventDefault()}
                                        className="w-full h-full"
                                    >
                                        <Image
                                            src={thumbnail}
                                            alt={`File ID ${file_id}`}
                                            fill
                                            className="rounded object-contain"
                                            unoptimized={true}
                                        />
                                    </a>
                                </div>
                                <PinButton file_id={file_id} hidePins={true} />
                                <SelectButton file_id={file_id} />
                            </div>
                        )
                    })}
                </ResponsiveGridLayout>
            </div>
        </ScrollArea>
    )
}