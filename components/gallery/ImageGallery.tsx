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
import { usePageSize, useSearchPage, useSearchPageRaw } from '@/lib/state/searchQuery/clientHooks'
import { useGridScrollAnchor } from '@/lib/state/gridScroll'
import { useFetchPageRows, usePrefetchPageState } from '@/lib/searchHooks'
import { serializers } from '@/lib/state/searchQuery/serializers'
import { VirtualGalleryHorizontalScroll } from './VirtualizedHorizontalScroll'
import { PinBoard } from './GalleryPinBoard'
import { AutoLayoutToggle, PinboardMenu } from './PinboardMenu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { useSearchLoading } from '@/lib/state/zust'
import { MediaControls } from './PlayButton'
import React from 'react'
import { PLAYBACK_RATES, setGalleryEndAction, useGalleryEndAction, useOutroSkipEnabled, useVideoPlayerState } from '@/lib/videoPlayerState'
import { GALLERY_SURFACE_FLOOR, NativeControlsEscape, playerSizeForWidth, useVideoPlayerSurface, VideoPlayerSurface } from './VideoPlayerSurface'
import { effectiveVideoTrim, outroCutPoint, outroProbeEligible, trimWithBound, useVideoDuration, useVideoTrim } from '@/lib/videoTrim'
import { useVideoEndProbe } from '@/lib/videoEndProbe'
import { isEmptyTrim, TrimRange } from '@/lib/pinboardCrop'
import { trimForSha } from '@/lib/galleryTrim'

// What the gallery counts as a video: exactly what its <video> element is
// allowed to load, and therefore exactly what the auto-advance chain may move
// to (docs/video-end-action-design.md §3). Everything else — images,
// animations, containers the browser will not play — is "not a video" here,
// which is precisely what makes an unattended chain safe. ONE predicate for
// the player gate and the advance scan: two copies of this list would let the
// gallery advance onto something it then refuses to play.
function isPlayableVideo(type: string | null | undefined): boolean {
    return type === "video/mp4" || type === "video/webm"
}

