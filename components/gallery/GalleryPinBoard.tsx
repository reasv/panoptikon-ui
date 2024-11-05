import Image from 'next/image'
import { cn, getFileURL } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"
import { useGalleryFullscreen, useGalleryPinBoardLayout } from '@/lib/state/gallery'
import { PinButton } from './PinButton'
import { useMemo, useRef } from 'react'
import ReactGridLayout, { Responsive, WidthProvider } from "react-grid-layout"
import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"
import { ScrollArea } from '../ui/scroll-area'
import { SelectButton } from './SelectButton'
import { FindButton } from './FindButton'
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { PinBoardCtx } from './PinBoardContextMenu'
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
    const [layout, pinnedFiles]: [ReactGridLayout.Layout[], [string, string, string][]] = useMemo(() => {
        const newLayout: ReactGridLayout.Layout[] = []
        const pinned: [string, string, string][] = []
        for (let i = 0; i < savedLayout.length; i += 5) {
            const [sha256, x, y, w, h] = savedLayout.slice(i, i + 5)
            newLayout.push({
                i: sha256,
                x: parseInt(x),
                y: parseInt(y),
                w: parseInt(w),
                h: parseInt(h),
            })
            pinned.push([
                sha256,

                getFileURL(dbs, "thumbnail", "sha256", sha256),
                getFileURL(dbs, "file", "sha256", sha256),
            ])
        }
        return [newLayout, pinned]
    }, [savedLayout])

    const onLayoutChange = (currentLayout: ReactGridLayout.Layout[]) => {
        const layoutToSave = currentLayout.map(layout => {
            return [layout.i, layout.x.toString(), layout.y.toString(), layout.w.toString(), layout.h.toString(),]
        })
        const flattenedLayout = layoutToSave.flat()
        setSavedLayout(flattenedLayout)
    }
    const [fs, setFs] = useGalleryFullscreen()
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const columns = 24
    const rowHeight = 100
    return (
        <ScrollArea ref={scrollAreaRef} className="overflow-y-auto">
            <div
                className={cn("relative flex-grow",
                    thumbnailsOpen ? "h-[calc(100vh-570px)]" : "h-[calc(100vh-215px)]", fs ? "h-[97vh]" : ""
                )}
            >
                <ResponsiveGridLayout
                    className="layout"
                    layouts={{ lg: layout }}
                    breakpoints={{ lg: 0, }}
                    cols={{ lg: columns, }}
                    rowHeight={rowHeight}
                    onLayoutChange={(currentLayout) => onLayoutChange(currentLayout)}
                    draggableHandle=".drag-handle"
                    isResizable={true}
                    isDraggable={true}
                    compactType="vertical" // Compacts items vertically to keep them visible on screen
                    preventCollision={false}
                >
                    {pinnedFiles.map(([sha256, thumbnail, file]) => {
                        const key = sha256 // Unique key for react-grid-layout
                        return (
                            <div key={key} className="relative bg-gray-800 border rounded shadow group">
                                <ContextMenu>
                                    <ContextMenuTrigger>
                                        <div className="drag-handle cursor-move absolute top-0 left-0 w-full h-full">
                                            <Image
                                                src={thumbnail}
                                                alt={`Sha256 Hash ${sha256}`}
                                                fill
                                                className="rounded object-contain"
                                                unoptimized={true}
                                            />
                                        </div>
                                    </ContextMenuTrigger>
                                    <PinBoardCtx
                                        sha256={sha256}
                                        file_url={file}
                                        onLayoutChange={onLayoutChange}
                                        layout={layout}
                                        pinboardRef={scrollAreaRef}
                                        columns={columns}
                                        rowHeight={rowHeight}
                                        dbs={dbs}
                                    />
                                </ContextMenu>
                                <PinButton sha256={sha256} hidePins={true} />
                                <SelectButton sha256={sha256} />
                                <FindButton
                                    id={sha256}
                                    id_type={"sha256"}
                                    path={""}
                                />
                            </div>
                        )
                    })}
                </ResponsiveGridLayout>
            </div>
        </ScrollArea>
    )
}