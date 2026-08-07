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
import { useGalleryIndex, getGalleryOptionsSerializer, useGalleryThumbnail, useGalleryPinBoardLayout, useGalleryFullscreen, useGalleryHidePinBoard, useGalleryTrim } from "@/lib/state/gallery"
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
import { NativeControlsEscape, useVideoPlayerSurface, VideoPlayerSurface } from './VideoPlayerSurface'
import { trimWithBound, useVideoTrim } from '@/lib/videoTrim'
import { isEmptyTrim, TrimRange } from '@/lib/pinboardCrop'
import { trimForSha } from '@/lib/galleryTrim'

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

// J / L seek step, in seconds (docs/video-player-ui-design.md)
const SEEK_STEP = 5
// There is no frame-exact web API; centisecond storage resolution makes
// ~1/30 s the right step for , / .
const FRAME_STEP = 1 / 30

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
    // ONE REF OBJECT PER ITEM. The <video> is keyed by sha and remounts on
    // gallery navigation (a bare src swap fires `emptied`, not `pause`), and
    // every player hook binds its listeners once per ref IDENTITY — deps are
    // `[..., videoRef]`. A single stable ref would leave the surface's paused
    // sync, the rail's duration listener and useVideoTrim's seek-to-start
    // bound to the element that just went away.
    //
    // The identity is STATE, not a useMemo: a memo cache React is free to
    // drop would hand out a second ref for the same item, re-running those
    // effects — useVideoTrim would yank the playhead back to the trim start
    // mid-playback. Adjusted during render like `heldIndex` above (a ref READ
    // while rendering is what the React Compiler forbids; creating a plain
    // object is not one, and React attaches the element to it before any
    // effect runs). The pass that schedules the update is thrown away
    // uncommitted, so the stale ref it renders with never reaches the DOM.
    const [videoSlot, setVideoSlot] = useState<{
        sha: string
        ref: React.RefObject<HTMLVideoElement | null>
    }>(() => ({ sha: item.sha256, ref: { current: null } }))
    if (videoSlot.sha !== item.sha256) {
        setVideoSlot({ sha: item.sha256, ref: { current: null } })
    }
    const videoRef = videoSlot.ref
    const videoState = useVideoPlayerState({ videoRef, persistVolume: true })
    const showVideo = isPlayable && videoState.showVideo
    // The wrapper holding the <video> AND the surface: the player's pointer
    // container (useIdleHide requires containment, or the controls vanish
    // under the pointer on the way to them) and its fullscreen target, so
    // fullscreen shows the picture and the player and nothing else — not the
    // header, not the thumbnail strip. Deliberately NOT keyed by item:
    // removing the fullscreen element exits fullscreen, and ← / → must keep
    // browsing inside it.
    const playerHostRef = useRef<HTMLDivElement>(null)
    // Native controls stand the whole player world down; only the escape
    // kebab remains (S2).
    const playerActive = showVideo && !videoState.showControls
    const player = useVideoPlayerSurface({
        videoRef,
        active: playerActive,
        fullscreenTargetRef: playerHostRef,
        // The gallery is one deliberate video at a time: the S0 play press
        // (or a keypress) should land on a visible player
        showOnEnable: true,
    })

    // The `vt` slot is sha-keyed and survives navigation: it is INERT while
    // another item is on screen and comes back to life with its own video.
    const galleryTrim = useGalleryTrim()
    const setGalleryTrim = galleryTrim.setTrim
    const trim = trimForSha(galleryTrim, item.sha256)
    const onTrimChange = (next: TrimRange | null) => {
        void setGalleryTrim(item.sha256, next)
    }
    useVideoTrim({ videoRef, trim, active: showVideo })

    // The gallery's keyboard scope (docs/video-player-ui-design.md). Mounted
    // with the large image, so it is live exactly while the gallery owns the
    // screen and never while the pinboard branch replaces it. Arrows always
    // browse — including inside fullscreen, where only the keyed <video>
    // swaps and the fullscreen wrapper stays put.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // A press aimed at a text field is that field's own edit, and an
            // open dialog owns the keyboard over the gallery (matched against
            // the document, like GalleryPinBoard's Delete handler: Radix parks
            // focus on the dialog content or on <body>)
            const t = e.target as HTMLElement | null
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
            // Any open popup layer owns the keyboard over the gallery: dialogs
            // (library, rename, confirms) and the Radix menus that render
            // ALONGSIDE the large image — the pinboard tab strip's dropdown,
            // context menus, selects — whose own arrow keys must not double as
            // gallery navigation.
            if (document.querySelector(
                '[role="dialog"], [role="menu"], [role="listbox"],'
                + ' [data-radix-popper-content-wrapper]'
            )) return
            // Modified presses belong to the browser and to app shortcuts
            // (Ctrl+Shift+M above); shift is a documented modifier for the
            // loop keys alone.
            if (e.ctrlKey || e.metaKey || e.altKey) return
            const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
            if (key === "ArrowLeft" || key === "ArrowRight") {
                // One press, one item: `gi` is a history:push param, and
                // autorepeat (~30 Hz) would bury the back button under a
                // stream of entries and overlap the page-turn promises at a
                // page boundary. The seek keys below repeat freely — they
                // write no history.
                if (e.shiftKey || e.repeat) return
                e.preventDefault()
                if (key === "ArrowLeft") prevImage()
                else nextImage()
                return
            }
            if (!isPlayable) return
            const video = videoRef.current
            // Space/K reach S0 too — they are how the video is loaded. A
            // focused control keeps its own activation: Space is that
            // control's press, and taking it would make the surface's trim
            // popover (and every other button on the picture) keyboard-dead.
            if (key === " " || key === "k") {
                const focused = document.activeElement
                if (focused && (
                    focused.tagName === "BUTTON"
                    || focused.tagName === "A"
                    || focused.getAttribute("role") === "menuitem"
                )) return
                if (e.shiftKey) return
                e.preventDefault()
                videoState.setPlaying(video ? video.paused : true)
                player.show()
                return
            }
            // Every other verb needs a loaded video, and the playhead ones
            // need the element itself
            if (!showVideo) return
            const seekTo = (time: number) => {
                if (!video) return
                const duration = isFinite(video.duration) ? video.duration : Infinity
                video.currentTime = Math.max(0, Math.min(duration, time))
            }
            switch (key) {
                case "m":
                    if (e.shiftKey) return
                    e.preventDefault()
                    videoState.setMuted(!videoState.videoIsMuted)
                    break
                case "f":
                    // Not while the native controls have the video: the
                    // player world is stood down there, and the controller's
                    // exit-on-inactive rule would drop straight back out of
                    // the fullscreen this just entered
                    if (e.shiftKey || !playerActive) return
                    e.preventDefault()
                    player.toggleFullscreen()
                    break
                case "i":
                case "o": {
                    if (!video) return
                    const which = key === "i" ? "start" : "end"
                    e.preventDefault()
                    // Shift clears that bound; the placement rule (and the
                    // centisecond rounding) is the surface's own
                    const next = trimWithBound(trim, which, e.shiftKey ? null : video.currentTime)
                    onTrimChange(next)
                    // Setting the end mid-playback parks the playhead exactly
                    // at the end point, from which crossing detection would
                    // never fire — restart the loop
                    if (which === "end" && !e.shiftKey && !video.paused) {
                        video.currentTime = next?.start ?? 0
                    }
                    break
                }
                case ",":
                case ".": {
                    if (!video || e.shiftKey) return
                    e.preventDefault()
                    videoState.setPlaying(false)
                    seekTo(video.currentTime + (key === "," ? -FRAME_STEP : FRAME_STEP))
                    break
                }
                case "j":
                case "l": {
                    if (!video || e.shiftKey) return
                    e.preventDefault()
                    seekTo(video.currentTime + (key === "j" ? -SEEK_STEP : SEEK_STEP))
                    break
                }
                default:
                    return
            }
            // The player reports what a key just did; a paused one then stays
            // up on its own (useIdleHide's holdIdle)
            player.show()
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [isPlayable, showVideo, playerActive, prevImage, nextImage, videoState, player, trim, videoRef, setGalleryTrim, item.sha256])

    const handleDragStart = (event: React.DragEvent<HTMLImageElement>): void => {
        if (!fileURL) return;
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
                {showVideo ?
                    <div
                        ref={playerHostRef}
                        className={cn(
                            "absolute inset-0 flex justify-center items-center",
                            player.cursorHidden && "cursor-none",
                        )}
                        // Only while the player world is on: these fire on
                        // every pointer move, and a video handed over to the
                        // native controls has no surface to reveal
                        {...(playerActive ? player.containerProps : null)}
                        // In fullscreen the picture IS the player: it toggles
                        // playback instead of paging to the next item (the
                        // click-to-navigate halves are an out-of-fullscreen
                        // affordance). On the host, not on the <video>, so the
                        // letterbox bars behave the same as the picture.
                        onClick={(e) => {
                            if (!player.isFullscreen) return
                            e.stopPropagation()
                            videoState.setPlaying(player.paused)
                        }}
                    >
                        <video
                            // Keyed by item: navigation must give the player a
                            // FRESH element. A reused one keeps the previous
                            // video's playback state (a src swap fires
                            // `emptied`, not `pause`) — see videoRef above,
                            // which re-binds the hooks that listen to it.
                            key={item.sha256}
                            ref={videoRef}
                            autoPlay
                            // With a trim set, looping is useVideoTrim's job so
                            // it restarts from the trim start rather than 0
                            loop={isEmptyTrim(trim)}
                            muted={videoState.videoIsMuted}
                            controls={videoState.showControls}
                            className="rounded object-contain max-h-full h-full"
                            src={fileURL}
                            onClick={(e) => videoState.showControls && e.stopPropagation()}
                        />
                        {/* S1, or the lone escape kebab while the native
                            controls have the video (S2). Both swallow their
                            own clicks, so neither reaches the click-to-
                            navigate wrapper around this host. */}
                        {videoState.showControls
                            ? <NativeControlsEscape videoState={videoState} />
                            : <VideoPlayerSurface
                                videoRef={videoRef}
                                videoState={videoState}
                                controller={player}
                                trim={trim}
                                onTrimChange={onTrimChange}
                                size="full"
                            />}
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
            {/* S0 only: the play button is the last overlay verb ("become a
                player"), and it sits bottom-LEFT so the cursor is already on
                the player row's play/pause the moment S1 comes up. Once the
                video is loaded the surface owns mute, close and the native
                toggle, so MediaControls stands down entirely. */}
            {isPlayable && !showVideo && <MediaControls
                isPlaying={false}
                setPlaying={(playing) => {
                    videoState.setPlaying(playing)
                    player.show()
                }}
                playButtonClassName="left-2 bottom-2"
            />}
        </div>
    )
}

