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
import { cn, downloadFileName, fileNameFromPath, getFileURL, getLocale } from "@/lib/utils"
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
import { PLAYBACK_RATES, useVideoPlayerState } from '@/lib/videoPlayerState'
import { NativeControlsEscape, PLAYER_SIZE_FULL_WIDTH, playerSizeForWidth, useVideoPlayerSurface, VideoPlayerSurface } from './VideoPlayerSurface'
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
    const fileName = fileNameFromPath(itemPath)
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

// Click-zone geometry for a LOADED gallery video (docs/video-player-ui-design
// .md, "Fullscreen"). NAV_MIN is the minimum comfortable width, per side, of
// the click-to-navigate strip: with at least this much horizontal letterbox
// beside the picture, the whole picture is the play/pause zone and navigation
// lives entirely outside it. Below it the nav strips encroach onto the video
// by NAV_MIN - L per side...
const NAV_MIN = 96
// ...but never past this fraction of the video's width per side, so a
// play/pause strip of at least 40% of the video always survives.
const NAV_ENCROACH_MAX = 0.3

// The picture a contain fit paints inside `box`, as CSS offsets against that
// box. Null while the aspect or the box is still unknown — callers then fall
// back to the box itself, which is exactly what the overlays anchored to
// before anything could be measured.
//
// This mirrors what the browser already does: the gallery's <video> is
// `h-full` with an auto width in a centering flex row, so its element box IS
// the contain fit (a wide video shrinks to the panel width and letterboxes
// vertically via object-contain; a tall one hugs the picture). The numbers
// are recomputed here because the surface's floor is a clamp against a px
// constant and its tier is read off the resulting width — neither of which a
// shrink-to-fit box can express.
function fitBox(box: { w: number; h: number }, ratio: number | null) {
    if (!box.w || !box.h || !ratio || !isFinite(ratio) || ratio <= 0) return null
    const width = Math.min(box.w, box.h * ratio)
    const height = Math.min(box.h, box.w / ratio)
    return {
        width,
        height,
        left: (box.w - width) / 2,
        bottom: (box.h - height) / 2,
    }
}

