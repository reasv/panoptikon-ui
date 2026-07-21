import Image from 'next/image'
import { BookmarkBtn, FilePathComponent, OpenFile, OpenFolder, useCopyPath } from "@/components/imageButtons"
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Toggle } from "@/components/ui/toggle"
import { X, ArrowBigLeft, ArrowBigRight, GalleryHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useEffect, useMemo, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { cn, getFileURL, getLocale } from "@/lib/utils"
import { itemEquals, OpenDetailsButton } from "@/components/OpenFileDetails"
import { useItemSelection } from "@/lib/state/itemSelection"
import { useGalleryIndex, getGalleryOptionsSerializer, useGalleryThumbnail, useGalleryPinBoardLayout, useGalleryFullscreen, useGalleryHidePinBoard } from "@/lib/state/gallery"
import { useSelectedDBs } from "@/lib/state/database"
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { usePageSize, useSearchPage } from '@/lib/state/searchQuery/clientHooks'
import { serializers } from '@/lib/state/searchQuery/serializers'
import { VirtualGalleryHorizontalScroll } from './VirtualizedHorizontalScroll'
import { PinBoard } from './GalleryPinBoard'
import { AutoLayoutToggle, PinboardMenu } from './PinboardMenu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
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
    setPage,
    resultsAreStale = false,
}: {
    items: SearchResult[]
    totalPages: number
    setPage: (page: number) => Promise<void>
    /** These results belong to a different page than the URL names — see useSearch */
    resultsAreStale?: boolean
}) {
    const [qIndex, setIndex] = useGalleryIndex()
    const [page] = useSearchPage()
    const pageSize = usePageSize()
    // Clamp rather than wrap: an index past the end of the page addresses
    // nothing, and wrapping round lands on a semantically unrelated item.
    const urlIndex = Math.max(0, Math.min(qIndex || 0, items.length - 1))
    // Hold still while the results don't match the URL. A page-size change
    // rewrites the index and the size together, so for one render the new
    // index addresses the old page — resolving it there would show a wrong
    // item and (via the selection push below) make that wrong item stick.
    // The held index is the same *item* the remap is moving to, so nothing
    // visibly happens: the number changes underneath an unchanged picture.
    //
    // Adjusted during render rather than in an effect: a ref read while
    // rendering is exactly what the React Compiler (on, see next.config.mjs)
    // forbids, and this way the held value can never lag a commit behind.
    // React re-runs the component immediately without committing, and the
    // non-stale branch doesn't read it anyway, so the extra pass is free.
    const [heldIndex, setHeldIndex] = useState(urlIndex)
    if (!resultsAreStale && heldIndex !== urlIndex) {
        setHeldIndex(urlIndex)
    }
    const index = resultsAreStale
        ? Math.max(0, Math.min(heldIndex, items.length - 1))
        : urlIndex
    const nextImage = () => {
        if (index === (items.length - 1)) {
            if (page < totalPages) {
                setPage(page + 1).then(() => {
                    setIndex(0)
                })
            }
            return
        }
        setIndex((currentIndex) => getNextIndex(items.length, currentIndex))
    }
    const prevImage = () => {
        if (index === 0) {
            if (page > 1) {
                setPage(page - 1).then(() => {
                    setIndex(Math.max(pageSize - 1, 0))
                })
            }
            return
        }
        setIndex((currentIndex) => getPrevIndex(items.length, currentIndex))
    }

    const closeGallery = () => setIndex(null)

    const [thumbnailsOpen, setThumbnailsOpen] = useGalleryThumbnail()

    const [selectedItem, setSelectedItem] = useItemSelection(useShallow((state) => [state.getSelected(), state.setItem]))
    useEffect(() => {
        // items[index] can be undefined while results and the gallery index
        // are transiently out of sync (setItem would throw on undefined).
        // Stale results are skipped outright: publishing an item resolved
        // against the wrong page makes the selection→index effect in
        // SearchPage rewrite gi to wherever that item happens to land.
        if (!resultsAreStale && items[index]) {
            setSelectedItem(items[index])
        }
    }, [index, items, resultsAreStale])

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

    // Prefer the live result object when the selection points at the same
    // item: the selection snapshot is stale the moment a bookmark mutation
    // patches the cached search response (setItem skips same-file_id
    // updates via itemEquals), while items[index] always reflects it.
    const galleryItem = items[index]
    const currentItem =
        selectedItem && galleryItem && itemEquals(selectedItem, galleryItem)
            ? galleryItem
            : selectedItem ? selectedItem : galleryItem
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
        // data-pinboard-frame: presses landing on this panel's own padding
        // and gaps (not on any child) can start a pinboard marquee select —
        // see the frame listener in GalleryPinBoard
        <div data-pinboard-frame className="flex flex-col border rounded p-2">
            {!fs && <div className="flex justify-between items-center mb-2">
                <div className="flex items-center">
                    <BookmarkBtn sha256={currentItem.sha256} bookmarked={currentItem.bookmarked} buttonVariant />
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
                showPagination={totalPages > 1}
            /> : <PinBoard
                thumbnailsOpen={thumbnailsOpen}
                showPagination={totalPages > 1}
            />}
            {!fs && thumbnailsOpen ? <VirtualGalleryHorizontalScroll items={items} /> : null}
        </div>
    )
}

