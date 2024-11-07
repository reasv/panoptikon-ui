import Image from 'next/image'
import { BookmarkBtn, FilePathComponent, OpenFile, OpenFolder } from "@/components/imageButtons"
import { Toggle } from "@/components/ui/toggle"
import { X, ArrowBigLeft, ArrowBigRight, GalleryHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { cn, getFileURL, getLocale } from "@/lib/utils"
import { ScrollBar } from "@/components/ui/scroll-area"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { OpenDetailsButton } from "@/components/OpenFileDetails"
import { useItemSelection } from "@/lib/state/itemSelection"
import { useGalleryIndex, getGalleryOptionsSerializer, useGalleryThumbnail, useGalleryPinBoardLayout, useGalleryFullscreen, useGalleryHidePinBoard } from "@/lib/state/gallery"
import { useSelectedDBs } from "@/lib/state/database"
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { usePageSize, useSearchPage } from '@/lib/state/searchQuery/clientHooks'
import { serializers } from '@/lib/state/searchQuery/serializers'
import { VirtualGalleryHorizontalScroll } from './VirtualizedHorizontalScroll'
import { PinButton } from './PinButton'
import { PinBoard } from './GalleryPinBoard'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { FindButton } from './FindButton'
import { blurHashToDataURL } from '@/lib/state/blurHashDataURL'
import { useSearchLoading } from '@/lib/state/zust'
import { MediaControls } from './PlayButton'
import React from 'react'
import { useVideoPlayerState } from '@/lib/videoPlayerState'

function getNextIndex(length: number, index?: number | null,) {
    return ((index || 0) + 1) % length
}

function getPrevIndex(length: number, index?: number | null,) {
    return ((index || 0) - 1 + length) % length
}

export function ImageGallery({
    items,
    totalPages,
}: {
    items: SearchResult[]
    totalPages: number
}) {
    const [qIndex, setIndex] = useGalleryIndex()
    const [page, setPage] = useSearchPage()
    const pageSize = usePageSize()[0]
    const index = (qIndex || 0) % items.length
    const nextImage = () => {
        if (index === (items.length - 1)) {
            if (page < totalPages) {
                setPage(page + 1)
                setIndex(0)
            }
            return
        }
        setIndex((currentIndex) => getNextIndex(items.length, currentIndex))
    }
    const prevImage = () => {
        if (index === 0) {
            if (page > 1) {
                setPage(page - 1)
                setIndex(Math.max(pageSize - 1, 0))
            }
            return
        }
        setIndex((currentIndex) => getPrevIndex(items.length, currentIndex))
    }

    const closeGallery = () => setIndex(null)

    const [thumbnailsOpen, setThumbnailsOpen] = useGalleryThumbnail()

    const [selectedItem, setSelectedItem] = useItemSelection((state) => [state.getSelected(), state.setItem])
    useEffect(() => {
        setSelectedItem(items[index])
    }, [index, items])

    const params = useSearchParams()
    const [prevImageLink, nextImageLink] = useMemo(() => {
        const queryParams = new URLSearchParams(params)
        let nextURL = getGalleryOptionsSerializer()(queryParams, { gi: getNextIndex(items.length, index) })
        let prevURL = getGalleryOptionsSerializer()(queryParams, { gi: getPrevIndex(items.length, index) })
        if (index === 0) {
            if (page > 1) {
                prevURL = serializers.orderArgs(queryParams, { page: page - 1 })
                const lastIndex = Math.max(0, pageSize - 1)
                prevURL = getGalleryOptionsSerializer()(prevURL, { gi: lastIndex })
            } else {
                prevURL = serializers.orderArgs(queryParams, { page: page })
            }
        }
        if (index === (items.length - 1)) {
            if (page < totalPages) {
                nextURL = serializers.orderArgs(queryParams, { page: page + 1 })
                nextURL = getGalleryOptionsSerializer()(nextURL, { gi: 0 })
            } else {
                nextURL = serializers.orderArgs(queryParams, { page: page })
            }
        }
        return [prevURL, nextURL]
    }, [index, params, items.length, page, totalPages])

    function onClickNextImage(e: React.MouseEvent<HTMLAnchorElement, MouseEvent>) {
        e.preventDefault()
        nextImage()
    }

    function onClickPrevImage(e: React.MouseEvent<HTMLAnchorElement, MouseEvent>) {
        e.preventDefault()
        prevImage()
    }

    const currentItem = selectedItem ? selectedItem : items[index]
    const dateString = getLocale(new Date(currentItem.last_modified))
    const pinboard = useGalleryPinBoardLayout()[0]

    const [fs, setFs] = useGalleryFullscreen()
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Check for Ctrl + Shift + M
            if (event.ctrlKey && event.shiftKey && event.code === 'KeyM') {
                event.preventDefault();
                console.log('Ctrl + Shift + M detected');
                setFs((f) => !f)
            }
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, []);
    const hidePinBoard = useGalleryHidePinBoard()[0]

    return (
        <div className="flex flex-col border rounded p-2">
            {!fs && <div className="flex justify-between items-center mb-2">
                <div className="flex items-center">
                    <BookmarkBtn sha256={currentItem.sha256} buttonVariant />
                    <OpenFile sha256={currentItem.sha256} path={currentItem.path} buttonVariant />
                    <OpenFolder sha256={currentItem.sha256} path={currentItem.path} buttonVariant />
                    <Link
                        href={prevImageLink}
                        onClick={onClickPrevImage}
                    >
                        <Button variant="ghost" size="icon" title="Previous Image">
                            <ArrowBigLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                </div>
                <div className="max-w-[33%] text-center">
                    {pinboard.length === 0 ? <>
                        <FilePathComponent path={currentItem.path} />
                        <p className="text-xs text-gray-500 truncate">
                            {dateString}
                        </p>
                    </> : <PinboardTabs itemPath={currentItem.path} />}
                </div>
                <div className="flex items-center">
                    <Link
                        href={nextImageLink}
                        onClick={onClickNextImage}
                    >
                        <Button variant="ghost" size="icon" title="Next Image">
                            <ArrowBigRight className="h-4 w-4" />
                        </Button>
                    </Link>
                    <OpenDetailsButton item={currentItem} />
                    <Toggle
                        pressed={thumbnailsOpen}
                        onClick={() => setThumbnailsOpen(!thumbnailsOpen)}
                        title={thumbnailsOpen ? "Close Thumbnails" : "Open Thumbnails"}
                        aria-label="Toggle auto-update lock"
                    >
                        <GalleryHorizontal className="h-4 w-4" />
                    </Toggle>
                    <Button onClick={() => closeGallery()} variant="ghost" size="icon" title="Close Gallery">
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            </div>}
            {(pinboard.length === 0 || hidePinBoard) ? <GalleryImageLarge
                item={currentItem}
                prevImage={prevImage}
                nextImage={nextImage}
                thumbnailsOpen={thumbnailsOpen}
            /> : <PinBoard thumbnailsOpen={thumbnailsOpen} />}
            {!fs && thumbnailsOpen ? (items.length < 15 ? <GalleryHorizontalScroll items={items} /> : <VirtualGalleryHorizontalScroll items={items} />) : null}
        </div>
    )
}