// Content box of an element, tracked live. The measurement runs in an effect
// (a ref read during render is what the React Compiler forbids) and the state
// only changes when the numbers do, so a ResizeObserver that fires on every
// layout pass costs one comparison.
function useBoxSize(ref: React.RefObject<HTMLElement | null>, enabled: boolean) {
    const [box, setBox] = useState({ w: 0, h: 0 })
    useEffect(() => {
        const el = ref.current
        if (!enabled || !el) return
        const measure = () => setBox((prev) => (
            prev.w === el.clientWidth && prev.h === el.clientHeight
                ? prev
                : { w: el.clientWidth, h: el.clientHeight }
        ))
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        return () => ro.disconnect()
    }, [ref, enabled])
    return box
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
    // The panel: the letterbox frame both the thumbnail and the video are
    // painted in, and what the overlays' footprint is computed from below.
    const panelRef = useRef<HTMLDivElement>(null)
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

    // Aspect of the DISPLAYED picture, from whichever element has confirmed
    // it: the video's videoWidth/videoHeight (S1) or the thumbnail's natural
    // size (S0). Both are rotation-corrected, and that is the whole point —
    // item.width/height are the CODED dimensions, which a phone video with a
    // 90° display matrix stores swapped, so anchoring to them would drop the
    // S0 play button into the middle of the picture. They stay as the
    // pre-load approximation, and nothing else: element-confirmed > item
    // dimensions > null (overlays span the panel, as before any of this).
    // Keyed by sha, so the item that just left can never size the incoming
    // one's overlays — the same rule as the video ref slot.
    const [mediaAspect, setMediaAspect] = useState<{ sha: string; ratio: number } | null>(null)
    const ratio = mediaAspect?.sha === item.sha256
        ? mediaAspect.ratio
        : item.width && item.height ? item.width / item.height : null

    // The thumbnail's own aspect, taken from the loaded element. First writer
    // per sha wins, so it never overwrites the video's exact metadata (the
    // two are never mounted at the same time, and this also makes the ref
    // callback idempotent — it re-runs on every render that re-creates it).
    const noteThumbAspect = (el: HTMLImageElement | null) => {
        if (!el || !el.naturalWidth || !el.naturalHeight) return
        const thumbRatio = el.naturalWidth / el.naturalHeight
        setMediaAspect((prev) => (
            prev?.sha === item.sha256 ? prev : { sha: item.sha256, ratio: thumbRatio }
        ))
    }

    // The picture both states paint, as a box. The PANEL is the letterbox
    // frame for both: the S0 thumbnail fills it, and the player host is
    // `absolute inset-0` of it. Measuring the panel rather than the host means
    // that when the item carries dimensions (they are optional server-side)
    // the box is already known as the video loads, so the surface does not
    // paint one panel-wide frame before snapping. The host differs only in
    // fullscreen, where the surface spans it anyway. Image items measure
    // nothing and render no box at all.
    const panelBox = useBoxSize(panelRef, isPlayable)
    const pictureBox = isPlayable ? fitBox(panelBox, ratio) : null

    // S1 footprint. The surface hugs the DISPLAYED video rather than the
    // panel (docs/video-player-ui-design.md, "Size ladder"): the gallery panel
    // is far wider than a letterboxed picture and a panel-wide row over empty
    // letterbox reads as sparse. Floor = PLAYER_SIZE_FULL_WIDTH, the width the
    // full control row itself needs, so it only engages for videos narrower
    // than the row; cap = the panel, which is all the surface ever had. The
    // tier follows from the resulting width, so a panel under 280px degrades
    // to medium/mini exactly like a pin does. In fullscreen the player owns
    // the screen and the surface spans it, the way every fullscreen video's
    // controls do.
    const surfaceWidth = pictureBox
        ? Math.min(panelBox.w, Math.max(pictureBox.width, PLAYER_SIZE_FULL_WIDTH))
        : 0
    const surfaceBox = pictureBox && !player.isFullscreen
        ? {
            width: surfaceWidth,
            height: pictureBox.height,
            // Centred on the picture, bottom-aligned with its bottom edge
            left: (panelBox.w - surfaceWidth) / 2,
            bottom: pictureBox.bottom,
        }
        : null

    // S0 footprint: the play button anchors to the thumbnail's rendered
    // corner, not the panel's.
    const thumbBox = showVideo ? null : pictureBox

    // Click-to-navigate halves vs click-to-play/pause. The zones exist only
    // while the player world is on (S1, playing OR paused) and outside
    // fullscreen, where the picture already toggles playback on the host
    // itself; S0 thumbnails, plain images and native-controls mode keep the
    // pure navigate halves. Geometry source = the SAME measured picture box
    // the surface hugs, so the zone can never disagree with what is painted;
    // while it is unknown (no metadata yet) every click navigates, exactly as
    // before the box existed.
    const handleImageClick = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
        const { clientX, clientY, currentTarget } = e
        e.stopPropagation()
        const panel = panelRef.current
        if (playerActive && !player.isFullscreen && pictureBox && panel) {
            const rect = panel.getBoundingClientRect()
            // fitBox centres the picture, so `left` and `bottom` are the
            // letterbox per side on their own axis — `left` IS L.
            const videoLeft = rect.left + pictureBox.left
            const videoTop = rect.top + pictureBox.bottom
            // Zero when the letterbox alone already affords NAV_MIN per side
            const encroach = Math.max(0, Math.min(
                NAV_MIN - pictureBox.left,
                NAV_ENCROACH_MAX * pictureBox.width,
            ))
            const inPlayZone =
                clientX >= videoLeft + encroach
                && clientX <= videoLeft + pictureBox.width - encroach
                && clientY >= videoTop
                && clientY <= videoTop + pictureBox.height
            if (inPlayZone) {
                // The surface's own play button verb. Read off the ELEMENT,
                // like the keyboard path: the controller's `paused` is synced
                // by play/pause listeners and can be one commit behind the
                // click that lands on it. (A handler, not render scope — the
                // React Compiler's ban is on ref reads while rendering.)
                videoState.setPlaying(videoRef.current?.paused ?? true)
                player.show()
                return
            }
        }
        const { left, right } = currentTarget.getBoundingClientRect()
        const middle = (left + right) / 2
        if (clientX > middle) {
            nextImage()
        } else {
            prevImage()
        }
    }

    // The wrapper's cursor-pointer promises navigation, which over a play/
    // pause zone is a lie. Only when the whole picture is that zone does the
    // <video> element box coincide with it (a video wide enough to hit
    // max-w-full keeps full panel height and letterboxes INSIDE its own box),
    // so this is the one place the honest cursor costs no extra layer and no
    // pointer-events juggling. Never in fullscreen, where the controller's
    // cursor-none on the host must win.
    const videoIsPlayZone = playerActive && !player.isFullscreen
        && !!pictureBox && pictureBox.left >= NAV_MIN

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
            // (Ctrl+Shift+M above); shift is documented for the loop keys
            // (clear that bound) and for the speed keys, which ARE the
            // shifted glyphs < and >.
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
                case "<":
                case ">": {
                    // Shift-comma / shift-period: the shifted twins of the
                    // frame-step keys, and shifted is all they are — the
                    // browser reports the glyph, so neither can reach the
                    // unshifted cases above.
                    e.preventDefault()
                    // Step to the next rung strictly past the current rate and
                    // clamp at the ends. Strict comparison rather than an index
                    // lookup: the native speed menu can park the element off
                    // the ladder, and the nearest rung is still the right
                    // answer from there. Element truth, not React state — the
                    // state only learns a natively-set rate at the setControls
                    // resync, and stepping from the stale value can reverse
                    // the key's direction (1.75 + ">" must give 2, not 1.5).
                    const rate = video?.playbackRate ?? videoState.playbackRate
                    const next = key === "<"
                        ? [...PLAYBACK_RATES].reverse().find((r) => r < rate) ?? PLAYBACK_RATES[0]
                        : PLAYBACK_RATES.find((r) => r > rate) ?? PLAYBACK_RATES[PLAYBACK_RATES.length - 1]
                    videoState.setPlaybackRate(next)
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
            ref={panelRef}
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
                            // max-w-full is load-bearing, not decoration: a
                            // flex item with a definite cross size (h-full)
                            // and an aspect ratio has an automatic minimum
                            // width equal to its ratio-derived width, and only
                            // a definite max main size clamps that minimum. It
                            // is what pins the element box to the panel and
                            // makes the picture the contain fit fitBox
                            // computes the surface's footprint from.
                            className={cn(
                                "rounded object-contain max-h-full max-w-full h-full",
                                videoIsPlayZone && "cursor-default",
                            )}
                            src={fileURL}
                            // The element's own dimensions are the display
                            // ones (a rotated video reports them rotated), and
                            // they outrank both the thumbnail's and the item's
                            onLoadedMetadata={(e) => {
                                const { videoWidth, videoHeight } = e.currentTarget
                                if (videoWidth && videoHeight) {
                                    setMediaAspect({
                                        sha: item.sha256,
                                        ratio: videoWidth / videoHeight,
                                    })
                                }
                            }}
                            onClick={(e) => videoState.showControls && e.stopPropagation()}
                        />
                        {/* S1, or the lone escape kebab while the native
                            controls have the video (S2). Both swallow their
                            own clicks, so neither reaches the click-to-
                            navigate wrapper around this host. */}
                        {videoState.showControls
                            // S2's lone kebab belongs beside the native
                            // control bar it escapes from, so it anchors to
                            // the picture like S0 and S1. The box is
                            // pointer-transparent (the kebab re-enables
                            // itself) — the native controls are painted by the
                            // element UNDER it and must stay clickable.
                            ? <div
                                className={cn(
                                    "pointer-events-none absolute",
                                    !pictureBox && "inset-0",
                                )}
                                style={pictureBox ?? undefined}
                            >
                                <NativeControlsEscape
                                    videoState={videoState}
                                    className="pointer-events-auto"
                                />
                            </div>
                            // The surface's own box, laid over the displayed
                            // picture. Pointer-TRANSPARENT: the host still
                            // spans the whole panel so the click-to-navigate
                            // halves keep working in the letterbox beside a
                            // portrait video, and only the surface's control
                            // layers (pointer-events-auto) take events.
                            // Unmeasured, it spans the host — the layout the
                            // surface had before this box existed.
                            : <div
                                className={cn(
                                    "pointer-events-none absolute",
                                    !surfaceBox && "inset-x-0 bottom-0",
                                )}
                                style={surfaceBox ?? undefined}
                            >
                                <VideoPlayerSurface
                                    videoRef={videoRef}
                                    videoState={videoState}
                                    controller={player}
                                    trim={trim}
                                    onTrimChange={onTrimChange}
                                    // The very URL the element plays, so the
                                    // download is the original file and not a
                                    // re-encode. The server's own
                                    // Content-Disposition also carries the
                                    // indexed name, but stripped to Latin-1 —
                                    // the attribute supplies the full UTF-8
                                    // name and a deterministic one for
                                    // pathless items.
                                    download={{
                                        url: fileURL,
                                        filename: downloadFileName(
                                            item.path, item.sha256, item.type),
                                    }}
                                    size={surfaceBox ? playerSizeForWidth(surfaceWidth) : "full"}
                                />
                            </div>}
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
                            // Playable items only — a plain image renders
                            // exactly as it always did, with no aspect
                            // bookkeeping and no overlay box to anchor. The
                            // ref covers cache hits that complete before React
                            // attaches onLoad (same pattern as the pin's
                            // thumbnail); onLoad covers the network path.
                            ref={isPlayable ? ((el) => {
                                if (el?.complete) noteThumbAspect(el)
                            }) : undefined}
                            onLoad={isPlayable
                                ? ((e) => noteThumbAspect(e.currentTarget))
                                : undefined}
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
            {isPlayable && !showVideo && (
                // Anchored to the thumbnail's rendered corner, not the
                // panel's, so the button sits ON the picture. The box is
                // pointer-transparent (the button re-enables itself): it
                // covers the thumbnail, and the <a>/<Image> underneath must
                // keep their click-to-navigate and drag behavior. Unmeasured,
                // it spans the panel — the button's old anchor.
                <div
                    className={cn("pointer-events-none absolute", !thumbBox && "inset-0")}
                    style={thumbBox ?? undefined}
                >
                    <MediaControls
                        isPlaying={false}
                        setPlaying={(playing) => {
                            videoState.setPlaying(playing)
                            player.show()
                        }}
                        playButtonClassName="pointer-events-auto left-2 bottom-2"
                    />
                </div>
            )}
        </div>
    )
}

