import Image from 'next/image'
import { cn, getFullFileURLFromFileID, getThumbnailURLFromFileID } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"
import { useGalleryPins } from '@/lib/state/gallery'
import { PinButton } from './PinButton'
import { useMemo, useState, useEffect } from 'react'
import ReactGridLayout, { Responsive, WidthProvider } from "react-grid-layout"
import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"

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
        const allPins: number[] = [...pins, ...(pins.includes(selectedItem.file_id) ? [] : [selectedItem.file_id])]
        return allPins.map((file_id) => [
            file_id,
            getThumbnailURLFromFileID(file_id, dbs),
            getFullFileURLFromFileID(file_id, dbs)
        ])
    }, [pins, selectedItem, dbs])

    // Initialize layout state
    const [layout, setLayout] = useState<ReactGridLayout.Layout[]>([])

    // Update layout when pinnedFiles change, preserving existing positions and adding new items at the end
    useEffect(() => {
        setLayout((prevLayout) => {
            const existingKeys = new Set(prevLayout.map(item => item.i))
            const newLayout = [...prevLayout]

            pinnedFiles.forEach(([file_id, , file], index) => {
                const key = file_id.toString()
                if (!existingKeys.has(key)) {
                    // Add new item at the end with default position and size
                    newLayout.push({
                        i: key,
                        x: ((newLayout.length * 2) % 12), // Wrap across columns
                        y: Math.floor((newLayout.length * 2) / 12), // Row position
                        w: 2,
                        h: 2,
                    })
                }
            })

            // Filter out layout items that no longer have corresponding pinned files
            return newLayout.filter(item => pinnedFiles.some(([file_id]) => file_id.toString() === item.i))
        })
    }, [pinnedFiles])

    // Handle layout changes
    const onLayoutChange = (currentLayout: ReactGridLayout.Layout[]) => {
        setLayout(currentLayout)
        // Optionally, persist the layout to your state or backend here
    }

    return (
        <div
            className={cn("relative flex-grow overflow-hidden",
                thumbnailsOpen ? "h-[calc(100vh-570px)]" : "h-[calc(100vh-215px)]"
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
                                        layout="fill"
                                        objectFit="contain"
                                        className="rounded"
                                        unoptimized={true}
                                    />
                                </a>
                            </div>
                            <PinButton file_id={file_id} hidePins={true} />
                        </div>
                    )
                })}
            </ResponsiveGridLayout>
        </div>
    )
}