// Eviction horizon for the next page's rows, far above react-query's 5-minute
// default (docs/video-end-action-design.md §3). The ahead-of-turn prefetch
// fires when a video BECOMES current and its entry is consumed when that video
// ENDS, with zero observers in between — at the default a video longer than
// five minutes would watch the entry it warmed get garbage-collected before
// the turn arrived. The horizon applies to the entries THIS path creates: the
// turn's own fetch passes it too, but only reaches fetchQuery on a cache MISS
// — a hit returns before it, so that entry keeps whatever horizon its creator
// gave it (a manual page turn's prefetch, say, keeps the 5-minute default).
// Which is fine: the flip puts a live observer on the entry immediately, and
// GC only ever collects unobserved ones.
const PREFETCH_GC_TIME = 30 * 60 * 1000

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
    queryEnabled,
}: {
    items: SearchResult[]
    totalPages: number
    setPage: (page: number) => Promise<void>
    /** These results belong to a different page than the URL names — see useSearch */
    resultsAreStale?: boolean
    /**
     * Is the LIVE search actually being served? False while the update lock
     * withholds uncommitted sidebar edits, while input is invalid, or while a
     * maximized board suspends searching — see useSearch. Everything on the
     * auto-advance path stands down on it (docs/video-end-action-design.md
     * §3): `resultsAreStale` is deliberately false in the update-lock state,
     * so it cannot carry this, and without its own gate a video ending
     * mid-edit would fetch and land on a search the user withheld.
     */
    queryEnabled: boolean
}) {
    const [qIndex, setIndex] = useGalleryIndex()
    const [page] = useSearchPage()
    // The raw `page` setter, and the grid's scroll anchor: the auto page turn
    // writes both itself instead of going through the useSearchPage wrapper —
    // see turnPageToNextVideo below for why it must.
    const setPageRaw = useSearchPageRaw()[1]
    const [scrollAnchor, setScrollAnchor] = useGridScrollAnchor()
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

    // ---- Auto-advance (docs/video-end-action-design.md §3) ---------------
    //
    // Owned here because this is the component that has `items`, `page` and
    // `totalPages`; the player host only reports that a video reached its end
    // (or failed to load) and is handed the two verbs below. Every URL write
    // on this path is `history: "replace"` (§4) — an unattended session must
    // not bury the back button under one entry per video.
    const mode = useGalleryEndAction()
    // The mode as of the last commit, for the page turn's continuation to
    // re-check after its await: the render scope's `mode` there is whatever it
    // was when the video ended, and switching off `advance` mid-fetch must
    // write nothing. Synced in an effect rather than during render because
    // this ref is only ever read after an await — "the mode at write time" IS
    // the last committed one — and a ref touched while rendering is what the
    // React Compiler (on, see next.config.mjs) objects to.
    const modeRef = useRef(mode)
    useEffect(() => {
        modeRef.current = mode
    }, [mode])
    // Everything else the page turn's continuation has to re-check after its
    // await, as of the last commit — same pattern and same reason as modeRef
    // (written after every commit, read only past an await, never during
    // render). The supersession token covers the verbs the GALLERY owns; this
    // covers every writer it does not: a PageSelect click, browser Back or
    // Forward, a query edit with instant search on, a page-size commit. And
    // `items` is compared by IDENTITY, because the page number cannot catch
    // all of them — a query edit can leave `page` and `gi` numerically
    // unchanged while swapping the entire row set, and a bookmark patch
    // rewrites the results object under a page that never moved. Any new
    // results object means something moved under the turn. Cancelling a turn
    // that was in fact still legitimate just ends the chain, which is the
    // honest outcome: nothing rearms it but a real playback reaching a real
    // end, and the user is right there having just navigated.
    const turnGatesRef = useRef({ page, qIndex, items, resultsAreStale, queryEnabled })
    useEffect(() => {
        turnGatesRef.current = { page, qIndex, items, resultsAreStale, queryEnabled }
    })
    // Did a video actually finish playing on THIS page? An auto page turn
    // requires it (§"Broken videos"): error skips chain freely within a page,
    // but a page of nothing but broken videos has to stop at that page's edge
    // rather than crawl the whole result set. Set by end-of-playback advances
    // only, never by error ones, and cleared on every page change — auto or
    // manual, which is what the effect (rather than the turn alone) covers.
    //
    // Keyed on the results identity as well as the page number, because a
    // query change can leave the number alone (page 1 → new query → still
    // page 1) while replacing every row, and a flag left standing there would
    // authorize one page turn on a result set nothing ever played on. A new
    // results object IS a new page in every sense that matters here. The same
    // effect re-arms the ahead-of-turn prefetch below, for the same reason
    // plus one of its own: that once-guard is keyed `${page}:${sha}`, which
    // collides across different searches that put the same file at the same
    // position, and otherwise never resets once its entry has been collected.
    const playedThisPageRef = useRef(false)
    const prefetchedForRef = useRef<string | null>(null)
    useEffect(() => {
        playedThisPageRef.current = false
        prefetchedForRef.current = null
    }, [page, items])
    // The in-flight page turn, as the useCommitPageSize supersession pattern:
    // a unique object captured before the fetch and re-checked after it. The
    // await is a window the user can act in — arrows, closing the gallery, a
    // mode change, a play on the parked video — and a turn whose token is no
    // longer the current one writes NOTHING. A stale intent must never move
    // the gallery after the user has taken over.
    const turnTokenRef = useRef<object | null>(null)
    const cancelPendingAdvance = () => {
        turnTokenRef.current = null
    }
    // Every other way the gallery can go away is a close too — the results
    // emptying, the grid taking over, a navigation — and a turn resolving
    // after one of those would write a page and an index for a gallery nobody
    // is looking at. The net under closeGallery's own cancel, not a
    // replacement for it.
    useEffect(() => () => {
        turnTokenRef.current = null
    }, [])

    const nextImage = () => {
        cancelPendingAdvance()
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
        cancelPendingAdvance()
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

    const closeGallery = () => {
        cancelPendingAdvance()
        setIndex(null)
    }

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
    // Which branch this gallery is: the large image (the player world, and the
    // only place this feature exists) or the pinboard. Named because the
    // prefetch effect below has to stand down on exactly the condition the
    // JSX renders the board on — pins are an arrangement, not a sequence, and
    // nothing about the end action may reach them.
    const showsLargeImage = pinboard.length === 0 || hidePinBoard

    const fetchPageRows = useFetchPageRows()
    const prefetchPageState = usePrefetchPageState()
    // The functions those two hooks return are re-created every render, so
    // neither can appear in an effect's dep array without re-running that
    // effect on every render. `fetchPageRows` is called from a callback, which
    // closes over the current render's copy for free; the prefetch runs from
    // an effect, so it reads the latest one through this ref. Written after
    // every commit and read only from an effect body — never while rendering.
    const prefetchRef = useRef(prefetchPageState)
    useEffect(() => {
        prefetchRef.current = prefetchPageState
    })

    // Fetch, THEN flip. The URL must not move to a page whose rows are not yet
    // in hand: flipping first would resolve the old (or held) index against
    // rows that only arrive later and show a wrong item for the whole fetch —
    // and in fullscreen a commit whose current item is transiently not a
    // playable video is exactly what closes the fullscreen box (§"Fullscreen
    // continuity"). So the landing index is chosen from the fetched rows, and
    // written together with the page in one tick. During the await the gallery
    // simply keeps showing the ended video, parked and paused.
    const turnPageToNextVideo = async (isFullscreen: () => boolean) => {
        const token = {}
        turnTokenRef.current = token
        // The state this turn was decided against, to compare the post-await
        // one with. Captured from the render scope, which is the last commit's
        // — the same commit turnGatesRef holds at this point.
        const from = { page, qIndex, items }
        let rows: SearchResult[]
        try {
            // Cache first — the ahead-of-turn prefetch below should already
            // have made this a hit. A failure ends the chain: the video stays
            // parked and nothing is written (an empty array is the legitimate
            // "that page has no rows", which is why the hook throws instead).
            rows = await fetchPageRows({ page: page + 1 }, { gcTime: PREFETCH_GC_TIME })
        } catch {
            if (turnTokenRef.current === token) turnTokenRef.current = null
            return
        }
        // Superseded while the fetch was in the air: that intent owns the
        // gallery now, and this one writes nothing. Checked before the mode,
        // so a newer turn's token is never cleared by an older turn's exit.
        if (turnTokenRef.current !== token) return
        if (modeRef.current !== "advance") {
            turnTokenRef.current = null
            return
        }
        // The token only covers the gallery's OWN verbs — arrows, close, a
        // play on the parked video — because those are the only ones that call
        // cancelPendingAdvance. Everything else that can move the search during
        // a cold fetch (a PageSelect click, Back/Forward, a query edit under
        // instant search, a page-size commit) leaves it untouched, and a turn
        // that then wrote its batch would silently overwrite the user's
        // navigation. So: nothing may have moved. `items` is compared by
        // identity, which is what catches the case no page number can — a query
        // whose new rows land under the same page and the same index.
        const gates = turnGatesRef.current
        if (
            gates.page !== from.page
            || gates.qIndex !== from.qIndex
            || gates.items !== from.items
            || gates.resultsAreStale
            || !gates.queryEnabled
        ) {
            if (turnTokenRef.current === token) turnTokenRef.current = null
            return
        }
        // A page the gallery cannot even render is not a landing, it is the
        // end of the chain: SearchPage only mounts the gallery while there are
        // results, so writing page + 1 onto an empty page would unmount it and
        // dump the user into the grid — in fullscreen, out of fullscreen too.
        // Reachable whenever the result set shrank after the count query
        // answered, since totalPages is only ever as fresh as nResults.
        if (rows.length === 0) {
            turnTokenRef.current = null
            return
        }
        const k = rows.findIndex((row) => isPlayableVideo(row.type))
        // Read at DECISION time, not at fire time: the user can enter or leave
        // fullscreen during the fetch, and a boolean captured before it gets
        // both directions wrong — an exit would end a chain the windowed rules
        // say should turn, and an entry would write gi = 0 onto an image and
        // force-exit the fullscreen just entered.
        if (k < 0 && isFullscreen()) {
            // A videoless landing page in fullscreen: writing gi = 0 onto an
            // image unmounts the player host and force-exits fullscreen
            // mid-binge. Nothing may leave the user in a fullscreen box with
            // no video in it, so the chain ends here instead — parked on the
            // last video's end frame, fullscreen intact. The
            // land-where-it-ended convenience this gives up only has value
            // outside fullscreen, where it positions the grid.
            turnTokenRef.current = null
            return
        }
        // Windowed, with no video on the next page: the page still turns and
        // the user lands at the top of the page that ended the session, never
        // two pages out. Either way the chain is over after this.
        const targetGi = k < 0 ? 0 : k
        // Raw setters, ONE tick, an explicit `history: "replace"` on every
        // member — the useCommitPageSize write pattern, for its reasons. nuqs
        // coalesces same-tick writes into a single URL update but escalates
        // the whole batch to `push` if any member asks for it, so this must
        // not go through useSearchPage's wrapper, whose internal default-push
        // setGi(0) would both escalate the batch and clobber the target index.
        // Unchanged values are skipped: a setter called with what it already
        // holds can still produce a history entry for an identical URL. (The
        // page is the one member that cannot be unchanged — page + 1 is never
        // page — so it has no skip test to write.)
        const replace = { history: "replace" as const }
        const writes: Promise<unknown>[] = [setPageRaw(page + 1, replace)]
        if (targetGi !== qIndex) writes.push(setIndex(targetGi, replace))
        // The wrapper we bypassed is also what drops the previous page's grid
        // anchor, so this has to do it: same rule as useCommitPageSize's, the
        // anchor follows the position, and it is absent while that position is
        // the top of the page — which the auto turn's landing usually is.
        const nextAnchor = targetGi > 0 ? targetGi : null
        if (nextAnchor !== scrollAnchor) writes.push(setScrollAnchor(nextAnchor, replace))
        // Cleared by the page-change effect too; set here so the window
        // between this write and that effect cannot turn a second page.
        playedThisPageRef.current = false
        turnTokenRef.current = null
        await Promise.all(writes)
    }

    // What a video reaching its end — or failing to load — does in `advance`
    // mode. The three gates are checked at entry, and a failed one ends the
    // chain outright: nothing is written, and nothing rearms it except a real
    // playback reaching a real end.
    const advanceToNextVideo = ({ playback, isFullscreen }: {
        /** A real end of playback, as opposed to an error skip. */
        playback: boolean
        /**
         * Is the player in fullscreen RIGHT NOW (§"Fullscreen continuity")? A
         * live getter rather than a flag, because the page turn reads it after
         * an await the user can enter or leave fullscreen during.
         */
        isFullscreen: () => boolean
    }) => {
        // Stale results: an index chosen against rows the URL no longer names
        // is the exact mistake the heldIndex machinery exists to prevent.
        // Withheld query: see the `queryEnabled` prop.
        if (mode !== "advance" || resultsAreStale || !queryEnabled) return
        // Reaching an end IS playback on this page, even when the scan below
        // then finds nothing to advance to — the flag records that this page
        // played, not that it advanced. Error skips never set it.
        if (playback) playedThisPageRef.current = true
        for (let i = index + 1; i < items.length; i++) {
            if (isPlayableVideo(items[i].type)) {
                // The arrow-key path minus the history entry: the element is
                // keyed by sha, showVideo survives navigation, and autoPlay
                // starts the next video.
                setIndex(i, { history: "replace" })
                return
            }
        }
        // Nothing playable left on this page. The last page parks (reaching
        // the last video on the last page ends playback), and a page no video
        // ever finished on never turns — that is the whole point of the flag.
        if (page >= totalPages) return
        if (!playedThisPageRef.current) return
        void turnPageToNextVideo(isFullscreen)
    }

    // Warm the next page while the last playable item of a non-final page is
    // current, so the end-of-video fetch is a cache hit and not a NAS-speed
    // round trip between the last frame and the next video. Fires once per
    // (page, sha), the guard re-armed on every new row set by the effect
    // above; the deps churn with every new results object and the guard makes
    // those re-runs free. Failures are ignored — the turn's own fetch is the
    // retry, which is also the design's accepted fallback for the cold cases
    // this guard cannot rule out. Deliberately NOT gated on showVideo (advance
    // mode plus standing on the last playable item is already the signal, and
    // one page of rows is cheap), but gated on the same flags as the scan, and
    // on the large-image branch: the pinboard must not acquire a background
    // fetch it has no use for. `silent`: no user gesture is behind this fetch,
    // so it must not arm the global search spinner (see usePrefetchPageState).
    useEffect(() => {
        if (!showsLargeImage) return
        if (mode !== "advance" || resultsAreStale || !queryEnabled) return
        if (page >= totalPages) return
        const current = items[index]
        if (!current || !isPlayableVideo(current.type)) return
        for (let i = index + 1; i < items.length; i++) {
            if (isPlayableVideo(items[i].type)) return
        }
        const key = `${page}:${current.sha256}`
        if (prefetchedForRef.current === key) return
        prefetchedForRef.current = key
        void prefetchRef.current(
            { page: page + 1 },
            { gcTime: PREFETCH_GC_TIME, silent: true },
        ).catch(() => { })
    }, [showsLargeImage, mode, items, index, page, totalPages, resultsAreStale, queryEnabled])

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
            {showsLargeImage ? <GalleryImageLarge
                item={currentItem}
                prevImage={prevImage}
                nextImage={nextImage}
                thumbnailsOpen={thumbnailsOpen}
                showPagination={totalPages > 1}
                advanceToNextVideo={advanceToNextVideo}
                cancelPendingAdvance={cancelPendingAdvance}
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
        showPagination,
        advanceToNextVideo,
        cancelPendingAdvance,
    }: {
        item: SearchResult,
        prevImage: () => void,
        nextImage: () => void,
        thumbnailsOpen: boolean
        showPagination: boolean
        /**
         * The host's auto-advance step (docs/video-end-action-design.md §3),
         * wired only in `advance` mode. `playback` distinguishes a real end of
         * playback from an error skip (only the former may turn a page);
         * `isFullscreen` is the fullscreen fork — the chain must never fall out
         * of fullscreen, so a videoless landing page suppresses the turn
         * instead of unmounting the player. A GETTER, not a flag: the page turn
         * consults it after its fetch, and fullscreen can be entered or left
         * while that fetch is in the air.
         */
        advanceToNextVideo: (opts: { playback: boolean; isFullscreen: () => boolean }) => void
        /** Invalidate a page turn that is still fetching — see §3, "Supersession". */
        cancelPendingAdvance: () => void
    }
) {
    const [dbs, ___] = useSelectedDBs()
    const thumbnailURL = getFileURL(dbs, "thumbnail", "sha256", item.sha256)
    const fileURL = getFileURL(dbs, "file", "sha256", item.sha256)

    const searchLoading = useSearchLoading(state => state.loading)

    const isPlayable = isPlayableVideo(item.type)
    // ONE REF OBJECT PER ITEM. The <video> is keyed by sha and remounts on
    // gallery navigation (a bare src swap fires `emptied`, not `pause`), and
    // every player hook binds its listeners once per ref IDENTITY — deps are
    // `[..., videoRef]`. A single stable ref would leave the surface's paused
    // sync, the host's useVideoDuration listener and useVideoTrim's
    // seek-to-start bound to the element that just went away.
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
    // letterbox reads as sparse. Floor = GALLERY_SURFACE_FLOOR, the width THIS
    // host's full control row needs — one end-action button more than a pin's
    // (see the constant) — so it only engages for videos narrower than the
    // row; cap = the panel, which is all the surface ever had. The tier
    // follows from the resulting width, so a panel under 280px degrades to
    // medium/mini exactly like a pin does. In fullscreen the player owns the
    // screen and the surface spans it, the way every fullscreen video's
    // controls do.
    const surfaceWidth = pictureBox
        ? Math.min(panelBox.w, Math.max(pictureBox.width, GALLERY_SURFACE_FLOOR))
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
    // A detected TikTok end card supplies a DEFAULT end bound at playback
    // time (docs/video-outro-skip-design.md). `trim` stays the user's own
    // everywhere it is edited or stored; only the player sees the composed
    // range — including the native `loop` attribute, which must follow the
    // EFFECTIVE emptiness or a skipped outro would loop back to the card.
    // The element's own duration, which the cut point is anchored to (the
    // card is appended at the END, and browser timelines disagree with
    // ffprobe about the origin) and which the rail draws its geometry from —
    // one listener, read here and handed down.
    const browserDuration = useVideoDuration(videoRef, showVideo, item.sha256)
    const outroSkip = useOutroSkipEnabled()
    // The measured end of the video track in the browser's own timeline,
    // which turns the cut from a split-the-difference guess into arithmetic
    // (lib/videoEndProbe.ts). Its own offscreen element — never this one, no
    // visible video is seeked by it — so it is gated on the item's
    // eligibility and the preference, NOT on showVideo: the answer should be
    // there before the first frame plays. `fileURL` is the same URL the
    // <video> below loads, so the probe hits the browser cache the player
    // will use.
    const probedVideoEnd = useVideoEndProbe(
        fileURL,
        item.sha256,
        outroSkip && outroProbeEligible(item.content_end_ms, item.duration),
    )
    const outroCut = outroCutPoint(
        item.content_end_ms,
        item.duration,
        browserDuration,
        probedVideoEnd,
    )
    const effectiveTrim = effectiveVideoTrim(trim, outroCut, outroSkip)
    // What playback does when it reaches that effective end (docs/video-end-
    // action-design.md §2). Read straight from the store rather than passed
    // down: every reader in this tree must see the same value in the same
    // commit, or a video keeps its native `loop` while the gallery already
    // believes it is advancing — a silently stalled chain.
    const mode = useGalleryEndAction()

    // The host's advance verbs and the fullscreen flag they need, read at FIRE
    // time by the element listeners below. Both callbacks close over the
    // gallery's items/index/page and are re-created every render, and
    // `isFullscreen` moves under the player: naming any of them in those
    // effects' deps would rebind the listeners on every render of a playing
    // video. Written in an effect and read only from an event handler or from
    // inside the advance step — never during render.
    const endActionRef = useRef({
        advance: advanceToNextVideo,
        cancel: cancelPendingAdvance,
        isFullscreen: player.isFullscreen,
    })
    useEffect(() => {
        endActionRef.current = {
            advance: advanceToNextVideo,
            cancel: cancelPendingAdvance,
            isFullscreen: player.isFullscreen,
        }
    })
    // The fullscreen state as a LIVE reading, shared by every caller of the
    // advance step: the page turn consults it after its fetch, and a boolean
    // captured when the video ended would be wrong in both directions if the
    // user toggled fullscreen during that fetch. The ref is already synced per
    // commit, so this is just the flag with the reading deferred.
    const isFullscreenNow = () => endActionRef.current.isFullscreen

    useVideoTrim({
        videoRef,
        trim: effectiveTrim,
        active: showVideo,
        // `stop` parks at the end and does nothing more; `advance` parks and
        // reports it. The callback is read through a latest-ref inside the
        // hook, so re-creating it on every render rebinds no listeners — which
        // is what lets it close over the host's live items/index/page.
        loopAtEnd: mode === "loop",
        onEndReached: mode === "advance"
            ? (() => advanceToNextVideo({
                playback: true,
                isFullscreen: isFullscreenNow,
            }))
            : undefined,
    })

    // A playable-TYPED file can still fail — a decode error (HEVC in an mp4,
    // a truncated file) or an unsupported source — and one broken file would
    // otherwise silently kill an unattended chain. So it is skipped like any
    // advance, flagged as a NON-playback one so it can never turn a page by
    // itself (§"Broken videos"). Bound per item like the other element
    // effects: the ref identity is per-item state (see the videoSlot comment
    // above) and the element under it is created and destroyed with showVideo.
    useEffect(() => {
        if (mode !== "advance" || !showVideo) return
        const video = videoRef.current
        if (!video) return
        const onError = () => {
            endActionRef.current.advance({
                playback: false,
                isFullscreen: isFullscreenNow,
            })
        }
        video.addEventListener("error", onError)
        return () => video.removeEventListener("error", onError)
    }, [mode, showVideo, videoRef])

    // A play on this element cancels a page turn that is still fetching: the
    // user has taken over, and a stale intent must never move the gallery
    // after that (§3, "Supersession"). Every `play` here is the user's by
    // construction — while a turn is pending the only element alive is the
    // parked one, and a new item's autoplay exists only after the turn has
    // written, which cleared the token itself.
    useEffect(() => {
        if (mode !== "advance" || !showVideo) return
        const video = videoRef.current
        if (!video) return
        const onPlay = () => endActionRef.current.cancel()
        video.addEventListener("play", onPlay)
        return () => video.removeEventListener("play", onPlay)
    }, [mode, showVideo, videoRef])

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
                            // it restarts from the trim start rather than 0.
                            // The EFFECTIVE trim: an outro-skipping video has
                            // a loop point even with no user trim.
                            // And only in `loop` mode at all: `stop` and
                            // `advance` need the element to fire `ended`,
                            // which a natively looping one never does
                            // (docs/video-end-action-design.md §2).
                            loop={mode === "loop" && isEmptyTrim(effectiveTrim)}
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
                                    outroCutPoint={outroCut}
                                    // The end-action cycle button, which exists
                                    // only where both props are passed — the
                                    // gallery is the only such host. Writing
                                    // straight to the store, which is where
                                    // `mode` above was read from.
                                    endAction={mode}
                                    onEndActionChange={setGalleryEndAction}
                                    duration={browserDuration}
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

