import Image from 'next/image'
import { cn, getFileURL } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"
import { useGalleryFullscreen, useGalleryPinBoardLayout } from '@/lib/state/gallery'
import { PinButton } from './PinButton'
import { useEffect, useMemo, useRef } from 'react'
import ReactGridLayout, { Responsive, WidthProvider } from "react-grid-layout"
import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"
import { ScrollArea } from '../ui/scroll-area'
import { SelectButton } from './SelectButton'
import { FindButton } from './FindButton'
import {
    ContextMenu,
    ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { PinBoardCtx } from './PinBoardContextMenu'
import { $api } from '@/lib/api'
import { MediaControls } from './PlayButton'
import React from 'react'
import { useVideoPlayerState } from '@/lib/videoPlayerState'
const ResponsiveGridLayout = WidthProvider(Responsive)

export function PinBoard(
    {
        thumbnailsOpen,
        showPagination = true
    }: {
        thumbnailsOpen: boolean
        showPagination?: boolean
    }
) {
    const dbs = useSelectedDBs()[0]
    const [savedLayout, setSavedLayout] = useGalleryPinBoardLayout()
    const [layout, pinnedFiles]: [ReactGridLayout.Layout[], [string, string, string, string][]] = useMemo(() => {
        const newLayout: ReactGridLayout.Layout[] = []
        const pinned: [string, string, string, string][] = []
        for (let i = 0; i < savedLayout.length; i += 5) {
            const [sha256, x, y, w, h] = savedLayout.slice(i, i + 5)
            const index = `${i}-${sha256}`
            newLayout.push({
                i: index,
                x: parseInt(x),
                y: parseInt(y),
                w: parseInt(w),
                h: parseInt(h),
            })
            if (sha256 === "__preview") {
                pinned.push([
                    index,
                    sha256,
                    "/logo.svg", // Placeholder for the preview box
                    "/logo.svg", // Placeholder for the preview box
                ])
                continue
            }
            pinned.push([
                index,
                sha256,
                getFileURL(dbs, "thumbnail", "sha256", sha256),
                getFileURL(dbs, "file", "sha256", sha256),
            ])
        }
        return [newLayout, pinned]
    }, [savedLayout])

    const onLayoutChange = (currentLayout: ReactGridLayout.Layout[]) => {
        const layoutToSave = currentLayout.filter((e) => e.i !== "__preview").map(layout => {
            return [layout.i.split("-")[1], layout.x.toString(), layout.y.toString(), layout.w.toString(), layout.h.toString(),]
        })
        const flattenedLayout = layoutToSave.flat()
        setSavedLayout(flattenedLayout)
    }
    const [fs, setFs] = useGalleryFullscreen()
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const columns = 36
    const rowHeight = 50
    const pinItem = usePinItem()
    return (
        <ScrollArea ref={scrollAreaRef} className="overflow-y-auto">
            <div
                className={`relative flex-grow ${fs ? "h-[97vh]" : (
                    showPagination ?
                        (thumbnailsOpen ? "h-[calc(100vh-567px)]" : "h-[calc(100vh-213px)]")
                        :
                        (thumbnailsOpen ? "h-[calc(100vh-505px)]" : "h-[calc(100vh-151px)]")
                )
                    }`}
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
                    isDroppable={true}
                    droppingItem={{ i: '__preview', w: 10, h: 10 }} // size of the grey preview box
                    compactType="vertical" // Compacts items vertically to keep them visible on screen
                    preventCollision={false}
                    onDrop={(layout, layoutItem, e) => {
                        const event = e as unknown as React.DragEvent<HTMLDivElement>
                        if (event.dataTransfer && event.dataTransfer.getData("text/plain")) {
                            const sha256 = event.dataTransfer.getData("text/plain")
                            pinItem.pinItem(sha256, {
                                x: layoutItem.x,
                                y: layoutItem.y,
                                w: layoutItem.w,
                                h: layoutItem.h
                            })
                        }
                    }}
                >
                    {pinnedFiles.map(([i, sha256, thumbnail, file]) => (
                        <div key={i} className="relative bg-gray-800 border rounded shadow group">
                            {sha256 === "__preview" ?
                                <div key={i} className="drag-handle cursor-move absolute top-0 left-0 w-full h-full" />
                                :
                                <PinBoardPin
                                    key={i}
                                    sha256={sha256}
                                    thumbnail={thumbnail}
                                    file={file}
                                    onLayoutChange={onLayoutChange}
                                    layout={layout}
                                    scrollAreaRef={scrollAreaRef}
                                    columns={columns}
                                    rowHeight={rowHeight}
                                    dbs={dbs}
                                />}
                        </div>
                    ))}
                </ResponsiveGridLayout>
            </div>
        </ScrollArea>
    )
}

function PinBoardPin({
    sha256,
    thumbnail,
    file,
    onLayoutChange,
    layout,
    scrollAreaRef,
    columns,
    rowHeight,
    dbs,
}: {
    sha256: string
    thumbnail: string
    file: string
    onLayoutChange: (currentLayout: ReactGridLayout.Layout[]) => void
    layout: ReactGridLayout.Layout[]
    scrollAreaRef: React.RefObject<HTMLDivElement>
    columns: number
    rowHeight: number
    dbs: {
        index_db: string | null
        user_data_db: string | null
    }
}) {
    const { data } = $api.useQuery("get", "/api/items/item", {
        params: {
            query: {
                ...dbs,
                id: sha256,
                id_type: "sha256" // Supports prefix or full sha256 hash
            },
        }
    })
    const isPlayable = data?.item?.type === "video/mp4" || data?.item?.type === "video/webm"
    const videoRef = React.useRef<HTMLVideoElement>(null)
    const videoState = useVideoPlayerState({ videoRef })

    useEffect(() => {
        if (data?.item?.type === "video/mp4" || data?.item?.type === "video/webm") {
            // Autoplay short videos
            if (data?.item.duration && data?.item.duration <= 10) {
                videoState.setShowVideo(true)
                videoState.setVideoIsPlaying(true)
                videoState.setVideoIsMuted(true)
            }
        }
    }, [data])
    return (
        <>
            <ContextMenu>
                <ContextMenuTrigger>
                    <div className="drag-handle cursor-move absolute top-0 left-0 w-full h-full">
                        {isPlayable && videoState.showVideo ?
                            <video
                                ref={videoRef}
                                autoPlay
                                loop
                                muted={videoState.videoIsMuted}
                                controls={videoState.showControls}
                                className="rounded object-contain"
                                style={{ width: "100%", height: "100%" }}
                                src={file}
                            />
                            :
                            <Image
                                src={thumbnail}
                                alt={`Sha256 Hash ${sha256}`}
                                fill
                                className="rounded object-contain"
                                unoptimized={true}
                            />}
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
            <SelectButton
                sha256={sha256}
                item={data?.item}
                files={data?.files}
            />
            {isPlayable && <MediaControls
                isShown={videoState.showVideo}
                isPlaying={videoState.showVideo && videoState.videoIsPlaying}
                setPlaying={videoState.setPlaying}
                stopVideo={videoState.stopVideo}
                isMuted={videoState.videoIsMuted}
                setMuted={videoState.setMuted}
                showControls={videoState.showControls}
                setShowControls={videoState.setControls}
            />}
            <FindButton
                id={data?.files[0]?.id || sha256}
                id_type={data?.files[0] ? "file_id" : "sha256"}
                path={data?.files[0]?.path || ""}
            />
        </>
    )
}

export function usePinItem() {
    const prefixLength = 10 // The length of the prefix of the sha256 hash
    const [savedLayout, setSavedLayout] = useGalleryPinBoardLayout()
    const pinItem = (sha256: string, pos?: { x: number, y: number, w: number, h: number }) => {
        // If position is provided, use it, otherwise default to 0, 0, 2, 2
        if (!pos) {
            pos = { x: 0, y: 0, w: 2, h: 2 }
        }
        setSavedLayout([...savedLayout, sha256.slice(0, prefixLength), pos.x.toString(), pos.y.toString(), pos.w.toString(), pos.h.toString()])

    }
    return { pinItem }
}