// The pinboard side of a Results/Pinboard (or path/Pinboard) tab pair:
// auto-layout toggle, the "pins" trigger and the board menu as one chip.
// Shared by the gallery header tabs below and the grid view's tabs — must
// be rendered inside a <Tabs> whose pinboard value is "pins".
export function PinboardTabChip({ active }: { active: boolean }) {
    return (
        <div
            className={cn(
                "flex shrink-0 items-stretch rounded-sm",
                active && "bg-background text-foreground shadow-xs"
            )}
        >
            {/* Auto-layout state, surfaced permanently as the tab's
                left segment: lit when on, muted when off. Disabled while
                THIS strip's pinboard tab is inactive — `active` is the
                host's own flag, so the grid strip's wand works even while
                the board stays hidden on the gallery side (ghp). */}
            <AutoLayoutToggle
                className="rounded-sm rounded-r-none"
                disabled={!active}
            />
            <TabsTrigger
                value="pins"
                className="shrink-0 rounded-none px-2 data-[state=active]:shadow-none"
            >
                Pinboard
            </TabsTrigger>
            <PinboardMenu />
        </div>
    )
}

export function PinboardTabs({ itemPath }: { itemPath: string }) {
    const [hidePinBoard, setHidePinBoard] = useGalleryHidePinBoard()
    const copyPath = useCopyPath()
    // Either separator: the index stores paths as the OS produced them
    const lastSep = Math.max(itemPath.lastIndexOf("/"), itemPath.lastIndexOf("\\"))
    const fileName = itemPath.slice(lastSep + 1)
    return (
        <Tabs
            value={hidePinBoard ? "gallery" : "pins"}
            onValueChange={(value) => setHidePinBoard(value !== "pins")}
            className="w-full"
        >
            <TabsList className="flex w-full">
                <PinboardTabChip active={!hidePinBoard} />
                {/* The truncated path is a tab trigger, so plain click can't
                    copy it the way FilePathComponent's does — right-click
                    provides the copy actions instead. The menu wraps the
                    inner span, NOT the TabsTrigger: ContextMenuTrigger
                    asChild stamps its own data-state ("closed") over the
                    Tabs' data-state ("active"), killing the active-tab
                    styling. */}
                <TabsTrigger value="gallery" className="flex-1 min-w-0">
                    <ContextMenu>
                        <ContextMenuTrigger asChild>
                            <span title={itemPath} className="w-full min-w-0 text-sm truncate cursor-pointer" style={{ direction: 'rtl', textAlign: 'left' }}>
                                {itemPath}
                            </span>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                            <ContextMenuItem onClick={() => copyPath(itemPath)}>
                                Copy Path
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => copyPath(fileName)}>
                                Copy Filename
                            </ContextMenuItem>
                        </ContextMenuContent>
                    </ContextMenu>
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
        showPagination
    }: {
        item: SearchResult,
        prevImage: () => void,
        nextImage: () => void,
        thumbnailsOpen: boolean
        showPagination: boolean
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
    const handleDragStart = (event: React.DragEvent<HTMLImageElement>): void => {
        if (!fileURL) return;
        console.log('dragging', fileURL);
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/plain', item.sha256);
        event.dataTransfer.setData('text/uri-list', fileURL);
    };
    return (
        <div
            className={cn("relative grow flex justify-center items-center overflow-hidden group",
                showPagination ? // Set height to fill the remaining space
                    (thumbnailsOpen ? "h-[calc(100vh-567px)]" : "h-[calc(100vh-213px)]") // Set height based on whether thumbnails are open
                    : (thumbnailsOpen ? "h-[calc(100vh-505px)]" : "h-[calc(100vh-151px)]")
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
                            draggable={true}
                            onDragStart={handleDragStart}
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

