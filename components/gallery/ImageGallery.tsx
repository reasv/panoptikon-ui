import Image from 'next/image'
import { BookmarkBtn, FilePathComponent, OpenFile, OpenFolder, ShareButton, useCopyPath } from "@/components/imageButtons"
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Toggle } from "@/components/ui/toggle"
import { X, ArrowBigLeft, ArrowBigRight, GalleryHorizontal, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useEffect, useMemo, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { cn, consumesArrowKeys, downloadFileName, fileNameFromPath, getFileURL, hasOpenLayer } from "@/lib/utils"
import { ItemMetaLine } from "@/components/ItemMetaLine"
import { itemEquals, OpenDetailsButton } from "@/components/OpenFileDetails"
import { useFileShare } from "@/hooks/fileShare"
import { useItemSelection } from "@/lib/state/itemSelection"
import { useGalleryIndex, useGalleryNavigate, getGalleryOptionsSerializer, useGalleryThumbnail, useGalleryPinBoardLayout, useGalleryFullscreen, useGalleryHidePinBoard, useGalleryTrim, useViewMode } from "@/lib/state/gallery"
import { useSelectedDBs } from "@/lib/state/database"
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { usePageSize, useSearchPage, useSearchPageRaw } from '@/lib/state/searchQuery/clientHooks'
import { useGridScrollAnchor } from '@/lib/state/gridScroll'
import { useFetchPageRows, usePrefetchPageState, type ResultsSource } from '@/lib/searchHooks'
import { exceedsDisplayLoopTrigger } from '@/lib/thumbnailTier'
import { SCROLL_CHUNK_SIZE } from '@/lib/searchRequest'
import { chunkStartOf, scanLoadedForward } from '@/lib/scrollMode'
import { serializers } from '@/lib/state/searchQuery/serializers'
import { VirtualGalleryHorizontalScroll } from './VirtualizedHorizontalScroll'
import { PinBoard } from './GalleryPinBoard'
import {
    AutoLayoutToggle,
    PinboardFullscreenButton,
    PinboardMenu,
    UniformLayoutToggle,
} from './PinboardMenu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { useSearchLoading } from '@/lib/state/zust'
import { MediaControls } from './PlayButton'
import React from 'react'
import { PLAYBACK_RATES, setGalleryEndAction, useGalleryEndAction, useOutroSkipEnabled, useVideoPlayerState } from '@/lib/videoPlayerState'
import { GALLERY_SURFACE_FLOOR, NativeControlsEscape, playerSizeForWidth, useVideoPlayerSurface, VideoDownloadControl, VideoPlayerSurface } from './VideoPlayerSurface'
import { effectiveVideoTrim, outroCutPoint, outroProbeEligible, outroSkipGoverns, trimWithBound, useVideoDuration, useVideoTrim } from '@/lib/videoTrim'
import { clipRequestFor } from '@/lib/videoClip'
import { useVideoEndProbe } from '@/lib/videoEndProbe'
import { noteVideoPlaybackError, shouldDowngradeOnError, useVideoPlayability, videoPlayability } from '@/lib/videoPlayability'
import { useVideoPlayback } from '@/lib/videoTranscode'
import { useDisplayLoopTrigger, useVideoTranscodeEnabled } from '@/lib/useClientConfig'
import { isEmptyTrim, TrimRange } from '@/lib/pinboardCrop'
import { trimForSha } from '@/lib/galleryTrim'

// What the auto-advance chain may move to (docs/video-end-action-design.md
// §3): exactly the items this browser will play UNATTENDED, right now, with
// no further gesture. Everything else — images, animations, containers the
// browser will not decode — is "not a video" here, which is precisely what
// makes an unattended chain safe.
//
// This used to be the `video/mp4 || video/webm` mime guess, shared verbatim
// with the player's own gate. The playability tri-state
// (lib/videoPlayability.ts) split that one question into two, and the two
// answers are no longer the same predicate:
//
//   - the PLAYER GATE is `playability !== "unsupported"` — it includes
//     `needs-transcode`, whose play affordance STARTS A JOB;
//   - the ADVANCE SCAN is the `playable` rung alone, because a job is only
//     ever started by a deliberate press (a GET never starts one). Landing
//     the chain on a needs-transcode item would mount nothing, fire no
//     `ended`, and stall the binge — the exact failure the mime guess was
//     written to avoid.
//
// The scan's set is therefore a strict SUBSET of the player's, which is the
// safe direction: the chain can never advance onto something the gallery then
// refuses to play. It also picks up items the mime guess wrongly skipped (an
// h264 `.mov` plays natively and now takes part in the chain).
//
// `transcodeEnabled` is deliberately hardcoded false: it only ever chooses
// between `needs-transcode` and `unsupported`, and neither is `playable`, so
// the flag cannot change this answer. That keeps the predicate a plain
// function callable from the fetch continuation and the prefetch effect
// without threading the client config through them.
export function isPlayableVideo(item: SearchResult | null | undefined): boolean {
    return videoPlayability(item, { transcodeEnabled: false }) === "playable"
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

// How far around the current item the gallery keeps rows warm. Half a chunk on
// each side, so stepping — with the arrows, the filmstrip or the auto-advance
// chain — moves through already-loaded rows and the hold-on-unloaded state
// below never actually engages for ordinary navigation. Fire-and-forget and
// chunk-granular by contract (ResultsSource.ensureRange), so the real cost is
// at most the two chunks the window straddles, and nothing in pages mode,
// where the array source's ensureRange is a no-op.
const GALLERY_WARM_RADIUS = Math.floor(SCROLL_CHUNK_SIZE / 2)

function getNextIndex(length: number, index?: number | null,) {
    return ((index || 0) + 1) % length
}

function getPrevIndex(length: number, index?: number | null,) {
    return ((index || 0) - 1 + length) % length
}

export function ImageGallery({
    source,
    totalPages,
    paginationVisible,
    setPage,
    countSettled = true,
    resultsAreStale = false,
    queryEnabled,
    onDerivedPageChange,
}: {
    /**
     * The rows, however they are fetched: the page's array in pages mode, a
     * sparse window over the whole result set in scroll mode (see
     * ResultsSource). ONE gallery reads both — every index below is a global
     * item index, which in pages mode is page-local because the page IS the
     * source, exactly as `items[i]` always was.
     */
    source: ResultsSource
    totalPages: number
    /**
     * Is the host rendering a pagination bar below this panel? The image panel
     * sizes itself around it, and `totalPages > 1` is only the right answer
     * while the bar IS the page count — which it stops being in scroll mode,
     * where the host passes `totalPages = 1` (one giant page, so no page turn
     * is reachable) while still showing the bar as a position scrubber.
     * Absent means "ask totalPages", which is what pages mode does.
     */
    paginationVisible?: boolean
    setPage: (page: number) => Promise<void>
    /**
     * Whether `source.count` is the count query's answer rather than the
     * still-growing loaded extent (ResultsSource.count) — the same flag the
     * grid takes, and it must be computed the same way, or the two surfaces
     * would disagree about how far the set reaches. Always true in pages mode,
     * where the page's array IS the count.
     */
    countSettled?: boolean
    /** These results belong to a different page than the URL names — see useSearch */
    resultsAreStale?: boolean
    /**
     * Is the LIVE search actually being served? False while the update lock
     * withholds uncommitted sidebar edits, while input is invalid, or while
     * the board is maximized WITH THE SEARCH OVERLAY HIDDEN (suppression is
     * scoped to "no consumer on screen" — see useSearchSuppressed) — see
     * useSearch. Everything on the auto-advance path stands down on it
     * (docs/video-end-action-design.md §3): `resultsAreStale` is deliberately
     * false in the update-lock state, so it cannot carry this, and without
     * its own gate a video ending mid-edit would fetch and land on a search
     * the user withheld.
     */
    queryEnabled: boolean
    /**
     * The scrubber's live highlight write, scroll mode only — the host's
     * derived-page box (lib/state/derivedPage.ts), stable by construction
     * (minted once per mount, so it is not a per-render callback), which the
     * strip's scroll listener depends on. Threaded to the thumbnail strip so
     * the pagination bar under the open gallery finally tracks a strip PAN
     * (docs/maximized-pinboard-search-overlay-design.md §6) — navigation was
     * already reported through the anchor (useDerivedVirtualPage's
     * gallery-open branch); a pan writes no anchor by design, so only the
     * strip itself can report it.
     */
    onDerivedPageChange?: (page: number) => void
}) {
    const [qIndex, setIndex] = useGalleryIndex()
    // The mode, read from `vm` itself rather than inferred. Everything else in
    // this component discriminates on `totalPages === 1` (one giant page, so no
    // page turn is reachable), and that is exactly right for the page-turn
    // branches — but it is NOT a mode test: a pages-mode search that fits on
    // one page has `totalPages === 1` too, and the anchor writes below must not
    // reach it (in pages mode `top` is a within-page index the grid owns, not
    // the position `gi` names). The advance chain has no explicit test to
    // borrow either — it separates the two modes by construction, deferring to
    // the chunk path only when a scan runs off the loaded rows. So the honest
    // discriminator is the parameter itself, read the same way this component
    // already reads `gi`, `page`, `page_size` and `top`.
    const scrollMode = useViewMode()[0] === "scroll"
    const [page] = useSearchPage()
    // The raw `page` setter, and the grid's scroll anchor: the auto page turn
    // writes both itself instead of going through the useSearchPage wrapper —
    // see turnPageToNextVideo below for why it must.
    const setPageRaw = useSearchPageRaw()[1]
    const [scrollAnchor, setScrollAnchor] = useGridScrollAnchor()
    const pageSize = usePageSize()
    // How far the gallery can navigate, and the two change signals, per the
    // ResultsSource dependency rule: every dep list below names `rowsIdentity`
    // and `count`, every supersession gate names `queryIdentity`, and nothing
    // names the source object or its methods — all are minted per render. Both
    // identities are VALUES, compared with !==. In pages mode both of them ARE
    // the results array and `count` is its length, so every dep list and every
    // gate holds exactly the value it always held.
    //
    // `count` is `source.count` with one correction, and only while the count
    // query is still in flight (pages mode never takes it): the source's
    // answer is then the still-growing LOADED EXTENT, which on a cold deep
    // link is the SSR-hydrated first page — ten rows, say, under a `gi` of
    // 5000. Clamping against that would resolve the position onto the last of
    // those rows and show a wrong item (and publish it as the selection) for
    // the frame or two before the real count arrives. So until it settles, the
    // position the URL names is part of the extent; afterwards it is not, and
    // a stale link past the end of a set that has since shrunk still clamps
    // onto the last result rather than waiting forever for a row that no
    // longer exists.
    const rowsIdentity = source.rowsIdentity
    const queryIdentity = source.queryIdentity
    const count = countSettled
        ? source.count
        : Math.max(source.count, (qIndex || 0) + 1)
    // Clamp rather than wrap: an index past the end of the set addresses
    // nothing, and wrapping round lands on a semantically unrelated item.
    const urlIndex = Math.max(0, Math.min(qIndex || 0, count - 1))
    // Hold still while the item the URL names cannot be resolved. Two
    // conditions, one mechanism:
    //
    //   - the results don't match the URL (`resultsAreStale`). A page-size
    //     change rewrites the index and the size together, so for one render
    //     the new index addresses the old page — resolving it there would show
    //     a wrong item and (via the selection push below) make that wrong item
    //     stick. The held index is the same *item* the remap is moving to, so
    //     nothing visibly happens: the number changes underneath an unchanged
    //     picture.
    //   - the target's rows are not loaded (`source.get` undefined, scroll
    //     mode only — the array source always has the row). The gallery keeps
    //     showing the held item while that chunk is in flight, and the render
    //     that has the data snaps forward. The warm effect below asks for
    //     half a chunk on either side of the position, so ordinary stepping
    //     never actually reaches this state.
    //
    // Adjusted during render rather than in an effect: a ref read while
    // rendering is exactly what the React Compiler (on, see next.config.mjs)
    // forbids, and this way the held value can never lag a commit behind.
    // React re-runs the component immediately without committing, and the
    // non-holding branch doesn't read it anyway, so the extra pass is free.
    const targetUnloaded = source.get(urlIndex) === undefined
    const holding = resultsAreStale || targetUnloaded
    // …and the one case the hold can never end by itself: the chunk behind the
    // target FAILED, terminally (see ResultsSource.errorAt — react-query has
    // spent its retries and nothing re-arms it). The loading frame below would
    // then pulse forever, which is a lie about what is happening and offers no
    // way out, so the panel says so and renders a Retry instead. Read through
    // the source every render rather than tracked: an error is query state,
    // not a row set, and the source arrives as a fresh prop whenever that state
    // moves (MultiSearchView observes the chunk queries). Always false in pages
    // mode, where a failed search is the SearchErrorToast's business.
    const targetErrored = targetUnloaded && source.errorAt(urlIndex)
    const [heldIndex, setHeldIndex] = useState(urlIndex)
    // TRAP — a held index MUST NOT survive a `vm` change, and this has now
    // been predicted, deleted and re-discovered once (see useCommitViewMode,
    // whose scroll branch used to carry the prediction as a comment about a
    // caller that did not exist yet; the maximized dock's ViewModeToggle
    // made it real). The held number is page-local in pages mode and global
    // in scroll mode, so across a switch it names an item in a coordinate
    // system that no longer exists — a page-3 `gi=4` becomes a global 24,
    // and a hold left at 4 addresses global row 4 through the chunk source's
    // page-1 fallback. That is not a cosmetic lag: the selection push below
    // publishes that row, and BOTH surfaces that fall back to the selection
    // (this panel's own `currentItem`, and the maximized viewer's
    // useViewerItem) then show a different picture for a whole chunk round
    // trip before snapping back. `resultsAreStale` cannot cover it — it
    // clears as soon as the main query settles, which in scroll mode says
    // nothing about the chunk under the new index.
    //
    // Resetting to `urlIndex` is the whole fix, and it costs no flash: the
    // switch preserved the POSITION, so the row the URL now names is the row
    // that was on screen, and while its chunk is in flight `source.get`
    // answers undefined — which suppresses the publish and leaves the
    // selection store holding that very item for both fallbacks to use.
    //
    // State + render-time adjustment, mirroring the `heldIndex` line above,
    // because a ref written during render is what the React Compiler
    // forbids; `holding` is deliberately not consulted, since a hold that is
    // still engaged is exactly the case that must be dropped.
    const [heldMode, setHeldMode] = useState(scrollMode)
    if (heldMode !== scrollMode) {
        setHeldMode(scrollMode)
        setHeldIndex(urlIndex)
    } else if (!holding && heldIndex !== urlIndex) {
        setHeldIndex(urlIndex)
    }
    const index = holding
        ? Math.max(0, Math.min(heldIndex, count - 1))
        : urlIndex

    // Which branch this gallery is: the large image (the player world, and the
    // only place this feature exists) or the pinboard. Named HERE, above its
    // first reader, because both background fetches below — the position warm
    // and the ahead-of-turn prefetch — have to stand down on exactly the
    // condition the JSX renders the board on.
    const pinboard = useGalleryPinBoardLayout()[0]
    const hidePinBoard = useGalleryHidePinBoard()[0]
    const showsLargeImage = pinboard.length === 0 || hidePinBoard

    // Keep the rows around the position warm. Keyed by the dependency rule —
    // the position, the rows identity and the count as three separate deps,
    // never the source — and on `urlIndex` rather than the held one, because
    // the whole point is to fetch what the URL is waiting for. `source` is
    // deliberately absent: it is minted per render, and `rowsIdentity` moves
    // whenever anything this body reads through it could have. A no-op in
    // pages mode (ensureRange is empty there), and cheap to re-run: an
    // unchanged chunk set returns the previous state.
    //
    // Gated on the large-image branch for the same reason the ahead-of-turn
    // prefetch below is: the pinboard must not acquire a background fetch it
    // has no use for — it is an arrangement, not a sequence, and nothing in it
    // reads the rows around `gi`.
    useEffect(() => {
        if (!showsLargeImage) return
        source.ensureRange(urlIndex - GALLERY_WARM_RADIUS, urlIndex + GALLERY_WARM_RADIUS)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showsLargeImage, urlIndex, rowsIdentity, count])

    // ---- Auto-advance (docs/video-end-action-design.md §3) ---------------
    //
    // Owned here because this is the component that has the rows, `page` and
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
    // the QUERY is compared, because the page number cannot catch all of them
    // — a query edit can leave `page` and `gi` numerically unchanged while
    // swapping the entire row set. Any move of `queryIdentity` means the
    // coordinates this turn computed a target in have stopped meaning what
    // they meant. Cancelling a turn that was in fact still legitimate just
    // ends the chain, which is the honest outcome: nothing rearms it but a
    // real playback reaching a real end, and the user is right there having
    // just navigated.
    //
    // `queryIdentity` and NOT `rowsIdentity`, which is the one asymmetry
    // between the two modes' gates — and only in name. In pages mode the two
    // are the same value (the results array), so this is byte for byte the
    // items-identity gate the page turn has always had, bookmark patches
    // included. In scroll mode `rowsIdentity` additionally moves on every
    // chunk that lands and on pure MEMBERSHIP churn — a chunk joining or
    // leaving the observed window with no row anyone can see having changed
    // (see ResultsSource.rowsIdentity) — and a warm landing three screens away
    // is not a reason to abandon a chain the user is watching. That churn now
    // never reaches this gate at all. What is given up is the bookmark-patch
    // cancellation in scroll mode, and it costs nothing: the landing's
    // correctness comes from the rows the chain itself fetched, and real user
    // navigation is caught by the `qIndex` and `page` gates beside this one.
    const turnGatesRef = useRef({ page, qIndex, queryIdentity, resultsAreStale, queryEnabled })
    useEffect(() => {
        turnGatesRef.current = { page, qIndex, queryIdentity, resultsAreStale, queryEnabled }
    })
    // Did a video actually finish playing on THIS row set? An auto page turn
    // requires it (§"Broken videos"): error skips chain freely within the
    // loaded rows, but a page of nothing but broken videos has to stop at that
    // page's edge rather than crawl the whole result set. Set by
    // end-of-playback advances only, never by error ones, and cleared on every
    // page change — auto or manual, which is what the effect (rather than the
    // turn alone) covers. In scroll mode "the page" is the whole set and the
    // flag reads as "playback happened on these rows", which is the same
    // authorization under a different span: it is what bounds the chunked
    // continuation below to ONE fetched chunk per playback.
    //
    // Keyed on the rows identity as well as the page number, because a query
    // change can leave the number alone (page 1 → new query → still page 1)
    // while replacing every row, and a flag left standing there would
    // authorize one page turn on a result set nothing ever played on. New rows
    // ARE a new page in every sense that matters here. The same effect re-arms
    // the ahead-of-turn prefetch below, for the same reason plus one of its
    // own: that once-guard is keyed `${page}:${sha}`, which collides across
    // different searches that put the same file at the same position, and
    // otherwise never resets once its entry has been collected.
    const playedThisPageRef = useRef(false)
    const prefetchedForRef = useRef<string | null>(null)
    useEffect(() => {
        playedThisPageRef.current = false
        prefetchedForRef.current = null
    }, [page, rowsIdentity])
    // The scroll-mode twin of `prefetchedForRef`, and deliberately NOT reset by
    // the effect above. Its key is the SHA of the video the warm was done for,
    // because the chunk index the warm targets moves forward as chunks land:
    // re-armed on every rows change, or keyed by chunk, a run of images longer
    // than one chunk would warm chunk after chunk behind a single playing
    // video — while the continuation below can only ever consume ONE. One warm
    // per playing video is exactly the bound the chain itself has.
    //
    // The boundary index the warm was fired FOR is recorded alongside, and
    // that is what keeps the guard from becoming PERMANENT suppression: a sha
    // alone stays matched after the warmed rows have gone away (evicted past
    // their gcTime, or dropped by a committed query change), and the same
    // video becoming current again would then never re-warm anything.
    // Suppress only while the warm still has something to show for it — the
    // boundary it was meant to fill is readable — and otherwise warm again
    // and re-record. The boundary, not the chunk start: chunk starts can be
    // answered by the page-1 fallback rows, which would vouch for an evicted
    // chunk forever. The bound survives intact: within one playing video the
    // warmed rows are readable from the moment they land, so this can still
    // only fire once for it.
    const warmedAheadRef = useRef<{ sha: string; stopped: number } | null>(null)
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

    // The page-turn branches are inert in scroll mode by their own guards, not
    // by a mode check: the host passes `totalPages = 1` there (one giant
    // page), so `page < totalPages` and `page > 1` are both false and the
    // plain global step is all that remains — which is the correct behavior,
    // because `gi` is already a global index over the whole set.
    //
    // MANUAL navigation's position write — the arrows, the click-through halves
    // of the large image, the ← / → keys and the filmstrip all end up here.
    // The write itself, and the anchor-follows-position rule it implements,
    // live in useGalleryNavigate: the maximized board's search-overlay strip
    // performs the identical write, and sharing the hook is what keeps the two
    // mounts from drifting (docs/maximized-pinboard-search-overlay-design.md
    // §5.3).
    const navigateTo = useGalleryNavigate(scrollMode)
    const nextImage = () => {
        cancelPendingAdvance()
        if (index === (count - 1)) {
            if (page < totalPages) {
                setPage(page + 1).then(() => {
                    setIndex(0)
                })
            }
            return
        }
        // From `qIndex`, exactly as the functional update this replaces read it
        // — the URL's index, which is not the held one while a chunk is in
        // flight — so the step itself is unchanged and only the anchor is new.
        navigateTo(getNextIndex(count, qIndex))
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
        navigateTo(getPrevIndex(count, qIndex))
    }

    const closeGallery = () => {
        cancelPendingAdvance()
        setIndex(null)
    }

    const [thumbnailsOpen, setThumbnailsOpen] = useGalleryThumbnail()

    const [selectedItem, setSelectedItem] = useItemSelection(useShallow((state) => [state.getSelected(), state.setItem]))
    useEffect(() => {
        // The row can be undefined while the rows and the gallery index are
        // transiently out of sync (setItem would throw on undefined), and in
        // scroll mode also while its chunk is in flight. Stale results are
        // skipped outright: publishing an item resolved against the wrong page
        // makes the selection→index effect in SearchPage rewrite gi to
        // wherever that item happens to land.
        //
        // `source` is read inside the body rather than listed: it is minted per
        // render, and `rowsIdentity` is the signal that anything it can answer
        // with has changed (the ResultsSource dependency rule).
        const row = source.get(index)
        if (!resultsAreStale && row) {
            setSelectedItem(row)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [index, rowsIdentity, resultsAreStale])

    const params = useSearchParams()
    const [prevImageLink, nextImageLink] = useMemo(() => {
        const queryParams = new URLSearchParams(params)
        let nextURL = getGalleryOptionsSerializer()(queryParams, { gi: getNextIndex(count, index) })
        let prevURL = getGalleryOptionsSerializer()(queryParams, { gi: getPrevIndex(count, index) })
        if (index === 0) {
            if (page > 1) {
                prevURL = serializers.orderArgs(queryParams, { page: page - 1 })
                const lastIndex = Math.max(0, pageSize - 1)
                prevURL = getGalleryOptionsSerializer()(prevURL, { gi: lastIndex })
            } else {
                prevURL = serializers.orderArgs(queryParams, { page: page })
            }
        }
        if (index === (count - 1)) {
            if (page < totalPages) {
                nextURL = serializers.orderArgs(queryParams, { page: page + 1 })
                nextURL = getGalleryOptionsSerializer()(nextURL, { gi: 0 })
            } else {
                nextURL = serializers.orderArgs(queryParams, { page: page })
            }
        }
        // The page-boundary branches above are unreachable in scroll mode
        // (`totalPages = 1`); the plain `gi ± 1` serialization is already
        // right there, because `gi` is a global index over the whole set.
        return [prevURL, nextURL]
    }, [index, params, count, page, totalPages])

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
    // updates via itemEquals), while the row at `index` always reflects it.
    //
    // UNDEFINED IS A STATE, in scroll mode only: the row at `index` is not
    // loaded and neither is the held one — a deep-linked `gi` into a cold
    // cache, where nothing at all has been fetched yet. The fallback to
    // `selectedItem` covers most of the way there (it IS the last item this
    // gallery displayed, published by the effect above, so it survives its
    // chunk being evicted), but on a cold load there is no selection either
    // and the honest answer is "no item yet". Everything below therefore
    // treats `currentItem` as optional and the panel renders a loading frame
    // — see GalleryImageLoading. In pages mode the row is always there and
    // this can never be undefined, so nothing about that path changes.
    const galleryItem = source.get(index)
    const currentItem: SearchResult | undefined =
        selectedItem && galleryItem && itemEquals(selectedItem, galleryItem)
            ? galleryItem
            : selectedItem ? selectedItem : galleryItem

    // The gallery's own share verb, for the header Download button and the
    // Ctrl+C accelerator. The button surface renders its own ShareButton.
    // The hook has to be called unconditionally, so with no item it is
    // instantiated on an empty sha — inert, since it only ever acts when one
    // of its verbs is invoked, and the header renders no verb to invoke.
    const galleryShare = useFileShare({ sha256: currentItem?.sha256 ?? "", path: currentItem?.path })
    // Read the latest execute from an effect without re-subscribing the
    // listener every render (useFileShare returns fresh closures each time).
    // The flag rides along so the accelerator can stand down when there is no
    // item to share — the same guard the header applies by rendering no verb.
    const galleryShareRef = useRef({ share: galleryShare, hasItem: !!currentItem })
    galleryShareRef.current = { share: galleryShare, hasItem: !!currentItem }

    const [fs, setFs] = useGalleryFullscreen()
    // Read at KEYPRESS time, not captured by the listener: the effect below
    // registers once for the component's life, so a closure over `pinboard`
    // would freeze whichever board existed at mount.
    const hasBoardRef = useRef(pinboard.length > 0)
    hasBoardRef.current = pinboard.length > 0
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Check for Ctrl + Shift + M
            if (event.ctrlKey && event.shiftKey && event.code === 'KeyM') {
                event.preventDefault();
                // ASYMMETRIC, and deliberately so. Entering needs a board:
                // this chord means "maximize the pinboard", and with no
                // pinboard it produced a chromeless fullscreen large image
                // with nothing on screen to escape it — the same dead end
                // that removing the last pin used to leave behind (see the
                // destruction branch in lib/state/pinboard.ts). LEAVING is
                // always allowed, so the chord stays a way out of any such
                // state a future path manages to reach.
                //
                // The grid host's copy of this chord is already gated, by
                // being registered only while its board is shown
                // (app/search/SearchPage.tsx).
                setFs((f) => (f ? false : hasBoardRef.current))
            }
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    // Ctrl/Cmd+C fires the current gallery item's adaptive share verb (§0.12).
    // Its own listener: the main gallery key handler bails on ctrlKey by
    // design. That handler is mounted INSIDE the large-image subtree, so it is
    // dead whenever the pinboard replaces it; this one lives at the top level
    // and needs the same scoping by hand (§4.4d) — without it a Ctrl+C aimed
    // at a marquee-selected set of pins would copy the gallery's current item,
    // one that is not even on screen, at the cost of a full relay upload. The remaining
    // guards mirror the main handler (no inputs, no open Radix layer) plus one
    // it lacks — never hijack an active text selection, so normal copy still
    // works. Copying a pinboard selection is deferred, not implemented here.
    const showsLargeImageRef = useRef(showsLargeImage)
    showsLargeImageRef.current = showsLargeImage
    useEffect(() => {
        const onCopyKey = (event: KeyboardEvent) => {
            if (!showsLargeImageRef.current) return
            // No row resolved yet (scroll mode, chunk in flight): there is
            // nothing to copy, and the share hook is holding an empty sha.
            if (!galleryShareRef.current.hasItem) return
            if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
            if (event.key !== "c" && event.key !== "C") return
            // A held Ctrl/Cmd+C must fire once, not one relay action (and one
            // full-file Blob) per key-repeat tick.
            if (event.repeat) return
            const t = event.target as HTMLElement | null
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
            if (hasOpenLayer()) return
            // A live text selection is the user's own copy — don't take it.
            const selection = window.getSelection()
            if (selection && selection.isCollapsed === false) return
            event.preventDefault()
            void galleryShareRef.current.share.execute()
        }
        window.addEventListener("keydown", onCopyKey)
        return () => window.removeEventListener("keydown", onCopyKey)
    }, []);

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
        const from = { page, qIndex, queryIdentity }
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
        // navigation. So: nothing may have moved. The query is compared too,
        // which is what catches the case no page number can — a query whose
        // new rows land under the same page and the same index. (In pages mode
        // `queryIdentity` IS the results array, so this is unchanged.)
        const gates = turnGatesRef.current
        if (
            gates.page !== from.page
            || gates.qIndex !== from.qIndex
            || gates.queryIdentity !== from.queryIdentity
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
        const k = rows.findIndex((row) => isPlayableVideo(row))
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

    // The same turn, one page geometry out: scroll mode has ONE giant page, so
    // there is no page to turn to — the chain instead steps past the end of
    // what is LOADED, and the fetch that makes the step possible is a chunk
    // fetch rather than a page fetch. Everything else is the page turn line
    // for line, and deliberately so: fetch THEN move, token and gates
    // re-checked after the await, a landing index chosen from the fetched rows
    // before anything is written, one tick of `history: "replace"` writes.
    //
    // Reachable only in scroll mode, and by construction rather than by a mode
    // flag: the caller defers here when its scan ran off the loaded range with
    // items still ahead, and in pages mode the source holds one block covering
    // the whole page, so a scan there always stops at `count` instead.
    //
    // BOUNDED TO ONE CHUNK. `fetchItem` fetches the whole chunk containing the
    // index, so after a single await the entire chunk is readable through
    // `getBlock`; that chunk is scanned, and if it holds no playable video the
    // chain ENDS on its first item — the exact mirror of the pages rule "the
    // page still turns and the user lands at the top of the page that ended
    // the session, never two pages out". Without that bound a result set of
    // nothing but images would fetch its way to the end unattended.
    const advanceIntoUnloaded = async (target: number, isFullscreen: () => boolean) => {
        const token = {}
        turnTokenRef.current = token
        const from = { page, qIndex, queryIdentity }
        let landed: SearchResult | undefined
        try {
            // A failure ends the chain: the video stays parked and nothing is
            // written. `undefined` is the legitimate "that index is past the
            // end of the result set", which is why the source rejects instead.
            landed = await source.fetchItem(target)
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
        // Everything the token does not cover — a PageSelect click, a scrubber
        // jump, Back/Forward, a query edit under instant search, a page-size
        // commit. `queryIdentity` is what makes that list the WHOLE list here:
        // it moves only when the committed search does, so neither the chain's
        // own fetch (non-observing by contract) nor any warm landing elsewhere
        // in the set can end a chain the user is watching (see turnGatesRef).
        const gates = turnGatesRef.current
        if (
            gates.page !== from.page
            || gates.qIndex !== from.qIndex
            || gates.queryIdentity !== from.queryIdentity
            || gates.resultsAreStale
            || !gates.queryEnabled
        ) {
            if (turnTokenRef.current === token) turnTokenRef.current = null
            return
        }
        // Past the end of the result set. Reachable whenever the set shrank
        // after the count query answered, since `count` is only ever as fresh
        // as nResults — and an index with no row behind it is not a landing,
        // it is the end of the chain.
        if (landed === undefined) {
            turnTokenRef.current = null
            return
        }
        // The whole fetched chunk, in memory: `getBlock` reads the query cache
        // the fetch just populated, so this needs no second await and no
        // second request. Scanned from `target` forward — never from the
        // block's start, which can lie BEHIND the position that ended the
        // session (the main query's page-1 fallback covers fewer rows than a
        // chunk, so the first unloaded index is not always chunk-aligned).
        const block = source.getBlock(target)
        const rows = block?.rows ?? []
        if (rows.length === 0) {
            turnTokenRef.current = null
            return
        }
        const start = block?.start ?? target
        // Bounded by `count` as well as by the block: a cached chunk can
        // outlive the set it came from (the result set shrank after the count
        // query answered), and scanning its stale tail past `count` would land
        // the chain on an index the gallery then clamps away from.
        const k = scanLoadedForward(
            () => block,
            target,
            Math.min(count, start + rows.length),
            isPlayableVideo,
        ).match
        // Read at DECISION time, not at fire time: the user can enter or leave
        // fullscreen during the fetch, and a boolean captured before it gets
        // both directions wrong — an exit would end a chain the windowed rules
        // say should step, and an entry would write an image's index and
        // force-exit the fullscreen just entered.
        if (k === null && isFullscreen()) {
            // A videoless landing chunk in fullscreen: writing an image's
            // index unmounts the player host and force-exits fullscreen
            // mid-binge. Nothing may leave the user in a fullscreen box with
            // no video in it, so the chain ends here instead — parked on the
            // last video's end frame, fullscreen intact. The
            // land-where-it-ended convenience this gives up only has value
            // outside fullscreen, where it positions the grid.
            turnTokenRef.current = null
            return
        }
        // Windowed, with no video in the fetched chunk: the position still
        // moves and the user lands at the top of the chunk that ended the
        // session, never a chunk further out. Never BACKWARDS, though — the
        // top of the chunk is only a landing when it is ahead of where the
        // session ended. Either way the chain is over after this.
        const targetGi = k === null ? Math.max(start, target) : k
        // Raw setters, ONE tick, an explicit `history: "replace"` on every
        // member — the same write pattern and the same reasons as the page
        // turn above, minus the page itself: scroll mode HAS no `page`, and
        // writing one is the two-live-position-params bug the mode is defined
        // to avoid. Unchanged values are skipped, which here can leave the
        // batch empty (the chain landing exactly where it stands) — harmless,
        // and one fewer identical-URL history entry.
        const replace = { history: "replace" as const }
        const writes: Promise<unknown>[] = []
        if (targetGi !== qIndex) writes.push(setIndex(targetGi, replace))
        // The grid anchor follows the position, exactly as in the page turn:
        // closing the gallery must restore the grid where the chain left it,
        // and the anchor is absent while that position is the top of the set.
        const nextAnchor = targetGi > 0 ? targetGi : null
        if (nextAnchor !== scrollAnchor) writes.push(setScrollAnchor(nextAnchor, replace))
        // Cleared by the rows-change effect too; set here so the window between
        // this write and that effect cannot fetch a second chunk.
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
        // Held: an index chosen against rows the URL no longer names is the
        // exact mistake the held-index machinery exists to prevent — stale
        // results (the rows are the wrong ones) and, in scroll mode, a target
        // whose chunk has not arrived (the rows are right and the URL has
        // moved somewhere this render cannot resolve). Advancing from the
        // held item in that second state would overwrite the navigation that
        // is still loading — a Back into a cold part of the set, say. The
        // chain does not need the exception: it only ever writes indices it
        // has the rows for, so its own landings never hold, and when the
        // pending one arrives it autoplays and carries the binge on.
        // Withheld query: see the `queryEnabled` prop.
        if (mode !== "advance" || holding || !queryEnabled) return
        // Reaching an end IS playback on this page, even when the scan below
        // then finds nothing to advance to — the flag records that this page
        // played, not that it advanced. Error skips never set it.
        if (playback) playedThisPageRef.current = true
        // The in-page scan, generalized: it walks the rows the source has
        // LOADED and reports both answers (see scanLoadedForward) — where the
        // next playable video is, and where it gave up. In pages mode the
        // source holds one block covering the whole page, so this is the
        // `for (i = index + 1; i < items.length; i++)` loop it has always been
        // and `stopped` is always the end of the page.
        const scan = scanLoadedForward(
            (i) => source.getBlock(i),
            index + 1,
            count,
            isPlayableVideo,
        )
        if (scan.match !== null) {
            // The arrow-key path minus the history entry: the element is
            // keyed by sha, showVideo survives navigation, and autoPlay
            // starts the next video.
            setIndex(scan.match, { history: "replace" })
            return
        }
        // Ran off the end of the LOADED rows with items still ahead of it
        // (scroll mode only): the chain continues into the unfetched set, one
        // chunk at a time. Gated on the same flag as the page turn, and for
        // the same reason — a run of nothing but broken videos must not fetch
        // its way across the result set.
        if (scan.stopped < count) {
            if (!playedThisPageRef.current) return
            void advanceIntoUnloaded(scan.stopped, isFullscreen)
            return
        }
        // Nothing playable left on this page. The last page parks (reaching
        // the last video on the last page ends playback), and a page no video
        // ever finished on never turns — that is the whole point of the flag.
        if (page >= totalPages) return
        if (!playedThisPageRef.current) return
        void turnPageToNextVideo(isFullscreen)
    }

    // Warm what the turn will need while the last playable item before it is
    // current, so the end-of-video fetch is a cache hit and not a NAS-speed
    // round trip between the last frame and the next video. Fires once per
    // (page, sha), the guard re-armed on every new row set by the effect
    // above; the deps churn with every new row set and the guard makes those
    // re-runs free. Failures are ignored — the turn's own fetch is the retry,
    // which is also the design's accepted fallback for the cold cases this
    // guard cannot rule out. Deliberately NOT gated on showVideo (advance mode
    // plus standing on the last playable item is already the signal, and one
    // page of rows is cheap), but gated on the same flags as the scan, and on
    // the large-image branch: the pinboard must not acquire a background fetch
    // it has no use for.
    //
    // The trigger is the SAME scan the advance runs, which is what keeps the
    // two from ever disagreeing about what "the last playable item" means: a
    // match ahead means the turn is not next and there is nothing to warm.
    // What the two modes then warm differs exactly as their turns differ — the
    // next page, or the next chunk.
    useEffect(() => {
        if (!showsLargeImage) return
        if (mode !== "advance" || resultsAreStale || !queryEnabled) return
        const current = source.get(index)
        if (!current || !isPlayableVideo(current)) return
        const scan = scanLoadedForward(
            (i) => source.getBlock(i),
            index + 1,
            count,
            isPlayableVideo,
        )
        if (scan.match !== null) return
        if (scan.stopped < count) {
            // Scroll mode: warm the chunk the continuation would fetch. No
            // spinner and no user-visible loading state of any kind is
            // possible here — `ensureRange` is silent by construction, which
            // is why this path needs no `silent` flag of its own.
            //
            // This DOES move `rowsIdentity` when the chunk joins the observed
            // set, unlike the page prefetch below (which only populates the
            // query cache). Harmless because that churn no longer reaches any
            // gate: the supersession comparand is `queryIdentity`, which a
            // chunk landing does not move (see turnGatesRef). The timing is
            // favourable too — the warm fires while a video is still playing
            // and the chain arms only when it ENDS — but nothing now rests on
            // that argument holding for every ordering, which is what the
            // comment here used to claim.
            //
            // See warmedAheadRef for why the guard is keyed on the playing
            // item AND on what the warm produced. The probe is the BOUNDARY
            // index the scan stopped at, not the chunk start: `getBlock` on a
            // chunk start can be answered by the page-1 fallback rows (chunk 0
            // is exactly where a fresh session's first warm lands), which
            // would report an evicted chunk as still readable forever. The
            // boundary was unloaded when the warm fired, so only the warm's
            // own rows can make it readable — and after eviction it goes
            // unreadable again, which is the re-arm.
            const start = chunkStartOf(scan.stopped, SCROLL_CHUNK_SIZE)
            const warmed = warmedAheadRef.current
            if (warmed
                && warmed.sha === current.sha256
                && source.getBlock(warmed.stopped) !== undefined) return
            warmedAheadRef.current = { sha: current.sha256, stopped: scan.stopped }
            source.ensureRange(start, start + SCROLL_CHUNK_SIZE - 1)
            return
        }
        // Pages mode: the loaded rows ARE the page, so the turn is a page turn
        // and there is nothing to warm on the last one. (Checked here rather
        // than at entry, where it would also skip the scroll branch above —
        // `totalPages` is 1 in scroll mode by construction.)
        if (page >= totalPages) return
        // `silent`: no user gesture is behind this fetch, so it must not arm
        // the global search spinner (see usePrefetchPageState).
        const key = `${page}:${current.sha256}`
        if (prefetchedForRef.current === key) return
        prefetchedForRef.current = key
        void prefetchRef.current(
            { page: page + 1 },
            { gcTime: PREFETCH_GC_TIME, silent: true },
        ).catch(() => { })
        // `source` is minted per render; `rowsIdentity` and `count` are its
        // change signals, per the ResultsSource dependency rule.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showsLargeImage, mode, rowsIdentity, count, index, page, totalPages, resultsAreStale, queryEnabled])

    return (
        // data-pinboard-frame: presses landing on this panel's own padding
        // and gaps (not on any child) can start a pinboard marquee select —
        // see the frame listener in GalleryPinBoard
        <div data-pinboard-frame className="flex flex-col border rounded p-2">
            {!fs && <div className="flex justify-between items-center mb-2">
                <div className="flex items-center">
                    {/* Left file-verb cluster; the Download twin sits after the
                        Next arrow on the right to keep the header balanced 5v5.
                        Every verb here needs the row's own fields, so with no
                        row resolved yet the cluster is four placeholders of the
                        same footprint — the header must not resize under the
                        user when the chunk lands. */}
                    {currentItem ? <>
                        <BookmarkBtn sha256={currentItem.sha256} bookmarked={currentItem.bookmarked} buttonVariant />
                        <OpenFile sha256={currentItem.sha256} path={currentItem.path} buttonVariant />
                        <OpenFolder sha256={currentItem.sha256} path={currentItem.path} buttonVariant />
                        <ShareButton sha256={currentItem.sha256} path={currentItem.path} shortcut="Ctrl+C" />
                    </> : <>
                        <ChromeSkeleton />
                        <ChromeSkeleton />
                        <ChromeSkeleton />
                        <ChromeSkeleton />
                    </>}
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
                    {pinboard.length === 0 ? (currentItem ? <>
                        <FilePathComponent path={currentItem.path} />
                        {/* ONE line, whatever it ends up holding: this header
                            is two lines by construction (path, then metadata)
                            and both the loading skeleton below and the
                            maximized viewer's height budget are built on that
                            count. ItemMetaLine never wraps — it drops fields
                            instead — which is what keeps that promise as
                            fields are added to it. */}
                        <ItemMetaLine item={currentItem} className="text-gray-500" />
                    </> : <>
                        {/* Path and date lines with nothing in them yet: the
                            same two line boxes, so the header band keeps its
                            height while the chunk is in flight. */}
                        <p className="text-sm truncate relative">
                            &nbsp;
                            <span className="absolute inset-y-1 inset-x-4 animate-pulse rounded bg-muted" />
                        </p>
                        <p className="text-xs text-gray-500 relative">
                            &nbsp;
                            <span className="absolute inset-y-0.5 inset-x-1/4 animate-pulse rounded bg-muted" />
                        </p>
                    </>) : (
                        // The board is an arrangement, not a sequence: this
                        // strip is about the pinboard and the path is only its
                        // label, so an unresolved row just leaves it empty.
                        <PinboardTabs itemPath={currentItem?.path ?? ""} />
                    )}
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
                    {/* Header symmetry: Copy on the left (ShareButton),
                        Download on the right — but only when Copy is the primary
                        verb. When Download is already primary (plain web, no
                        relay / server copy) the left ShareButton IS a Download
                        control, so this twin would duplicate it and is omitted
                        (minor asymmetry in the download-only case, accepted). On
                        a narrow header it may also be dropped without loss —
                        Download still lives in ShareButton's right-click
                        alternates. */}
                    {currentItem && galleryShare.primaryVerb === "copy" && <Button
                        onClick={() => void galleryShare.download()}
                        disabled={galleryShare.busy}
                        variant="ghost"
                        size="icon"
                        title="Download file"
                        aria-label="Download file"
                        className="hidden sm:inline-flex"
                    >
                        <Download className="h-4 w-4" />
                    </Button>}
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
            {/* The error branch OUTRANKS the held item: `currentItem` falls
                back to the last displayed selection, so behind it the error
                frame would only ever fire on a truly cold open — the narrow
                half. Mid-session, a terminally-failed chunk under a held
                picture is the URL naming an item that cannot load while the
                panel shows a different one; the honest render is the error.
                It cannot interrupt playback: `targetErrored` implies
                `holding`, under which the gallery was already refusing to
                advance. */}
            {showsLargeImage ? (targetErrored ? <GalleryImageError
                thumbnailsOpen={thumbnailsOpen}
                showPagination={paginationVisible ?? totalPages > 1}
                onRetry={() => source.retryRange(urlIndex, urlIndex)}
            /> : currentItem ? <GalleryImageLarge
                item={currentItem}
                prevImage={prevImage}
                nextImage={nextImage}
                thumbnailsOpen={thumbnailsOpen}
                showPagination={paginationVisible ?? totalPages > 1}
                advanceToNextVideo={advanceToNextVideo}
                cancelPendingAdvance={cancelPendingAdvance}
            /> : <GalleryImageLoading
                thumbnailsOpen={thumbnailsOpen}
                showPagination={paginationVisible ?? totalPages > 1}
            />) : <PinBoard
                thumbnailsOpen={thumbnailsOpen}
                showPagination={paginationVisible ?? totalPages > 1}
            />}
            {/* `count`, not `source.count`: the strip must span the same extent
                the gallery clamps `gi` against, or a deep `gi` would resolve
                against an extent that is still growing — see `count` above. */}
            {!fs && thumbnailsOpen ? <VirtualGalleryHorizontalScroll
                source={source}
                count={count}
                // A card click is manual navigation like the arrows are, and
                // has to write the anchor with it — the strip is how a scroll-
                // mode binge covers ground fast, so it is the path that most
                // needs the grid to know where it ended up (see
                // useGalleryNavigate).
                onNavigate={navigateTo}
                // The strip's own live push (design §6): a strip PAN moves
                // the highlight without touching the URL, which navigation
                // (via the anchor) never covered. Already gated to scroll
                // mode by the host.
                onDerivedPageChange={onDerivedPageChange}
                pageSize={pageSize}
            /> : null}
        </div>
    )
}

// A header verb with no row behind it yet: the icon button's own footprint
// (h-10 w-10, see the button variants), so the header band cannot resize when
// the chunk lands. Same `bg-muted` pulse as ResultCellSkeleton, and for the
// same reason — the shared Skeleton primitive's bg-slate-100 is a
// light-mode-only value.
function ChromeSkeleton() {
    return <div aria-hidden="true" className="h-10 w-10 p-2">
        <div className="h-full w-full animate-pulse rounded bg-muted" />
    </div>
}

// The image panel with no item to paint (scroll mode: `gi` points into a chunk
// that is still in flight and nothing is being held — a deep link into a cold
// cache). The panel's own height expression, shared with GalleryImageLarge so
// the two can never drift, and inside it a single pulse: nothing here can
// depend on a row, and nothing may throw waiting for one.
function GalleryImageLoading({ thumbnailsOpen, showPagination }: {
    thumbnailsOpen: boolean
    showPagination: boolean
}) {
    return (
        <div className={cn(
            "relative grow flex justify-center items-center overflow-hidden",
            galleryPanelHeight(showPagination, thumbnailsOpen),
        )}>
            <div className="absolute inset-2 animate-pulse rounded bg-muted" />
        </div>
    )
}

// The same frame, for the one state the loading one cannot recover from: the
// chunk behind `gi` failed and react-query has stopped trying (see
// ResultsSource.errorAt). Same geometry as GalleryImageLoading and
// GalleryImageLarge — a panel that resizes when a request fails would move the
// header and the strip under the user — and the same wording register as the
// search error toast, which is what says the same thing about the main query.
//
// The retry is the whole reason this exists: nothing else in the app can
// restart a terminally-errored chunk.
function GalleryImageError({ thumbnailsOpen, showPagination, onRetry }: {
    thumbnailsOpen: boolean
    showPagination: boolean
    onRetry: () => void
}) {
    return (
        <div className={cn(
            "relative grow flex flex-col justify-center items-center gap-3 overflow-hidden",
            galleryPanelHeight(showPagination, thumbnailsOpen),
        )}>
            <p className="px-4 text-center text-sm text-muted-foreground">
                Couldn&apos;t load this range of results
            </p>
            {/* Neutral, not a destructive-red button: nothing is being
                destroyed and the panel is already the error surface. Same
                outline variant every other secondary action in the app uses. */}
            <Button variant="outline" size="sm" onClick={onRetry}>
                Retry
            </Button>
        </div>
    )
}

// The fixed height of the gallery's image panel: the remaining space once the
// header, the pagination bar (when the host shows one) and the thumbnail strip
// have taken theirs. One expression, two callers — the loading frame must
// occupy exactly what the loaded one will, or the panel would resize under the
// user the moment a chunk lands.
function galleryPanelHeight(showPagination: boolean, thumbnailsOpen: boolean) {
    return showPagination
        ? (thumbnailsOpen ? "h-[calc(100vh-567px)]" : "h-[calc(100vh-213px)]")
        : (thumbnailsOpen ? "h-[calc(100vh-505px)]" : "h-[calc(100vh-151px)]")
}

// The pinboard side of a Results/Pinboard (or path/Pinboard) tab pair:
// auto-layout toggle, the "pins" trigger and the board menu as one chip.
// Shared by the gallery header tabs below and the grid view's tabs — must
// be rendered inside a <Tabs> whose pinboard value is "pins".
export function PinboardTabChip({
    active,
    onActivate,
}: {
    active: boolean
    // Selects THIS strip's pinboard tab. Only the maximize button uses it,
    // and only because maximizing a board the host isn't showing would
    // fill the screen with nothing — see PinboardFullscreenButton.
    onActivate: () => void
}) {
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
            {/* Which packer the wand next to it will use. Gated like the
                wand: it writes the board's layout token, so it belongs to
                whichever strip is actually showing the board. */}
            <UniformLayoutToggle disabled={!active} />
            <TabsTrigger
                value="pins"
                className="shrink-0 rounded-none px-2 data-[state=active]:shadow-none"
            >
                Pinboard
            </TabsTrigger>
            {/* The one segment that works from an inactive tab, because it
                activates the tab itself */}
            <PinboardFullscreenButton active={active} onActivate={onActivate} />
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
                <PinboardTabChip
                    active={!hidePinBoard}
                    onActivate={() => void setHidePinBoard(false)}
                />
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

// Ref for the display loop's <video>: it does nothing on attach and TEARS THE
// ELEMENT DOWN on detach (a React 19 ref cleanup), so a navigation that removes
// it stops both its playback and its fetch at exactly that moment rather than
// whenever a detached media element happens to be collected.
//
// `pause()` ALONE IS NOT ENOUGH, and the earlier version of this comment
// claimed otherwise. Pausing stops playback and nothing else: the resource
// selection algorithm goes on buffering the rest of the loop into a detached
// element, which in an arrow-keyed gallery is a trail of multi-megabyte
// downloads for pictures nobody is looking at any more. Clearing `src` and
// calling `load()` is what the spec defines as aborting: it runs the media
// load algorithm on an empty source, which fires `emptied`, drops the current
// resource and cancels the fetch. Both, in that order, because `load()` on its
// own resets a still-set `src` and starts fetching again.
const pauseVideoOnDetach = (el: HTMLVideoElement | null) => () => {
    if (!el) return
    el.pause()
    el.removeAttribute("src")
    el.load()
}

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
        heightClass,
        onMediaAspect,
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
        /**
         * Replaces the panel's own viewport-derived height expression
         * (galleryPanelHeight) for a host that is NOT the gallery shell. That
         * expression is the one and only thing coupling this component to that
         * shell, which is what makes it reusable whole — the playability
         * ladder, transcode rendition, trim/outro handling, end action,
         * fullscreen host, click-half navigation and drag-out all come along
         * (docs/maximized-pinboard-search-overlay-design.md §8.3).
         *
         * The maximized board's viewer passes `absolute inset-0` to fill the
         * aspect-fitted box it computes for itself; `showPagination` and
         * `thumbnailsOpen` are inert for it, since they exist only to build
         * the expression this replaces. The page gallery passes nothing and
         * renders exactly as before.
         */
        heightClass?: string
        /**
         * Report the aspect an ELEMENT here has actually painted, for a host
         * that fits its own box around this component
         * (docs/maximized-pinboard-search-overlay-design.md §8.2). `item`'s
         * width/height are the CODED dimensions — the scanner never reads EXIF
         * orientation — so a host box built on them is a landscape frame
         * around a portrait photo, and only an element can say otherwise.
         *
         * ONLY <img>-confirmed aspects leave this component, never the
         * <video>'s onLoadedMetadata one, and that is a deliberate line: a
         * host box is a LAYOUT, and re-fitting it the moment a live element
         * reports metadata re-lays-out the player, its overlays and its click
         * zones mid-playback. The thumbnail's report costs nothing by
         * comparison — it lands in the same frame as the picture appearing, and
         * for a video that is reached in S0 (a play press) it lands before any
         * player exists, so a rotated one's host box is already corrected by
         * the time it plays. A video that mounts STRAIGHT into S1 — the
         * auto-advance chain, where `showVideo` is already on — renders no
         * thumbnail and reports nothing, so its host box keeps whatever it had
         * and the element letterboxes inside it. That is the behavior from
         * before this prop existed, and it is the right trade: a wrong frame
         * for one item beats re-laying-out a player that is already running.
         * The metadata aspect still drives THIS component's own overlays,
         * which are measured against the panel and are meant to move.
         *
         * Passing it is also what makes a plain image report at all: without a
         * host asking, a non-playable item does no aspect bookkeeping (it has
         * no overlays to anchor), and every existing call site keeps that.
         */
        onMediaAspect?: (sha256: string, ratio: number) => void
    }
) {
    const [dbs, ___] = useSelectedDBs()
    // The large view is on the DEFAULT path for every item — no `size=`, the
    // display rendition, exactly what it has always loaded. It is a CONTAIN
    // surface, so it never takes a grid tier (past aspect 2 that is a crop),
    // and the bare URL already is the display rendition.
    //
    // Extreme-aspect items used to spell `?size=display` out here to dislodge a
    // browser cache entry stamped before the tier work (an 800x20000 webtoon
    // was stored 163x4096 and painted at 163px wide). `r=2` dislodges it for
    // every display request now, so the spelling bought nothing but this
    // surface, the peek layer and the similarity header agreeing by hand.
    const thumbnailURL = getFileURL(dbs, "thumbnail", "sha256", item.sha256)
    const fileURL = getFileURL(dbs, "file", "sha256", item.sha256)

    // AN ANIMATED ITEM BIG ENOUGH THAT THE DISPLAY SIZE IS A LOOP, NOT A
    // PICTURE (docs/thumbnail-format-implementation.md R3). Past any of the
    // server's three bounds the endpoint answers this exact URL with
    // `video/mp4`, so the element has to be a `<video>` — an `<img>` there is a
    // broken picture, and the biggest surface in the app is the worst place for
    // one. Below them, or against a server that reports no trigger, NOTHING
    // changes: the same `<img>` at the same URL, serving the item's own file,
    // animating natively as it always has.
    //
    // Decided from ROW DATA against `/api/client-config` — no probe request and
    // no error latch in the common path, the same rule the grid follows.
    // `still=true` is not involved: this surface WANTS the motion, and the
    // still URL is only ever the poster below.
    const displayLoopTrigger = useDisplayLoopTrigger()
    // The still poster of the same rendition: the display size with
    // `still=true`, which the endpoint guarantees answers an IMAGE — a poster,
    // or the original for a sentinel or under-bound item — never video and
    // never a 404 (§5). Both the `<video>`'s `poster` and one of the two
    // fallbacks below.
    const stillURL = getFileURL(dbs, "thumbnail", "sha256", item.sha256, undefined, true)
    // WHAT THIS SURFACE FALLS BACK TO WHEN THE `<video>` SAYS THE LOOP IS NOT
    // THERE — A TWO-RUNG LADDER, walked on ANY error with no reading of the
    // error code at all.
    //
    // THE CONTRACT: rung 1 is the BARE display URL in an `<img>`, rung 2 is the
    // same request with `still=true`.
    //
    // Rung 1 first because of the keep-the-original SENTINEL — an item over the
    // bounds whose H.264 encode came out no smaller than its source, which the
    // endpoint answers at the bare URL with the ORIGINAL FILE, an animated GIF
    // or WebP that moves natively in an `<img>` at full size. `still=true` on
    // such an item does NOT answer that file: above the raw floor it answers
    // the stored ≤1024 grid-m POSTER, so landing there directly would downgrade
    // the app's largest surface from the animating original to a static
    // thumbnail. The `<img>` costs nothing extra either — the bytes are the ones
    // the `<video>` already asked for, so a sentinel item hits the browser
    // cache.
    //
    // Rung 2 exists because rung 1 can fail too, and for a reason no client-side
    // test predicts: a Chromium build with no H.264 decoder rejects a real loop,
    // and the bare URL then hands that `<img>` the mp4's bytes. `still=true` at
    // the display size is the one request the endpoint guarantees answers an
    // image (§5), so the ladder terminates there.
    //
    // NO ERROR CODE IS READ, deliberately. The split this replaces treated
    // MEDIA_ERR_SRC_NOT_SUPPORTED as "the sentinel" — one saved request in that
    // case, and a broken picture on the no-H.264 Chromium, where code 4 also
    // covers "this is not media I can play" and "the fetch failed" (see
    // `shouldDowngradeOnError`, which refuses that code for the same ambiguity).
    //
    // ONE SLOT, HOLDING ONE SHA, and CLEARED WHENEVER THE ITEM CHANGES. Within
    // a visit it holds, because an element that has errored must not be
    // re-mounted on the next render into the same error; across a navigation
    // it must not, so a transient failure retries the loop the next time the
    // item is opened while the sentinel case simply re-derives the same answer
    // on its first frame.
    //
    // THE CLEAR IS EXPLICIT, and that is the fix: this component is NOT keyed
    // by item at either host (app/search/PreviewSurface.tsx and the gallery
    // page both render one long-lived GalleryImageLarge and change its
    // `item`), so nothing unmounts on navigation and a slot left standing made
    // A(fails) → B → A permanent — the fallback picture forever, on an item
    // whose loop may have been one dropped connection away. Adjusted during
    // render like `videoSlot` below rather than in an effect, so the pass that
    // renders the new item never renders the old one's fallback; the sha guard
    // makes that throwaway pass correct anyway.
    //
    // Nothing here is remembered per sha for the session — that is
    // `videoPlayability`'s job, for a different question about a different URL.
    const [loopFallback, setLoopFallback] = useState<{ sha: string; rung: 1 | 2 } | null>(null)
    if (loopFallback && loopFallback.sha !== item.sha256) {
        setLoopFallback(null)
    }
    const loopRung = loopFallback?.sha === item.sha256 ? loopFallback.rung : null
    const showDisplayLoop =
        exceedsDisplayLoopTrigger(item, displayLoopTrigger)
        && loopRung === null

    const searchLoading = useSearchLoading(state => state.loading)

    // The playability tri-state (lib/videoPlayability.ts) replaces the
    // mp4-or-webm mime guess this used to be: `unsupported` is the only
    // verdict with no play affordance, and `needs-transcode` mounts the
    // server's rendition instead of the file.
    //
    // The PLAYER's gate, deliberately wider than the advance chain's
    // `isPlayableVideo` above — see that comment for why the two predicates
    // parted company (a needs-transcode item has a play button, but only a
    // deliberate press may start its job, so the chain may not land on one).
    const transcodeEnabled = useVideoTranscodeEnabled()
    const playability = useVideoPlayability(item, transcodeEnabled)
    const isPlayable = playability !== "unsupported"
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
    // The element as STATE alongside the ref. A needs-transcode item mounts
    // its <video> long after showVideo flips (when the job finishes), and the
    // volume/speed effects key on `showVideo` — without this they would run
    // once against a null ref and the rendition would arrive at full volume,
    // 1x. Memoised, because an inline ref callback is a new function every
    // render and React would detach/reattach (null, then the element) on each
    // one; the identity changes only with the per-item ref slot, which is
    // exactly when a fresh element mounts anyway.
    const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
    const attachVideo = React.useCallback((el: HTMLVideoElement | null) => {
        videoRef.current = el
        setVideoEl(el)
    }, [videoRef])
    const videoState = useVideoPlayerState({
        videoRef,
        element: videoEl,
        persistVolume: true,
    })
    // The bytes the element actually mounts: the original file when the
    // browser can decode it, the finished artifact once a needs-transcode
    // item's job is done, and null until then — which is what keeps a play
    // press from loading a file this browser would render as a black frame.
    // The download row and the drag-out below deliberately keep `fileURL`.
    const playback = useVideoPlayback({
        sha256: item.sha256,
        playability,
        fileURL,
        dbs,
    })
    const playbackURL = playback.url
    const showVideo = isPlayable && videoState.showVideo && playbackURL != null
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
        // Out to a host that fits its own box around this component, if one
        // asked (see onMediaAspect). Deliberately not behind the first-writer
        // rule below: the host weighs this against sources of its own, and a
        // re-run of the ref callback must reach it every time or a host that
        // mounted after the picture loaded would never hear the answer. Its
        // handler is idempotent for the same reason PeekLayer's is.
        onMediaAspect?.(item.sha256, thumbRatio)
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
    // there before the first frame plays. The EFFECTIVE playback URL, not
    // `fileURL`: the probe's whole contract is that it measures the bytes the
    // player mounts, and a transcoded rendition has its own timeline. It is
    // therefore also gated on there being a URL at all — an item still
    // waiting on its encode has nothing to measure, and the probe cache stays
    // keyed by the original sha either way.
    const probedVideoEnd = useVideoEndProbe(
        playbackURL,
        item.sha256,
        playbackURL != null
        && outroSkip && outroProbeEligible(item.content_end_ms, item.duration),
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
    // gallery's rows/index/page and are re-created every render, and
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
        // is what lets it close over the host's live rows/index/page.
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

    // What a clip export of this item would ask for, computed HERE because
    // this is the only place all three inputs exist together. `cut: "outro"`
    // whenever the outro default is what ends playback — the server re-derives
    // that boundary in the file's own timeline (see clipRequestFor).
    //
    // Independent of the end action above: what the export encodes is the
    // RANGE, and the range is the same whether that end then loops, parks or
    // advances.
    const clipRequest = clipRequestFor(
        trim,
        effectiveTrim,
        outroSkipGoverns(trim, outroCut, outroSkip),
    )

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
            // gallery navigation. Shared with every other key scope, and read
            // its TRAP note: the list this used to spell out inline included
            // `[role="listbox"]`, which cmdk renders on a permanently-mounted
            // element, so on a tag-indexed database this whole handler — every
            // arrow, every player chord — returned on the first line.
            if (hasOpenLayer()) return
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
                // TRAP: this bail is what the `[role="listbox"]` guard above
                // was accidentally standing in for. While that guard matched
                // on every tag-indexed database this whole handler was dead,
                // so the collisions never showed; with the scope revived,
                // `←` on a focused Radix tab trigger would switch the tab AND
                // step `gi` (pushing a history entry), and `→` on a focused
                // slider thumb would move the value AND advance the gallery.
                // Only the ARROW branch stands down — the player chords below
                // are not keys a tab strip or a slider claims, and the
                // viewer's own arrows ride this same scope (§8.3), so a
                // blanket return would take those with it.
                if (consumesArrowKeys(t)) return
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
                    // A slider thumb is a focusable span, not a button, so
                    // the tests above miss it: a widget that owns its own
                    // keyboard owns its own activation key too, and starting
                    // playback because the pointer left focus on a sidebar
                    // slider is not what the press meant.
                    || consumesArrowKeys(focused)
                )) return
                if (e.shiftKey) return
                e.preventDefault()
                // Same verb as the S0 button: on a needs-transcode item the
                // press is what asks for the rendition (a job is never
                // started by anything but a deliberate play).
                playback.start()
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
    }, [isPlayable, showVideo, playerActive, prevImage, nextImage, videoState, player, trim, videoRef, setGalleryTrim, item.sha256, playback])

    // HTMLElement, not HTMLImageElement: the picture is an `<img>` or a
    // `<video>` depending on the item (see showDisplayLoop), and the drag
    // payload — the ORIGINAL file's URL — is the same either way.
    const handleDragStart = (event: React.DragEvent<HTMLElement>): void => {
        if (!fileURL) return;
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/plain', item.sha256);
        event.dataTransfer.setData('text/uri-list', fileURL);
    };
    return (
        <div
            ref={panelRef}
            className={cn("relative grow flex justify-center items-center overflow-hidden group",
                // Fills the remaining space, and by how much depends on
                // whether the pagination bar and the thumbnails are shown —
                // see galleryPanelHeight, which the loading frame shares.
                // A host outside the gallery shell overrides it outright.
                heightClass ?? galleryPanelHeight(showPagination, thumbnailsOpen),
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
                            ref={attachVideo}
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
                            src={playbackURL ?? undefined}
                            // Two unrelated failures wear the same event.
                            //
                            // An ARTIFACT that will not load is the job's
                            // problem, never evidence about the source: the
                            // global disk cache can evict it between `done`
                            // and this fetch, and one automatic re-POST
                            // recovers it (see useVideoPlayback).
                            //
                            // A failing SOURCE is the representative-profile
                            // recovery (docs/video-transcoding-design.md §6):
                            // a codec string can answer `probably` for a
                            // stream this decoder cannot actually handle, and
                            // the element is the only thing that knows. But
                            // ONLY when it says DECODE — a dropped connection
                            // must not take a perfectly playable codec away
                            // for the rest of the session.
                            onError={(e) => {
                                if (playback.isArtifact) {
                                    playback.noteArtifactError()
                                    return
                                }
                                if (playability === "playable"
                                    && shouldDowngradeOnError(e.currentTarget.error)) {
                                    noteVideoPlaybackError(item.sha256)
                                }
                            }}
                            // The artifact played, so the one automatic
                            // recovery above is re-armed for next time
                            onPlaying={playback.notePlaying}
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
                                    // Top-right of the picture, unconditionally.
                                    // There used to be a host override here
                                    // (`playerTopRightClass`) for a host that
                                    // laid its own header OVER this corner —
                                    // the maximized board's viewer — because
                                    // burying this kebab traps the user in S2,
                                    // it being the only way back out of the
                                    // native controls. That header now owns a
                                    // row of its own instead of the picture's
                                    // top band (app/search/PreviewSurface.tsx),
                                    // so no host covers this corner and the
                                    // override went with it.
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
                        {/* The download verb, anchored to the PICTURE's
                            top-right exactly like the S2 escape kebab above —
                            a sibling of the surface, not part of it, and
                            inside the fullscreen host so it survives element
                            fullscreen — where it must span the host instead:
                            pictureBox is measured against the PANEL, and
                            keeping it while the host spans the screen parks
                            the button mid-screen (same gate as surfaceBox).
                            Only in S1: with native controls up the escape
                            kebab owns that corner, and the kebab's own
                            "Download original" row is what serves both that
                            state and the mini tier. */}
                        {!videoState.showControls && (
                            <div
                                className={cn(
                                    "pointer-events-none absolute",
                                    (!pictureBox || player.isFullscreen) && "inset-0",
                                )}
                                style={player.isFullscreen ? undefined : pictureBox ?? undefined}
                            >
                                <VideoDownloadControl
                                    // Shares the escape kebab's corner above:
                                    // only one of the two is ever mounted, so
                                    // they can and do sit in the same place.
                                    controller={player}
                                    download={{
                                        url: fileURL,
                                        filename: downloadFileName(
                                            item.path, item.sha256, item.type),
                                    }}
                                    clip={{
                                        sha256: item.sha256,
                                        dbs,
                                        request: clipRequest,
                                        // What an untrimmed row would encode:
                                        // the animated-image row is offered
                                        // only inside the server's cap
                                        duration: item.duration,
                                    }}
                                    size={surfaceBox ? playerSizeForWidth(surfaceWidth) : "full"}
                                />
                            </div>
                        )}
                    </div>
                    :
                    <a
                        href={fileURL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="absolute inset-0"
                        onClick={(e) => e.preventDefault()}
                    >
                        {showDisplayLoop ?
                            /* eslint-disable-next-line jsx-a11y/media-has-caption */
                            <video
                                // Keyed by item for the same reason the player's
                                // element is: navigation must give a FRESH one.
                                // A reused element keeps the previous item's
                                // playback state, because a bare src swap fires
                                // `emptied`, not `pause`.
                                key={item.sha256}
                                src={thumbnailURL}
                                // The still URL of the same rendition, so the
                                // first frame paints while the loop's bytes are
                                // still arriving. It is the peek layer's URL
                                // character for character, so the two surfaces
                                // fetch this picture once between them.
                                poster={stillURL}
                                // AUTOPLAY, unlike the grid's LoopVideo: there is
                                // no playback director here and nothing to
                                // schedule. The gallery shows ONE item, the user
                                // asked for it, and an animated picture that
                                // needs a press to move is not the picture the
                                // `<img>` used to be.
                                autoPlay
                                muted
                                loop
                                playsInline
                                disablePictureInPicture
                                // A <video> has no implicit ARIA role, so without
                                // this a screen reader announces nothing where the
                                // <img> it stands in for announces its `alt`. This
                                // is a picture that happens to move: no controls,
                                // no sound, no timeline the user can reach.
                                role="img"
                                aria-label={`${item.path}`}
                                draggable={true}
                                onDragStart={handleDragStart}
                                // Belt to the key's braces. React removes the
                                // element on navigation, but a detached media
                                // element goes on fetching until it is collected,
                                // and the gallery is arrow-keyed — a fast sweep
                                // would leave a trail of them downloading. A ref
                                // CLEANUP (React 19) runs at exactly the moment
                                // the element leaves, and it ABORTS rather than
                                // merely pausing. Module scope, and read why
                                // before inlining it.
                                ref={pauseVideoOnDetach}
                                // The element is the only thing that can tell us
                                // this URL is not a loop after all, and the
                                // answer to every way it can say so is the same
                                // still picture — see `loopFallback`. No error
                                // code is read, deliberately. Recording the sha
                                // makes this idempotent: the fallback renders an
                                // <img> instead of this element, so the handler
                                // cannot fire twice.
                                onError={() => setLoopFallback({
                                    sha: item.sha256,
                                    rung: 1,
                                })}
                                // What next/image's `fill` writes as inline
                                // style, plus the `<img>`'s own object-fit: the
                                // two elements must occupy the same box.
                                className="absolute inset-0 h-full w-full object-contain"
                                // Reports NO aspect, deliberately, and this is the
                                // rule this component already follows for the
                                // player's element (see onMediaAspect): a host box
                                // is a LAYOUT, and re-fitting it when a live
                                // element reports metadata re-lays-out everything
                                // anchored to it. The cost here is nil — a host
                                // falls back to item.width/height, which for an
                                // animated image ARE the display dimensions (no
                                // EXIF rotation exists in GIF/WebP animation, and
                                // the scan stores rotated dimensions anyway).
                            />
                            :
                            <Image
                                // The thumbnail URL for every item that was
                                // never a loop AND for rung 1 of the ladder,
                                // which is the same URL in a different element;
                                // the `still=true` URL only at rung 2 (see
                                // `loopFallback`).
                                src={loopRung === 2 ? stillURL : thumbnailURL}
                                alt={`${item.path}`}
                                draggable={true}
                                onDragStart={handleDragStart}
                                // The second rung, and only from the first: a
                                // plain picture that fails to load is the
                                // ordinary broken-image case this surface has
                                // always had, and re-requesting it with
                                // `still=true` would ask a question nobody
                                // asked.
                                onError={loopRung === 1
                                    ? () => setLoopFallback({ sha: item.sha256, rung: 2 })
                                    : undefined}
                                fill
                                className="object-contain"
                                unoptimized={true}
                                // Playable items, or a host that asked for the
                                // painted aspect (onMediaAspect) — for a still
                                // image this element is what the panel actually
                                // shows, so it is the only thing that can correct
                                // an EXIF-rotated host box. It is NOT necessarily
                                // the original file: `thumbnail` serves the file
                                // itself only below the scanner's size thresholds,
                                // and above them a STORED thumbnail the `image`
                                // crate wrote with no EXIF and no orientation
                                // applied (panoptikon/src/jobs/files.rs,
                                // image_is_served_directly). A host must weigh the
                                // answer knowing that — see PreviewSurface's
                                // `confirmed`, where treating "same file" as "same
                                // painted image" was a real bug. Neither: a plain
                                // image renders exactly as it always did, with no
                                // aspect bookkeeping and no overlay box to anchor.
                                // The ref covers cache hits that complete before
                                // React attaches onLoad (same pattern as the pin's
                                // thumbnail); onLoad covers the network path.
                                ref={isPlayable || onMediaAspect ? ((el) => {
                                    if (el?.complete) noteThumbAspect(el)
                                }) : undefined}
                                onLoad={isPlayable || onMediaAspect
                                    ? ((e) => noteThumbAspect(e.currentTarget))
                                    : undefined}
                            />}

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
                player"), large and centered on the picture like every video
                site's poster affordance. Once the video is loaded the surface
                owns mute, close and the native toggle, so MediaControls
                stands down entirely. */}
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
                            // The one place a playback transcode is ever
                            // started: a deliberate press. Harmless on a
                            // playable item (start() is a no-op there) and
                            // deduplicated per sha:preset, so a second press
                            // while the job runs joins instead of re-POSTing.
                            playback.start()
                            videoState.setPlaying(playing)
                            player.show()
                        }}
                        progress={playback.badge}
                        size="large"
                        playButtonClassName="pointer-events-auto left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                    />
                </div>
            )}
        </div>
    )
}