export function PinboardTabs({ itemPath }: { itemPath: string }) {
    const [hidePinBoard, setHidePinBoard] = useGalleryHidePinBoard()
    return (
        <Tabs
            value={hidePinBoard ? "gallery" : "pins"}
            onValueChange={(value) => setHidePinBoard(value !== "pins")}

        >
            <TabsList>
                <TabsTrigger value="pins">Pinboard</TabsTrigger>
                <TabsTrigger value="gallery">
                    <span className="text-sm truncate cursor-pointer" style={{ direction: 'rtl', textAlign: 'left' }}>
                        {itemPath}
                    </span>
                </TabsTrigger>
            </TabsList>
        </Tabs>
    )
}

export function GalleryImageLarge(
    {
        item,
        thumbnailsOpen,
        prevImage,
        nextImage,
    }: {
        item: SearchResult,
        prevImage: () => void,
        nextImage: () => void,
        thumbnailsOpen: boolean
    }
) {
    const [dbs, ___] = useSelectedDBs()
    const thumbnailURL = getFileURL(dbs, "thumbnail", "sha256", item.sha256)
    const fileURL = getFileURL(dbs, "file", "sha256", item.sha256)

    const handleImageClick = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
        const { clientX, currentTarget } = e
        e.stopPropagation()
        const { left, right } = currentTarget.getBoundingClientRect()
        const middle = (left + right) / 2
        if (clientX > middle) {
            nextImage()
        } else {
            prevImage()
        }
    }
    const searchLoading = useSearchLoading(state => state.loading)

    const isPlayable = item.type === "video/mp4" || item.type === "video/webm"
    const videoRef = useRef<HTMLVideoElement>(null)
    const videoState = useVideoPlayerState({ videoRef })
    return (
        <div
            className={cn("relative flex-grow flex justify-center items-center overflow-hidden group",
                thumbnailsOpen ? "h-[calc(100vh-570px)]" : "h-[calc(100vh-215px)]" // Set height based on whether thumbnails
            )}
        >
            <div
                onClick={handleImageClick} // Attach click handler to the entire area
                className='cursor-pointer'
            >
                {isPlayable && videoState.showVideo ?
                    <div className="absolute inset-0 flex justify-center items-center">
                        <video
                            ref={videoRef}
                            autoPlay
                            loop
                            muted={videoState.videoIsMuted}
                            controls={videoState.showControls}
                            className="rounded object-contain max-h-full h-full"
                            src={fileURL}
                            onClick={(e) => videoState.showControls && e.stopPropagation()}
                        />
                    </div>
                    :
                    <a
                        href={fileURL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="absolute inset-0"
                        onClick={(e) => e.preventDefault()}
                    >
                        <Image
                            src={thumbnailURL}
                            alt={`${item.path}`}
                            fill
                            className="object-contain"
                            unoptimized={true}
                        />

                    </a>}
                {searchLoading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center ">
                        <Image
                            src="/spinner.svg"
                            alt="Loading..."
                            width={250}
                            height={250}
                        />
                    </div>
                )}
            </div>
            {isPlayable && <MediaControls
                isShown={videoState.showVideo}
                isPlaying={videoState.showVideo && videoState.videoIsPlaying}
                setPlaying={videoState.setPlaying}
                stopVideo={videoState.stopVideo}
                isMuted={videoState.videoIsMuted}
                setMuted={videoState.setMuted}
                showControls={videoState.showControls}
                setShowControls={videoState.setControls}
                hidePlayButton={videoState.showVideo && videoState.showControls}
            />}
        </div>
    )
}

export function GalleryHorizontalScroll({
    items,
}: {
    items: SearchResult[]
}) {
    const viewportRef = useRef<HTMLDivElement>(null)
    const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        if (!viewportRef.current || e.deltaY === 0 || e.deltaX !== 0) {
            return
        }

        const delta = e.deltaY
        const currPos = viewportRef.current.scrollLeft
        const scrollWidth = viewportRef.current.scrollWidth
        const clientWidth = viewportRef.current.clientWidth

        const newPos = Math.max(0, Math.min(scrollWidth - clientWidth, currPos + delta))

        viewportRef.current.scrollLeft = newPos
    }, [])

    return (
        <ScrollAreaPrimitive.Root onWheel={onWheel} className={cn("relative overflow-hidden w-full whitespace-nowrap rounded-md border")}>
            <ScrollAreaPrimitive.Viewport ref={viewportRef} className="h-full w-full rounded-[inherit]">
                <div className="flex w-max space-x-4 p-4">
                    {items.map((item, i) => (
                        <HorizontalScrollElement
                            key={item.file_id}
                            item={item}
                            ownIndex={i}
                            nItems={items.length}
                        />
                    ))}
                </div>
            </ScrollAreaPrimitive.Viewport>
            <ScrollBar orientation="horizontal" />
            <ScrollAreaPrimitive.Corner />
        </ScrollAreaPrimitive.Root>
    )
}

export function HorizontalScrollElement({
    item,
    ownIndex,
    nItems,
}: {
    item: SearchResult,
    ownIndex: number,
    nItems: number,
}) {
    const [qIndex, setIndex] = useGalleryIndex()
    const isSelected = useMemo(() => ownIndex === ((qIndex || 0) % nItems), [qIndex, nItems, ownIndex])
    const [dbs, __] = useSelectedDBs()
    const setSelected = useItemSelection((state) => state.setItem)
    const thumbnailURL = getFileURL(dbs, "thumbnail", "sha256", item.sha256)
    const params = useSearchParams()

    const imageLink = useMemo(() => {
        const queryParams = new URLSearchParams(params)
        const indexUrl = getGalleryOptionsSerializer()(queryParams, { gi: ownIndex % nItems })
        return indexUrl
    }, [ownIndex, params, nItems])

    const onClick = (
        e: React.MouseEvent<HTMLAnchorElement, MouseEvent>
    ) => {
        e.preventDefault()
        setIndex(ownIndex % nItems)
        setSelected(item)
    }
    const blurDataURL = useMemo(() => item.blurhash ? blurHashToDataURL(item.blurhash) : undefined, [item.blurhash])
    const searchLoading = useSearchLoading(state => state.loading)
    return (
        <figure
            key={item.file_id}
            className={cn("w-60 h-80 relative rounded-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none cursor-pointer group",
                isSelected ? "scale-105 ring-2 ring-blue-500" : "scale-100"
            )}>
            <Link href={imageLink} onClick={onClick}>
                <Image
                    src={thumbnailURL}
                    alt={item.path}
                    // onClick={() => onClick()}
                    className="w-full h-full object-cover object-top rounded-md cursor-pointer"
                    fill
                    placeholder={blurDataURL ? 'blur' : 'empty'}
                    blurDataURL={blurDataURL}
                    unoptimized={true}
                    sizes="200px"
                />
            </Link>
            {searchLoading && (
                <div className="absolute inset-0 z-10 flex items-center rounded-md justify-center bg-white bg-opacity-50">
                    <Image
                        src="/spinner.svg"
                        alt="Loading..."
                        width={110}
                        height={110}
                    />
                </div>
            )}
            <BookmarkBtn sha256={item.sha256} />
            <PinButton sha256={item.sha256} />
            <FindButton
                id={item.file_id}
                id_type='file_id'
                path={item.path}
            />
        </figure>
    )
}