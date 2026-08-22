"use client"
import { PageSelect } from "@/components/pageselect"
import { useInstantSearch, useSearchLoading } from "@/lib/state/zust"
import { Toggle } from "@/components/ui/toggle"
import { Settings, RefreshCw, ScanEye } from "lucide-react"
import { AnimatedNumber } from "@/components/ui/animatedNumber"
import { InstantSearchLock } from "@/components/InstantSearchLock"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { SearchBar, TagSearchBar } from "@/components/searchBar"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { SearchQueryArgs } from "./queryFns"
import { SearchErrorToast } from "@/components/searchErrorToaster"
import { cn } from "@/lib/utils"
import { ScrollBar } from "@/components/ui/scroll-area"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { SideBar } from "@/components/sidebar/SideBar"
import { SearchResultImage } from "@/components/SearchResultImage"
import { useGalleryFullscreen, useGalleryIndex, useGalleryPinBoardLayout, useGridLibraryTab, useGridPinboardTab, usePinboardMaximized, useViewMode } from "@/lib/state/gallery"
import type { ViewMode } from "@/lib/state/gallery"
import { useSideBarOpen } from "@/lib/state/sideBar"
import { selectedDBsSerializer, useSelectedDBs } from "@/lib/state/database"
import { arrayResultsSource, useChunkedResults, useSearch, type ResultsSource } from "@/lib/searchHooks"
import { SCROLL_CHUNK_SIZE, type SearchRequestParts } from "@/lib/searchRequest"
import { ImageGallery, PinboardTabChip } from '@/components/gallery/ImageGallery'
import { PinBoard } from '@/components/gallery/GalleryPinBoard'
import { PinboardLibraryButton } from '@/components/gallery/PinboardLibrary'
import { PinboardSearchGrid } from '@/components/gallery/PinboardSearchGrid'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePinboardURLLoader } from '@/lib/pinboardLinks'
import { usePinboardAssociatedOnly } from '@/lib/state/pinboardLibraryPrefs'
import { ImageSimilarityHeader } from '@/components/ImageSimilarityHeader'
import { mintSeed, useOrderBy, usePageSize, usePageSizeRaw, useQueryOptions, useRandomSeed, useSearchPageRaw, useStampRandomSeed } from "@/lib/state/searchQuery/clientHooks"
import { creationStamp, effectiveCreationDefaults, isFreshSession } from "@/lib/searchDefaults"
import { ViewModeToggle } from "@/components/ViewModeToggle"
import { getScrollPositionURL } from "@/lib/state/searchQuery/serializers"
import { overscanItemsFor, topRowHighlightItem, virtualPageAnchor, virtualPageOf } from "@/lib/scrollMode"
import { useSearchParams, type ReadonlyURLSearchParams } from "next/navigation"
import { ResultCellSkeleton } from "@/components/ResultCellSkeleton"
import Link from "next/link"
import { useItemSelection } from "@/lib/state/itemSelection"
import { useVirtualizer } from "@tanstack/react-virtual"
import { components } from "@/lib/panoptikon"
import { GRID_SCROLL_ANCHOR_KEY, useGridScrollAnchor } from "@/lib/state/gridScroll"
import { DesktopUpdateRibbon } from "@/components/DesktopUpdateRibbon"
import { SearchMetricsHoverCard } from "@/components/SearchMetricsCard"
import { $api } from "@/lib/api"
import { useClientConfig } from "@/lib/useClientConfig"

export function SearchPageContent({ initialQuery, isRestrictedMode }:
    { initialQuery: SearchQueryArgs, isRestrictedMode: boolean }) {
    const [sidebarOpen, _] = useSideBarOpen()
    const [updateRibbonVisible, setUpdateRibbonVisible] = useState(false)
    // A maximized board owns the whole view: the sidebar is a search consumer
    // like everything else the maximize hides, and `sb` stays untouched so it
    // is back when the board shrinks.
    const pinboardMaximized = usePinboardMaximized()
    const sidebarVisible = sidebarOpen && !pinboardMaximized
    return (
        <div className="flex h-screen w-full flex-col">
            <DesktopUpdateRibbon onVisibilityChange={setUpdateRibbonVisible} />
            <div className="flex min-h-0 flex-1">
                {!pinboardMaximized && <SideBar />}
                <div className={cn('p-4 transition-all duration-300 mx-auto',
                    sidebarVisible ? 'w-full lg:w-1/2 xl:w-2/3 2xl:w-3/4 4xl:w-[80%] 5xl:w-[82%]' : 'w-full'
                )}>
                    <MultiSearchView
                        initialQuery={initialQuery}
                        isRestrictedMode={isRestrictedMode}
                        updateRibbonVisible={updateRibbonVisible}
                    />
                </div>
            </div>
        </div>
    )
}

// ---- The three mount/URL effects MultiSearchView used to own inline.
//
// Extracted for ONE mechanical reason: each of them suppresses
// `react-hooks/exhaustive-deps`, and that suppression makes the React Compiler
// skip the whole enclosing function — per function, not per effect. Inline,
// the three of them cost MultiSearchView (the search page's largest component)
// its memoization entirely. As their own hooks the skip lands on a hook that
// does nothing but run its effect, and MultiSearchView compiles again. Each
// takes exactly the values its body reads; nothing else moved.

/**
 * The highlighted virtual page: MultiSearchView's own state, plus the effect
 * that seeds it from the URL anchor.
 *
 * The LIVE value comes from the grid, which is the only place it can be
 * computed correctly: the highlight is derived from the top visible ROW (see
 * topRowHighlightItem), and rows exist only inside the virtualizer.
 *
 * What is derived HERE — from the URL anchor, as `floor(top / k) + 1` — is a
 * placeholder for the window before the grid's first scroll event: first paint
 * of a deep link, back/forward, a scrubber jump. (A page-size relabel moves
 * nothing and produces no scroll, so it is not in that list — the grid reports
 * that one directly; see below and ResultGrid's [pageSize] effect.) It is
 * deliberately the plainer expression, because a URL anchor is an item and
 * needs no row geometry to place; and it is deliberately not authoritative,
 * because it cannot see the columns. Every one of those positions reaches the
 * grid as a scroll (the restore's programmatic one included), and that scroll's
 * own event replaces this value with the row-derived one.
 */
function useDerivedVirtualPage({ scrollMode, scrollAnchor, k, galleryOpen }: {
    scrollMode: boolean,
    scrollAnchor: number | null,
    k: number,
    /** `gi !== null`: the gallery is mounted and the grid is NOT. */
    galleryOpen: boolean,
}) {
    const [derivedPage, setDerivedPage] = useState(() => virtualPageOf(scrollAnchor ?? 0, k))
    // …which is why `scrollAnchor` is deliberately NOT a trigger WHILE THE GRID
    // IS MOUNTED, only a value read when something else fires. The grid WRITES
    // that anchor on every scroll stop, and it writes the first item of the top
    // row while the highlight speaks for that row's last item — so re-deriving
    // on a self-write would pull the bar back by a page 350ms after the user
    // stopped scrolling, which is the very lattice flip topRowHighlightItem
    // exists to remove. An anchor arriving from anywhere else (back/forward, a
    // scrubber jump, a query reset) moves the grid, and the resulting scroll
    // reports the correct number itself.
    //
    // WITH THE GALLERY OPEN that reasoning inverts, and the anchor becomes the
    // only trigger there is: the grid is unmounted, so it can neither perform
    // the scroll-stop rewrite the exclusion protects against nor report a
    // number of its own — while the gallery's manual navigation (arrows,
    // filmstrip, the advance chain) writes the anchor alongside `gi` on every
    // step. That anchor IS the position, item for item, so `virtualPageOf` on
    // it is exact rather than a row-quantized approximation, and the scrubber
    // under the open gallery tracks a binge across the whole set instead of
    // freezing on the page the gallery was opened at.
    //
    // Neither TRANSITION of `galleryOpen` re-derives, and both exclusions are
    // load-bearing. Opening is the pullback case above seen from one commit
    // later: the anchor standing in the URL is the grid's own scroll-stop
    // write, and adopting it would flip the bar back a page the moment the user
    // opens an item. Closing needs no run either — the live tracking above has
    // already put the bar where the gallery left it, and the grid's restore
    // scroll reports the row-derived number a frame later.
    //
    // k is NOT a trigger either, for a reason worth stating because it looks
    // like one: a page-size relabel does renumber a position that has not
    // moved, and does produce no scroll to report it — but the number it needs
    // is the row-derived one, and this expression cannot compute that. The GRID
    // pushes it instead, from its own [pageSize] effect (see ResultGrid). Both
    // firing would be worse than either alone: child effects run before parent
    // ones, so the grid's correct value would land first and this placeholder
    // would immediately overwrite it — the bar sitting a page low until the
    // next scroll, which is the bug the grid-side trigger exists to remove.
    //
    // The anchor BECOMING NULL is a trigger — the restore effect clears a stale
    // anchor without scrolling anything (there is nowhere to scroll to), so no
    // event would ever walk the bar back from the dead page the stale anchor
    // placed it on. Only the null transition: a non-null self-write is the
    // scroll-stop pullback case excluded above.
    const wasGalleryOpen = useRef(galleryOpen)
    useEffect(() => {
        const previouslyOpen = wasGalleryOpen.current
        wasGalleryOpen.current = galleryOpen
        if (!scrollMode) return
        if (galleryOpen !== previouslyOpen) return
        setDerivedPage(virtualPageOf(scrollAnchor ?? 0, k))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scrollMode, scrollAnchor === null, galleryOpen, galleryOpen ? scrollAnchor : null])
    return [derivedPage, setDerivedPage] as const
}

/**
 * A hand-made or hand-edited `vm=scroll&page=N` URL, self-healed on load the
 * way a seedless random URL is (useStampRandomSeed): scroll mode is DEFINED by
 * having no `page` at all — two live position params is the bug class the mode
 * avoids — so the page number is re-expressed as the position it names and the
 * param dropped, in one tick and in "replace" (a correction to a URL that was
 * never valid, not somewhere to navigate back to).
 *
 * Presence is read from `useSearchParams`, not from nuqs: nuqs cannot tell
 * `page=1` from absent, and `page=1` is exactly the case that must still lose
 * the param. `top` WINS when both are present — it is the mode's own coordinate
 * and the more specific one, so a link carrying both is read as a position with
 * a stale page number attached.
 *
 * A MOUNT-TIME decision, taken from a snapshot rather than from a live
 * subscription, and that is load-bearing rather than tidy. The only URL this
 * may ever correct is one that ARRIVED in scroll mode carrying a page; a URL
 * that ENTERS scroll mode later is a mode switch, and a mode switch has already
 * written the position it means (see useCommitViewMode, which writes `vm`,
 * `page=null` and `top` in one batch). Re-deciding on a live params read could
 * observe that batch half-propagated — `vm=scroll` and `page` still present,
 * `top` not yet — and "correct" the switch's own anchor back to the top of a
 * page it just left.
 */
function useScrollURLNormalization({ urlParams, scrollMode, page, k, setScrollAnchor, setPageRaw }: {
    urlParams: ReadonlyURLSearchParams,
    scrollMode: boolean,
    page: number,
    k: number,
    setScrollAnchor: ReturnType<typeof useGridScrollAnchor>[1],
    setPageRaw: ReturnType<typeof useSearchPageRaw>[1],
}) {
    // Read on the first render, consumed once by the effect below. `useRef`'s
    // initial value is only taken on that first render, so this is the URL the
    // component mounted with no matter how often it re-renders.
    //
    // `freshSession` — no presentation or position parameter at all — is what
    // makes this correction and the creation-defaults stamp below MUTUALLY
    // EXCLUSIVE by construction rather than by coincidence: one runs only when
    // it is true, the other only when it is false, and both take it from
    // `isFreshSession` over the SAME first-render `urlParams` (the two hooks
    // are called with one value in one component), so no load can ever reach
    // both writers. (They are exclusive by content too — normalization needs
    // `vm` AND `page` present, which is not a fresh session — but that is an
    // argument a reader has to reconstruct, and the two effects write the same
    // parameters.)
    const mountURL = useRef({
        params: urlParams,
        scrollMode,
        page,
        k,
        freshSession: isFreshSession(urlParams),
    })
    const normalizedScrollURL = useRef(false)
    useEffect(() => {
        // Empty deps already make this once-per-mount; the ref covers the
        // double invocation React's StrictMode adds in development.
        if (normalizedScrollURL.current) return
        normalizedScrollURL.current = true
        const mounted = mountURL.current
        if (mounted.freshSession) return
        if (!mounted.scrollMode || !mounted.params.has("page")) return
        const replace = { history: "replace" as const }
        if (!mounted.params.has(GRID_SCROLL_ANCHOR_KEY)) {
            const anchor = virtualPageAnchor(mounted.page, mounted.k)
            setScrollAnchor(anchor > 0 ? anchor : null, replace)
        }
        setPageRaw(null, replace)
        // The setters churn identity per render and every value read here is a
        // mount-time snapshot, so there is nothing honest to depend on.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
}

/**
 * The creation-defaults layer: a load carrying NO presentation or position
 * parameter is a new search session, and the user's saved presentation is
 * stamped into it as explicit parameters — once, here, and never again for the
 * life of the session (docs/search-scroll-mode-design.md §7, the
 * lib/pinboardDefaults.ts pattern). Everything that makes this correct is in
 * lib/searchDefaults.ts; what is left here is the lifecycle.
 *
 * The complement of the normalization hook's guard, off the same first-render
 * `urlParams` — see `freshSession` above. A URL with any of those parameters is
 * a bookmark, a share or a navigation and already carries its own presentation,
 * so this touches nothing; a fresh URL cannot be the `vm=scroll&page=N` shape
 * the other effect exists to correct.
 *
 * "replace", unlike the pinboard stamp's push: there is no sibling navigation
 * to fold into, and the entry this rewrites is the one the user just arrived on
 * — a Back that returned to the unstamped URL would only stamp it again. Both
 * writes in one tick, so nuqs coalesces them into a single URL update.
 *
 * With the shipped creation defaults equal to the codec defaults, a user who
 * has saved nothing produces an EMPTY stamp and no write at all: the paged
 * experience is byte-identical to what it was before this existed (asserted in
 * scripts/scrollmode.test.mjs).
 */
function useSearchCreationStamp({ urlParams, setViewMode, setPageSizeRaw }: {
    urlParams: ReadonlyURLSearchParams,
    setViewMode: ReturnType<typeof useViewMode>[1],
    setPageSizeRaw: ReturnType<typeof usePageSizeRaw>[1],
}) {
    // The same first-render snapshot discipline as the normalization hook's,
    // for the same reason: this decision is about the URL the session STARTED
    // on, and every later value of it is a navigation this must not act on.
    const freshSession = useRef(isFreshSession(urlParams))
    const stampedDefaults = useRef(false)
    useEffect(() => {
        if (stampedDefaults.current) return
        stampedDefaults.current = true
        if (!freshSession.current) return
        // Belt to that brace, and it can only ever SUPPRESS a stamp: the
        // snapshot above is React's view of the URL on the first render, while
        // this is the browser's own, read at the only moment the two could
        // have diverged. Stamping over a URL that turns out to carry a
        // presentation is the one failure mode here that loses something the
        // user asked for (a shared `?page=3` opening on page 1), and the
        // design's rule for every ambiguous case is that conservative is
        // correct.
        if (!isFreshSession(new URLSearchParams(window.location.search))) return
        const stamp = creationStamp(effectiveCreationDefaults())
        const replace = { history: "replace" as const }
        if (stamp.vm !== undefined) setViewMode(stamp.vm, replace)
        if (stamp.page_size !== undefined) setPageSizeRaw(stamp.page_size, replace)
        // Mount-only, exactly like the normalization effect above: the
        // decision is taken from the snapshot, and the setters churn identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
}

export function MultiSearchView({ initialQuery, isRestrictedMode, updateRibbonVisible = false }:
    { initialQuery: SearchQueryArgs, isRestrictedMode: boolean, updateRibbonVisible?: boolean }) {
    const { data, error, isError, refetch, isFetching, resultsAreStale, nResults, countIsPlaceholder, page, pageSize, setPage, searchEnabled, getPageURL, committedQuery, queryEnabled } = useSearch({ initialQuery })
    const { toast } = useToast()
    // Random ordering is now a stable shuffle pinned by a seed, so refetching
    // deliberately returns the *same* results — that stability is the point.
    // Refresh therefore means "reshuffle" here: mint a new seed and let the
    // changed query drive the request (an explicit refetch would be
    // redundant). history "push" so Back returns to the previous shuffle,
    // which is now a working operation rather than a fresh random draw.
    const orderedRandomly = useOrderBy().order_by === "random"
    const setSeed = useRandomSeed()[1]
    const onRefresh = async () => {
        if (!searchEnabled) {
            toast({
                title: "Error",
                description: "Invalid user input",
                duration: 2000
            })
            return
        }
        if (orderedRandomly) {
            await setSeed(mintSeed(), { history: "push" })
            toast({
                title: "Reshuffled results",
                description: "A new random order has been picked",
                duration: 2000
            })
            return
        }
        await refetch()
        toast({
            title: "Refreshed results",
            description: "Results have been updated",
            duration: 2000
        })
    }
    // Self-heals random-ordered links that predate seeds (see the hook)
    useStampRandomSeed()
    const instantSearch = useInstantSearch((state) => state.enabled)
    useEffect(() => {
        if (!instantSearch && searchEnabled) {
            // Make pagination work if the user has disabled instant search.
            // Page size belongs here for the same reason the page number does:
            // instant-search-off exists to stop queries firing while the
            // *query* is being edited, and both of these navigate within the
            // results of a query that is already committed. Mostly a fallback
            // — the prefetch in useCommitPageSize means react-query usually
            // has the new page in hand before this runs.
            refetch()
        }
    }, [page, pageSize])
    const totalPages = pageSize > 0 ? (Math.ceil((nResults || 1) / (pageSize)) || 1) : 1
    const [qIndex, setIndex] = useGalleryIndex()
    const results = data?.results || []
    const [sidebarOpen, setSideBarOpen] = useSideBarOpen()
    // The setter is used once, by the creation-defaults stamp far below —
    // taken from this same hook call rather than a second one, so there is one
    // subscription to `vm` on this component.
    const [viewMode, setViewMode] = useViewMode()
    const scrollMode = viewMode === "scroll"
    // The sparse window over the WHOLE result set that scroll mode reads rows
    // from. Mounted in both modes because hooks are unconditional; `enabled`
    // is what keeps pages mode from issuing a single chunk request (nothing
    // calls `ensureRange` there either, so its query set is empty regardless —
    // the flag is the belt to that braces).
    //
    // `searchEnabled && !pinboardMaximized` rather than useSearch's
    // `queryEnabled`: chunk bodies are built from the COMMITTED query, so
    // there is no uncommitted edit a chunk fetch could leak, while the
    // committed-vs-live half of `queryEnabled` would freeze scrolling on
    // skeletons whenever the user has instant search off or nudges page_size
    // (see useChunkedResults' `enabled` param).
    const pinboardMaximized = usePinboardMaximized()
    const chunkSource = useChunkedResults({
        committedQuery,
        enabled: scrollMode && searchEnabled && !pinboardMaximized,
        // The fallback reads `results[i]` AS global item i, which is only true
        // while the main query is on page 1 — scroll mode's own invariant, but
        // one that a hand-made `vm=scroll&page=3` URL breaks for the tick
        // before the normalization effect below removes the param. Withheld
        // rather than trusted for that tick: page 3's rows painted at the top
        // of the set is a wrong ANSWER, where a skeleton is merely a slow one.
        fallbackResults: page === 1 ? results : [],
        resultsAreStale,
        count: nResults,
    })
    // ONE grid implementation AND one gallery read both modes through this: in
    // pages mode the page's array behind the same interface, so every index
    // either surface computes is page-local exactly as it has always been, and
    // every dep that used to be `results` is now `rowsIdentity` — which IS
    // that array (see arrayResultsSource). Nothing about the pages-mode path
    // changes value.
    const resultsSource = scrollMode ? chunkSource : arrayResultsSource(results)
    const itemCount = resultsSource.count
    // Whether `source.count` is the count query's answer rather than the
    // still-growing loaded extent. Always true in pages mode, where the page's
    // array IS the count. ONE expression for both surfaces: the grid uses it to
    // decide whether a position past the extent is stale or merely not reached
    // yet, and the gallery to decide whether to clamp `gi` against it at all —
    // two surfaces answering that question differently is a wrong item on one
    // of them.
    //
    // A non-zero count is not a SETTLED count: the count query keeps the
    // previous search's answer across a re-key, and clamping a deep anchor
    // against the wrong extent records it as applied and loses it for good
    // (see useSearch's countIsPlaceholder).
    const countSettled = !scrollMode || (nResults > 0 && !countIsPlaceholder)

    const [options, setOptions] = useQueryOptions()
    const dbs = useSelectedDBs()[0]
    const scanLink = useMemo(() => {
        return selectedDBsSerializer("/scan", {
            index_db: dbs.index_db,
            user_data_db: dbs.user_data_db,
        })
    }, [dbs])

    const selectedItem = useItemSelection((state) => state.getSelected())
    // Keeps the gallery index pointing at the selected item. Deliberately keyed
    // on selection changes only: a results transition must not move the index
    // (e.g. a CLIP-similarity click sets the index to the clicked item — snapping
    // back to the old selection's position would override it). Compares by
    // file_id, the same identity itemEquals uses when the gallery writes the
    // selection, so the two effects can never disagree and ping-pong.
    useEffect(() => {
        if (qIndex === null) {
            return
        }
        // `results` is a PAGE of rows while `gi` in scroll mode is a GLOBAL
        // index; the two coincide only because scroll mode's main query is
        // always page 1 — which a hand-made `vm=scroll&page=N` URL breaks for
        // the tick before the normalization effect below drops the param. A
        // findIndex hit in that tick would write a page-local index into a
        // global `gi` and teleport the gallery to the top of the set.
        if (scrollMode && page !== 1) {
            return
        }
        // The same mismatch from the other side: an index deeper than page 1's
        // rows names an item that CANNOT be in them, so any findIndex hit below
        // would be a coincidence of file ids across the set, not a remap.
        if (scrollMode && qIndex !== null && qIndex >= results.length) {
            return
        }
        // Clamped, not wrapped, for the same reason as in the gallery: an
        // index past the end means these results are momentarily the wrong
        // ones, and wrapping would compare the selection against an unrelated
        // item and rewrite the index to match it
        // This effect writes the index from the selection; the gallery writes
        // the selection from the index. Two-way binding, and an effect always
        // runs one step behind the store — so this can be queued for a
        // selection the gallery has already replaced. Acting on that stale
        // value moves the index back to where the *previous* item sits, the
        // gallery answers by pushing the item now under the new index, and
        // the two trade places forever.
        //
        // Nothing used to reach that state because every path here fetched:
        // the results were stale meanwhile, which suppressed the gallery's
        // push. A similarity swap now lands from cache with nothing in
        // flight, so the tie has to be broken explicitly. The newer
        // selection's own run of this effect is already queued behind us and
        // will do the right thing with it.
        if (useItemSelection.getState().selected?.file_id !== selectedItem?.file_id) {
            return
        }
        const index = Math.max(0, Math.min(qIndex || 0, results.length - 1))
        if (selectedItem && results[index] && selectedItem.file_id !== results[index].file_id) {
            const newIndex = results.findIndex((item) => item.file_id === selectedItem.file_id)
            if (newIndex !== -1 && newIndex !== index) {
                setIndex(newIndex)
            }
        }
    }, [selectedItem])
    const [fs, setFs] = useGalleryFullscreen()
    const loading = useSearchLoading((state) => state.loading)
    // Resolve pinboard links (?pbl=…) into a loaded board layout. Lives
    // here rather than in the gallery so a board link opened in a fresh
    // tab (no gallery index) resolves too, onto the grid-hosted board.
    usePinboardURLLoader()
    const showPagination = !fs && (nResults > pageSize) && (pageSize > 0)
    // Survives the grid unmounting while the gallery is open, so the grid can
    // restore its exact scroll position when the gallery closes
    const gridScrollOffsetRef = useRef(0)
    // A pixel offset describes one specific layout of one specific page. Once
    // the page or the page size changes it describes a layout that no longer
    // exists, and it *wins* over the URL anchor on restore — so drop it and
    // let the anchor (which is an item index, and has been remapped) decide.
    // The URL's page size, not useSearch's — that one trails the request
    // throttle, which would leave the offset alive for the window in which
    // closing the gallery could restore it.
    const urlPageSize = usePageSize()
    useEffect(() => {
        gridScrollOffsetRef.current = 0
    }, [page, urlPageSize])

    // ---- scroll mode: the pagination bar as position indicator and scrubber
    //
    // k, the virtual-page size, is `page_size` — the same param, the same
    // user-configured value (design §4). The URL's value, not useSearch's:
    // that one trails the request throttle, and in scroll mode a page-size
    // change is a pure relabel with nothing to fetch, so making the labels
    // wait on a throttle would be a lag with no reason behind it.
    const k = urlPageSize
    const [scrollAnchor, setScrollAnchor] = useGridScrollAnchor()
    // The pagination bar's highlight while the grid has not reported one — and,
    // with the gallery open, for as long as it stays open (see the hook).
    const [derivedPage, setDerivedPage] = useDerivedVirtualPage({
        scrollMode,
        scrollAnchor,
        k,
        galleryOpen: qIndex !== null,
    })

    // The two mount-time URL corrections, mutually exclusive by construction —
    // see `freshSession` in the first of them. One `useSearchParams` read feeds
    // both, so they cannot disagree about the URL the session started on.
    const urlParams = useSearchParams()
    const setPageRaw = useSearchPageRaw()[1]
    useScrollURLNormalization({ urlParams, scrollMode, page, k, setScrollAnchor, setPageRaw })
    const setPageSizeRaw = usePageSizeRaw()[1]
    useSearchCreationStamp({ urlParams, setViewMode, setPageSizeRaw })

    // The scrubber's three props. Virtual page N covers items [(N-1)k, Nk), so
    // a click is a position write and rides the grid's existing external-anchor
    // effect — there is no imperative channel into the grid, which is what
    // makes a click, a Back and a middle-clicked link the same operation.
    // "push" because a jump across the set IS navigation, unlike a scroll stop.
    const scrollTotalPages = k > 0 ? (Math.ceil((nResults || 1) / k) || 1) : 1
    const setVirtualPage = (newPage: number) => {
        const anchor = virtualPageAnchor(newPage, k)
        // `gi` is written in the SAME tick, which is what makes the click and
        // its own middle-clicked link one operation: getScrollPositionURL
        // writes the same value under the same condition. With the gallery
        // OPEN, a scrubber click moves it to the first item of the target
        // virtual page — the pages-mode behaviour, item for item: there a
        // page click lands the open gallery on the new page's first item
        // (useSearchPage's setGi(0)), and the gallery reads the whole set
        // here, so the global index can say the same thing directly. The
        // anchor carries the identical value, the rule the gallery's own
        // navigation already follows ("the anchor follows the position").
        // With the gallery CLOSED the click is a grid navigation and `gi`
        // stays cleared — a leftover global index would reopen the gallery.
        //
        // "replace" on `gi` and "push" on the anchor: nuqs coalesces the
        // batch into one URL update and escalates it to a pushed entry because
        // one member asked for push, so Back undoes the whole jump at once —
        // gallery position included.
        //
        // The saved pixel offset must not survive the jump either way: on the
        // next grid mount a non-zero saved offset WINS over the anchor ("a
        // quick look at one item must not shift the grid") — which here would
        // silently discard the jump in favor of wherever the grid last sat. A
        // scrubber jump is exactly the case that rationale does not cover.
        gridScrollOffsetRef.current = 0
        return Promise.all([
            setScrollAnchor(anchor > 0 ? anchor : null, { history: "push" }),
            setIndex(qIndex !== null ? anchor : null, { history: "replace" }),
        ])
    }
    const getVirtualPageURL = (base: ReadonlyURLSearchParams | URLSearchParams, newPage: number) =>
        getScrollPositionURL(base, newPage, k, qIndex !== null)
    return (
        <>
            <SearchErrorToast noFtsErrors={options.e_iss} isError={isError} error={error} />
            {!fs && <div className={cn("mb-4 2xl:mx-auto",
                sidebarOpen ? '2xl:w-2/3' : '2xl:w-1/2'
            )}>
                <div className="flex gap-2">
                    <Toggle
                        pressed={sidebarOpen}
                        onClick={() => setSideBarOpen(!sidebarOpen)}
                        title={"Advanced Search Options Are " + (sidebarOpen ? "Open" : "Closed")}
                        aria-label="Toggle Advanced Search Options"
                    >
                        <Settings className="h-4 w-4" />
                    </Toggle>
                    {!isRestrictedMode && <Link href={scanLink}>
                        <Button title="File Scan & Indexing" variant="ghost" size="icon">
                            <ScanEye className="h-4 w-4" />
                        </Button>
                    </Link>}
                    {
                        options.tag_mode ? <TagSearchBar onSubmit={onRefresh} /> :
                            options.e_iss ? <ImageSimilarityHeader /> : <SearchBar onSubmit={onRefresh} />
                    }
                    <InstantSearchLock />
                    <Toggle title="Refresh search results" onClick={onRefresh} pressed={false}>
                        <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                    </Toggle>
                </div>
            </div>}
            {
                // The gallery is mounted while there is a position and there
                // are results to resolve it against. `itemCount`, not
                // `results.length`: in pages mode they are the same number
                // (the source wraps the page's array), while in scroll mode
                // the navigable extent is the whole set — and the gallery
                // resolves a global `gi` against it, holding a loading frame
                // for the frame or two a cold chunk takes to arrive.
                (qIndex !== null && itemCount > 0)
                    ?
                    <ImageGallery
                        source={resultsSource}
                        // ONE giant page in scroll mode, permanently — design
                        // delta 6, arriving here early because the gallery is
                        // the one surface that can still WRITE `page`, and a
                        // `page` written into a scroll-mode URL is the two-
                        // live-position-params bug the mode is defined to
                        // avoid. Every page-turn branch (arrow keys at the
                        // edges, the prev/next hrefs) and the whole auto-
                        // advance chain guard on `page < totalPages`, so this
                        // is what makes them inert rather than a second set of
                        // mode checks scattered through the gallery. In scroll
                        // mode there is no page to turn to: the chain's
                        // continuation past the loaded rows is a chunk fetch,
                        // not a page turn.
                        totalPages={scrollMode ? 1 : totalPages}
                        // …which is why the pagination bar's presence has to be
                        // told separately: the gallery sizes its image panel
                        // around it, and the bar below is the SCROLL scrubber,
                        // whose existence has nothing to do with totalPages
                        // being 1. Same expression the gallery would have
                        // computed for itself in pages mode.
                        paginationVisible={scrollMode ? scrollTotalPages > 1 : undefined}
                        setPage={setPage}
                        // Same flag, same expression as the grid's — see
                        // countSettled above.
                        countSettled={countSettled}
                        resultsAreStale={resultsAreStale}
                        // The gallery's auto-advance chain acts on the search
                        // with no user gesture in sight, so it needs to know
                        // when the live query is being withheld — see the prop
                        // (docs/video-end-action-design.md §3).
                        queryEnabled={queryEnabled}
                    />
                    :
                    <GridPanel
                        source={resultsSource}
                        mode={viewMode}
                        pageSize={k}
                        // Stable by construction (a useState setter), which the
                        // grid's scroll-listener effect depends on: a callback
                        // minted per render would re-subscribe that listener
                        // and reset its 350ms scroll-stop timer.
                        onDerivedPageChange={scrollMode ? setDerivedPage : undefined}
                        // See the restore effect for what the grid does with
                        // it: a position past a number that is still growing
                        // must not be mistaken for a position past the end of
                        // the results.
                        countSettled={countSettled}
                        totalCount={nResults}
                        resultMetrics={data?.result_metrics}
                        countMetrics={data?.count_metrics}
                        // Every card in the set is openable in both modes: the
                        // gallery reads the same source the grid does, so an
                        // index it has never fetched is a chunk fetch away,
                        // not an unresolvable URL. (The stale-URL tick a
                        // hand-made `vm=scroll&page=3` produces needs no guard
                        // here either — the chunk store withholds its page-1
                        // fallback for exactly that tick, so the gallery holds
                        // a loading frame instead of showing page 3's rows at
                        // the top of the set.)
                        onImageClick={(index) => {
                            setIndex(index !== undefined ? index : null)
                        }}
                        isLoading={loading}
                        resultsAreStale={resultsAreStale}
                        showPagination={showPagination}
                        savedScrollOffsetRef={gridScrollOffsetRef}
                        updateRibbonVisible={updateRibbonVisible}
                        committedQuery={committedQuery}
                    />
            }
            {
                showPagination && (
                    <PageSelect
                        totalPages={scrollMode ? scrollTotalPages : totalPages}
                        currentPage={scrollMode ? derivedPage : page}
                        setPage={scrollMode ? setVirtualPage : setPage}
                        getPageURL={scrollMode ? getVirtualPageURL : getPageURL}
                    />
                )
            }
        </>
    )
}

// md, lg, xl, 2xl, 4xl, 5xl — the Tailwind breakpoints used by the result grid rows
const GRID_BREAKPOINTS = [
    '(min-width: 768px)',
    '(min-width: 1024px)',
    '(min-width: 1280px)',
    '(min-width: 1536px)',
    '(min-width: 2200px)',
    '(min-width: 3000px)',
]

/**
 * The grid layout currently applied by CSS. columns must mirror the responsive
 * grid-cols-* classes on the result grid rows exactly — the CSS media queries are
 * what actually lay out the columns; this value only slices results into rows.
 * Uses matchMedia (the same engine that applies the classes) rather than reading
 * window.innerWidth in a resize handler, which can observe a stale width.
 * rowEstimate tracks the card height, which is fixed per breakpoint: the image
 * container (h-96 / 4xl:h-120 / 5xl:h-[38rem]) plus text lines, paddings,
 * borders and the row's pb-4. Accurate estimates matter: scrollToIndex navigates
 * by estimated offsets for rows that haven't been measured yet.
 */
function useResultGridLayout(sidebarOpen: boolean): { columns: number, rowEstimate: number } {
    // columns 0 means "not evaluated yet" (SSR and the very first client render) —
    // consumers must not lay out or scroll until this becomes a real count
    const [layout, setLayout] = useState({ columns: 0, rowEstimate: 470 })
    useLayoutEffect(() => {
        const queries = GRID_BREAKPOINTS.map((q) => window.matchMedia(q))
        const update = () => {
            const [md, lg, xl, xxl, xxxxl, xxxxxl] = queries.map((q) => q.matches)
            const columns = sidebarOpen
                ? (xxxxl ? 5 : xxl ? 4 : xl ? 3 : lg ? 1 : md ? 2 : 1)
                : (xxl ? 5 : xl ? 4 : lg ? 3 : md ? 2 : 1)
            const rowEstimate = xxxxxl ? 694 : xxxxl ? 566 : 470
            setLayout((prev) =>
                prev.columns === columns && prev.rowEstimate === rowEstimate
                    ? prev : { columns, rowEstimate })
        }
        update()
        queries.forEach((q) => q.addEventListener('change', update))
        return () => queries.forEach((q) => q.removeEventListener('change', update))
    }, [sidebarOpen])
    return layout
}

// The grid view's panel: the frame the gallery panel is measured against.
// Same outer chrome (border rounded p-2) and the same 48px header band
// (h-10 row + mb-2) as the gallery header, so the fixed-height middle —
// the result grid or the pinboard — computes to identical pixels in both
// hosts and across both tabs. data-pinboard-frame: presses landing on the
// panel's own padding can start a pinboard marquee select, same as the
// gallery frame (see the frame listener in GalleryPinBoard).
export function GridPanel({
    source,
    mode = "pages",
    pageSize,
    onDerivedPageChange,
    countSettled = true,
    totalCount,
    resultMetrics,
    countMetrics,
    onImageClick,
    isLoading,
    resultsAreStale = false,
    showPagination = true,
    savedScrollOffsetRef,
    updateRibbonVisible = false,
    committedQuery,
}: {
    /** The rows, however they are fetched — see ResultsSource. */
    source: ResultsSource,
    mode?: ViewMode,
    /** k, the virtual-page size, for the scroll grid's derived page number. */
    pageSize: number,
    onDerivedPageChange?: (page: number) => void,
    countSettled?: boolean,
    resultMetrics?: components["schemas"]["SearchMetrics"],
    countMetrics?: components["schemas"]["SearchMetrics"],
    totalCount: number,
    onImageClick?: (index?: number) => void,
    isLoading?: boolean,
    resultsAreStale?: boolean,
    showPagination?: boolean,
    savedScrollOffsetRef?: React.MutableRefObject<number>,
    updateRibbonVisible?: boolean,
    /** The search the Library tab runs — see useSearch's committedQuery. */
    committedQuery: Pick<SearchRequestParts, "searchQuery" | "dbs">,
}) {
    const pinboard = useGalleryPinBoardLayout()[0]
    const [pinboardTab, setPinboardTab] = useGridPinboardTab()
    const [libraryTab, setLibraryTab] = useGridLibraryTab()
    const [fs, setFs] = useGalleryFullscreen()
    const dbs = useSelectedDBs()[0]
    const clientConfig = useClientConfig()
    // Always-on (unlike the library dialog's copy, which waits for the dialog
    // to open): the Library tab must appear as soon as a board exists, and
    // every save/rename/delete already invalidates this key. Gated on the
    // read-side pinboard capability so a policy without board access never
    // fires it. This panel remounts whenever the gallery opens and closes, so
    // the answer is held rather than re-fetched per mount (staleTime) and not
    // re-fetched on refocus either — invalidation is what moves it.
    //
    // `associated_only` is sent here for two reasons, and the second is the
    // load-bearing one. It decides whether the tab may appear at all, so the
    // probe has to count the boards the tab will actually show. And the init
    // object IS the query key: this probe and the sidebar's board picker must
    // stay byte-identical or they become two cache entries answering the same
    // question — which is what would let the tab exist while its own contents
    // (and the self-heal effect below, which clears `gpl` on a settled empty
    // answer) disagree about whether there are any boards.
    const [associatedOnly] = usePinboardAssociatedOnly()
    const library = $api.useQuery(
        "get",
        "/api/pinboards",
        { params: { query: { ...dbs, associated_only: associatedOnly } } },
        {
            enabled: clientConfig.data?.pinboardSearchEnabled === true,
            staleTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
        }
    )
    const libraryHasBoards = (library.data?.pinboards?.length ?? 0) > 0
    // The tab choice only matters on a non-empty board (the tabs don't
    // render otherwise). The length guard still matters for a ?pbl link:
    // gpb=true arrives before the loader has resolved the layout, and the
    // results must show until it lands. Unpinning the last item clears
    // gpb itself (see usePinBoard), so the flag can't linger past the
    // board it was opened for.
    // `|| fs` covers a cold load of a URL maximized from the GALLERY host
    // (gi set, gpb absent): the search that host needs to mount is exactly
    // the one being maximized suppresses, so results are empty and the view
    // lands here instead. Without this the board would be replaced by an
    // empty grid — the one thing the URL asked not to show.
    const showPinboard = pinboard.length > 0 && (pinboardTab || fs)
    // Tab precedence: pins > library > results. The open board wins because
    // it is the one view a URL can be maximized into; the library needs a
    // non-empty library for the same reason the board tab needs pins — the
    // flag can arrive (a shared link, a back navigation) before the boards
    // query has answered.
    const showLibrary = !showPinboard && libraryTab && libraryHasBoards
    // A gpl that outlived its library: the last board was deleted, or the URL
    // was carried to a user_data_db that has none. Left set, the flag would
    // silently yank the view back to Library the moment a board reappears.
    //
    // Only on a *settled successful* empty answer — never while the query is
    // loading (a cold load has gpl before the boards land, which is exactly
    // the case the precedence comment above keeps working), never on an error
    // (an unreachable backend is not an empty library), and never when the
    // query is disabled. The write is one-way — it can only take gpl from
    // true to false, and the guard then stops matching — so it cannot cycle.
    // Replace, not push: this is a correction to a state that no longer
    // exists, not somewhere to navigate back to.
    useEffect(() => {
        if (!libraryTab) return
        if (!library.isSuccess || library.isFetching) return
        if (libraryHasBoards) return
        setLibraryTab(false, { history: "replace" })
    }, [libraryTab, library.isSuccess, library.isFetching, libraryHasBoards, setLibraryTab])
    // Maximize hotkey, same chord as the gallery's. Registered only while
    // the board is shown here — the two hosts are never mounted together,
    // so it can't double-fire.
    useEffect(() => {
        if (!showPinboard) return
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey && event.shiftKey && event.code === 'KeyM') {
                event.preventDefault()
                setFs((f) => !f)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [showPinboard])
    return (
        <div data-pinboard-frame className="flex flex-col border rounded p-2">
            {/* 1fr_auto_1fr: the tabs stay centered no matter how wide the
                result count grows. Height pinned to h-10 so the band can't
                grow past the gallery header it must measure like. */}
            {!fs && <div className="grid grid-cols-[1fr_auto_1fr] items-center h-10 mb-2">
                <h2 className="text-xl font-bold px-2 truncate">
                    <SearchMetricsHoverCard resultMetrics={resultMetrics} countMetrics={countMetrics}>
                        <span><AnimatedNumber value={totalCount} /> {totalCount === 1 ? "Result" : "Results"} in {resultMetrics?.execute}s</span>
                    </SearchMetricsHoverCard>
                </h2>
                {(pinboard.length > 0 || libraryHasBoards) && (
                    <Tabs
                        value={showPinboard ? "pins" : showLibrary ? "library" : "results"}
                        onValueChange={(value) => {
                            // One tab is selected, so the other flag stands
                            // down — same tick, so nuqs writes one URL update
                            setPinboardTab(value === "pins")
                            setLibraryTab(value === "library")
                        }}
                    >
                        <TabsList className="flex">
                            {pinboard.length > 0 && <PinboardTabChip active={showPinboard} />}
                            {libraryHasBoards && (
                                <TabsTrigger value="library" className="shrink-0 px-3">
                                    Library
                                </TabsTrigger>
                            )}
                            <TabsTrigger value="results" className="shrink-0 px-3">
                                Results
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                )}
                {/* col-start-3: the tabs cell above is conditional, so
                    without an explicit track this would slide into the
                    center when no board exists */}
                <div className="col-start-3 flex justify-end items-center">
                    {/* Before the library button: the mode switch is about
                        the results this panel is showing, so it sits nearer
                        the middle of the band than the button that opens a
                        dialog over it. Rendered on every tab, like its
                        neighbour — the tabs decide what is on screen now,
                        the toggle decides how the Results tab presents, and
                        having it appear and disappear with the tab would
                        make it the one header control that moves. */}
                    <ViewModeToggle />
                    <PinboardLibraryButton />
                </div>
            </div>}
            {showPinboard ? (
                <PinBoard
                    variant="grid"
                    thumbnailsOpen={false}
                    showPagination={showPagination}
                    updateRibbonVisible={updateRibbonVisible}
                />
            ) : showLibrary ? (
                <PinboardSearchGrid
                    committedQuery={committedQuery}
                    showPagination={showPagination}
                    updateRibbonVisible={updateRibbonVisible}
                />
            ) : (
                <ResultGrid
                    source={source}
                    mode={mode}
                    pageSize={pageSize}
                    onDerivedPageChange={onDerivedPageChange}
                    countSettled={countSettled}
                    onImageClick={onImageClick}
                    isLoading={isLoading}
                    resultsAreStale={resultsAreStale}
                    showPagination={showPagination}
                    savedScrollOffsetRef={savedScrollOffsetRef}
                    updateRibbonVisible={updateRibbonVisible}
                />
            )}
        </div>
    )
}

// The virtualizer's row overscan, and the basis for how far ahead scroll mode
// warms chunks. Shared deliberately: rows are RENDERED ahead of the viewport,
// so the data behind them has to be ASKED FOR further ahead still, and the two
// numbers drifting apart is what would make the overscan rows the ones that
// show skeletons (see overscanItemsFor).
const GRID_OVERSCAN_ROWS = 3

/**
 * Where the gallery's item sits in the source, for the ensure-visible pass on
 * gallery close.
 *
 * Pages mode scans `[0, count)` — the source IS the page's array, so this is
 * the `findIndex` it has always been. Scroll mode cannot scan a result set of
 * unbounded size and must not FETCH to look (an ensure-visible is not worth a
 * request), so its caller passes the loaded neighbourhood of the position
 * being restored, which is where an item the user just closed the gallery on
 * always is. Not found is an ordinary answer and the caller skips: a block
 * that isn't there means "not loaded", never "end of results".
 *
 * BLOCK-WISE, not index-wise, and that is a cost decision. `source.get` per
 * index resolves its chunk from scratch every time, and for a chunk that has
 * been evicted from the observed set that is a request body rebuilt and
 * re-hashed per lookup — several hundred of them for one gallery close, which
 * is a frame the user sees. `getBlock` hands over the run of rows covering an
 * index once and the scan reads them in memory (see ResultsSource.getBlock).
 * The answer is identical either way.
 */
function findSelectedIndex(
    source: ResultsSource,
    selected: { item_id: SearchResult["item_id"] },
    from: number,
    to: number
): number {
    let i = Math.max(from, 0)
    while (i < to) {
        const block = source.getBlock(i)
        if (!block) {
            // Nothing loaded here. Skip to the start of the next chunk rather
            // than probing every index inside this one — a hole is a whole
            // chunk's worth of nothing, never a single missing row.
            const next = (Math.floor(i / SCROLL_CHUNK_SIZE) + 1) * SCROLL_CHUNK_SIZE
            i = next > i ? next : i + 1
            continue
        }
        const end = Math.min(to - block.start, block.rows.length)
        for (let offset = i - block.start; offset < end; offset++) {
            if (block.rows[offset]?.item_id === selected.item_id) {
                return block.start + offset
            }
        }
        // Past this block, whatever its size — but never backwards past the
        // next chunk boundary: an EMPTY block (a past-the-end chunk that
        // answered with no rows) has `start + rows.length <= i`, and stepping
        // one index at a time through it would re-resolve the same empty block
        // 320 times. The `> i` test remains the loop's termination guarantee.
        const next = Math.max(
            block.start + block.rows.length,
            (Math.floor(i / SCROLL_CHUNK_SIZE) + 1) * SCROLL_CHUNK_SIZE
        )
        i = next > i ? next : i + 1
    }
    return -1
}

export function ResultGrid({
    source,
    mode = "pages",
    pageSize,
    onDerivedPageChange,
    countSettled = true,
    onImageClick,
    isLoading,
    resultsAreStale = false,
    showPagination = true,
    savedScrollOffsetRef,
    updateRibbonVisible = false,
}: {
    source: ResultsSource,
    mode?: ViewMode,
    /** k, the virtual-page size, for the derived page number in scroll mode. */
    pageSize: number,
    /**
     * The live position indicator (design §4): called with
     * `floor(topItem / k) + 1` and ONLY when that number changes, so scrolling
     * doesn't re-render the host per frame. Must be referentially stable — it
     * is a dependency of the scroll listener below.
     */
    onDerivedPageChange?: (page: number) => void,
    /**
     * Whether `source.count` is the count query's answer rather than the
     * still-growing loaded extent (ResultsSource.count). The anchor machinery
     * needs the difference: "past the end of the results" and "past what has
     * loaded so far" call for opposite decisions, and on a cold scroll-mode
     * load — SSR-hydrated rows, count still in flight — the second one is the
     * ordinary state, not an edge case. Always true in pages mode, where the
     * page's array IS the count.
     */
    countSettled?: boolean,
    onImageClick?: (index?: number) => void,
    isLoading?: boolean,
    resultsAreStale?: boolean,
    showPagination?: boolean,
    savedScrollOffsetRef?: React.MutableRefObject<number>,
    updateRibbonVisible?: boolean,
}) {
    // TanStack Virtual v3 triggers re-renders by mutating internal state,
    // which the React Compiler's memoization breaks — same as the gallery view.
    "use no memo"
    const [dbsState, __] = useSelectedDBs()
    // Referentially stable while the values are unchanged, so the memoized
    // SearchResultImage cards skip re-rendering on every scroll frame.
    const dbs = useMemo(
        () => dbsState,
        [dbsState.index_db, dbsState.user_data_db]
    )
    const parentRef = useRef<HTMLDivElement>(null)
    const [sidebarOpen] = useSideBarOpen()
    const { columns, rowEstimate } = useResultGridLayout(sidebarOpen)
    const scroll = mode === "scroll"
    // The navigable extent. In pages mode this IS `results.length` (the source
    // wraps the page's array); in scroll mode it is the count query's answer,
    // falling back to the loaded extent while that is in flight so the scroll
    // space grows once instead of thrashing as chunks land (see
    // ResultsSource.count). Rows past the extent simply aren't rendered, which
    // is what keeps the last partial row identical in both modes.
    const itemCount = source.count
    // The rows change signal, per the ResultsSource dependency rule: every dep
    // list below lists THIS, never the source or its methods (both are minted
    // per render). In pages mode it is the results array itself, so those dep
    // lists hold the value they always held.
    const rowsIdentity = source.rowsIdentity
    const rowCount = columns > 0 ? Math.ceil(itemCount / columns) : 0

    // FIXED ROW HEIGHT (scroll mode only, design §6): the breakpoint constants
    // in useResultGridLayout *are* the row height rather than an estimate of
    // it, so scroll mode measures the first row that mounts and uses that one
    // number for every row in the set — no measureElement, no progressive
    // measurement, and therefore a scrollToIndex into never-fetched territory
    // that is exact on the first try. Measured rather than trusted because the
    // constants are the thing CSS drift would silently invalidate. Null until
    // the first row mounts, where the constant stands in.
    const [measuredRowHeight, setMeasuredRowHeight] = useState<number | null>(null)
    const measureFirstRow = useCallback((node: HTMLDivElement | null) => {
        // Also called with null when the ref detaches (the render after the
        // first measurement lands, since the ref is only attached while the
        // height is unknown).
        if (!node) return
        const height = node.getBoundingClientRect().height
        if (height > 0) {
            setMeasuredRowHeight((prev) => (prev === height ? prev : height))
        }
    }, [])
    // A breakpoint change is a different card height, so the measurement it
    // produced no longer describes anything: drop it and measure again rather
    // than scaling rows by a number taken at another size.
    useEffect(() => {
        if (!scroll) return
        setMeasuredRowHeight(null)
    }, [scroll, rowEstimate])

    // KNOWN LIMIT, accepted for this release. Scroll mode gives the spacer div
    // below a real pixel height for the WHOLE result set, and browsers cap how
    // tall an element may be — ~33.5M px in Chrome, less in some engines. At the
    // row heights above (470/566/694px) that ceiling is somewhere around 50–70k
    // ROWS, i.e. a few hundred thousand items at typical column counts. Past it
    // the scroll space saturates: the offsets keep computing correctly but the
    // element stops growing, so the far end of the set is no longer reachable by
    // dragging. The scrubber still is — a virtual-page jump writes `top` and
    // rides scrollToIndex — so the set stays fully navigable; only the scrollbar
    // runs out of room. The fix, if it is ever wanted, is windowed offsets
    // (rebasing the spacer around the visible region), which is a different
    // sizing model and not worth carrying before a user meets the ceiling.
    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => parentRef.current,
        estimateSize: () => (scroll ? measuredRowHeight ?? rowEstimate : rowEstimate),
        overscan: GRID_OVERSCAN_ROWS,
    })

    // Record the scroll position continuously so it survives this component
    // unmounting while the gallery is open
    useEffect(() => {
        const element = parentRef.current
        if (!element || !savedScrollOffsetRef) return
        const onScroll = () => { savedScrollOffsetRef.current = element.scrollTop }
        element.addEventListener('scroll', onScroll, { passive: true })
        return () => element.removeEventListener('scroll', onScroll)
    }, [savedScrollOffsetRef])

    // URL scroll anchor: the first item of the topmost visible row, so the
    // position survives refreshes and can be shared (see useGridScrollAnchor)
    const [scrollAnchor, setScrollAnchor] = useGridScrollAnchor()
    // Distinguishes our own anchor writes (which echo back through nuqs and
    // must be ignored) from external changes — back/forward navigation and
    // query-change resets — which have to move the actual scroll position
    const lastWrittenAnchor = useRef<number | null>(null)

    // The last virtual page reported to the host, so the live position
    // indicator fires on a page CROSSING rather than on a scroll frame.
    const lastDerivedPage = useRef<number | null>(null)

    // Everything the scroll listener's scroll-mode branch needs that is NOT
    // allowed to re-subscribe it. k moves on a page-size commit, the counts on
    // every chunk that lands, and the listener owns a 350ms scroll-stop timer
    // that a re-subscription silently drops: a commit landing inside that
    // window would throw away a pending anchor write. Written after every
    // commit and read only from the listener — never during render.
    const listenerData = useRef({ pageSize, itemCount, rowCount })
    useEffect(() => {
        listenerData.current = { pageSize, itemCount, rowCount }
    })
    // Routing k through that ref means a page-size relabel no longer
    // re-subscribes the listener — so the suppression state has to be cleared
    // here instead. It records a page number under the OLD numbering, and left
    // standing it could swallow the first crossing under the new one while the
    // host is showing something else. (The columns case is covered by the
    // listener's own re-subscription; see its body.)
    //
    // And the relabel is REPORTED from here, which is why this effect is the
    // one that owns it. A page-size change renumbers the position the user is
    // already at and produces no scroll to announce it, so something has to
    // push; the grid is the only place that can push the RIGHT number, because
    // the highlight is derived from the top visible ROW (topRowHighlightItem)
    // and rows exist only inside the virtualizer. The host used to re-derive it
    // from the URL anchor on a k change — `floor(top / k) + 1` over an anchor
    // that speaks for the row's FIRST item — which lands a page low whenever
    // the row straddles a boundary, and stuck there until the next scroll. That
    // trigger now lives here and the host's effect no longer depends on k (see
    // MultiSearchView's derived page); two writers on the same commit would
    // have resolved parent-last, i.e. the wrong value winning.
    //
    // `virtualizer.range` is mutated internal state and legitimately null
    // before the first rows are laid out (a mount, an empty result set): there
    // is nothing to report from then, and `lastDerivedPage` is left cleared so
    // the first real scroll reports under the new numbering.
    useEffect(() => {
        lastDerivedPage.current = null
        if (!scroll || !onDerivedPageChange || columns <= 0) return
        const range = virtualizer.range
        if (range === null) return
        // Same expression as the scroll listener's, deliberately — the two
        // answers describe the same visible rows and may not disagree.
        const lastRowVisible = range.endIndex >= rowCount - 1
        const item = topRowHighlightItem(range.startIndex, columns, itemCount, lastRowVisible)
        const derived = virtualPageOf(item, pageSize)
        lastDerivedPage.current = derived
        onDerivedPageChange(derived)
        // pageSize ONLY: this is the relabel trigger, not a subscription to the
        // range. Every other value it reads moves the position by scrolling,
        // and the listener reports those itself.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageSize])

    // Persist the anchor only once scrolling pauses — never during a scroll,
    // so the URL write can't cost scroll frames (and browsers rate-limit
    // history.replaceState). While the top row is still (partially) visible
    // the param is removed entirely: short result sets and barely-scrolled
    // views keep a clean URL and today's behaviour.
    //
    // In scroll mode this same listener also drives the pagination bar's live
    // highlight — the ONLY live source of it (see MultiSearchView's derived
    // page). Same listener, not a second one: both answers come from the same
    // visible range seen at two different moments (continuously for the
    // indicator, on the 350ms stop for the URL), and reading that range in two
    // places is how they would come to disagree about WHEN.
    //
    // What they deliberately do NOT share is WHICH item they speak for. The
    // anchor is the FIRST item of the top row — a position, and the codec's
    // documented contract (lib/state/gridScroll.ts) — while the highlight is
    // derived from the LAST item of that row, because it answers a different
    // question: which virtual page am I looking at. See topRowHighlightItem
    // for why the two cannot be the same expression. The anchor written here
    // is GLOBAL by construction — the rows are global — so nothing about the
    // write changes.
    useEffect(() => {
        const element = parentRef.current
        if (!element || columns <= 0) return
        // A columns change re-subscribes this, and the same top row then spans
        // a different set of items: a suppressed value from the old geometry
        // would eat the first crossing under the new one. (k is the other way
        // in — it does NOT re-subscribe, and is cleared by its own effect
        // above.)
        lastDerivedPage.current = null
        let timer: ReturnType<typeof setTimeout> | undefined
        const onScrollStop = () => {
            const startRow = virtualizer.range?.startIndex ?? 0
            const anchor = startRow > 0 ? startRow * columns : null
            if (anchor === lastWrittenAnchor.current) return
            lastWrittenAnchor.current = anchor
            setScrollAnchor(anchor)
        }
        const onScroll = () => {
            if (scroll && onDerivedPageChange) {
                const live = listenerData.current
                const range = virtualizer.range
                // At maximum scroll the last row is on screen and the top row
                // can go no further: the final virtual pages are reachable
                // only through this branch (see topRowHighlightItem).
                const lastRowVisible =
                    range !== null && range.endIndex >= live.rowCount - 1
                const item = topRowHighlightItem(
                    range?.startIndex ?? 0,
                    columns,
                    live.itemCount,
                    lastRowVisible
                )
                const derived = virtualPageOf(item, live.pageSize)
                if (derived !== lastDerivedPage.current) {
                    lastDerivedPage.current = derived
                    onDerivedPageChange(derived)
                }
            }
            clearTimeout(timer)
            timer = setTimeout(onScrollStop, 350)
        }
        element.addEventListener('scroll', onScroll, { passive: true })
        return () => {
            clearTimeout(timer)
            element.removeEventListener('scroll', onScroll)
        }
    }, [columns, virtualizer, setScrollAnchor, scroll, onDerivedPageChange])

    // When the column count changes, rows recompose and the same pixel offset lands
    // on entirely different results: re-anchor the scroll to the item that was at the
    // top. Row heights don't depend on the column count, so existing row measurements
    // stay valid — don't reset them, or scrollToIndex would land on estimates instead.
    const prevColumns = useRef(columns)
    const anchorItem = useRef(0)
    useEffect(() => {
        if (prevColumns.current === columns) return
        prevColumns.current = columns
        if (anchorItem.current > 0) {
            virtualizer.scrollToIndex(Math.floor(anchorItem.current / columns), { align: 'start' })
        }
    }, [columns, virtualizer])

    // Track the first visible item while the layout is stable (runs on every commit)
    useEffect(() => {
        if (prevColumns.current === columns && virtualizer.range) {
            anchorItem.current = virtualizer.range.startIndex * columns
        }
    })

    // Fixed rows mean ONE number decides every offset in the set, so a measured
    // height that differs from the breakpoint constant moves every row below
    // the first: re-derive the offsets, then put the item that was at the top
    // back at the top. This is what the pages-mode double-rAF re-assert (below)
    // is for there — but where that one waits out a progressive measurement it
    // cannot observe, this fires exactly once, on the commit that learns the
    // height, which is why the restore path can skip it in scroll mode.
    useEffect(() => {
        if (!scroll) return
        virtualizer.measure()
        if (anchorItem.current > 0 && columns > 0) {
            virtualizer.scrollToIndex(Math.floor(anchorItem.current / columns), { align: 'start' })
        }
    }, [scroll, measuredRowHeight, rowEstimate, columns, virtualizer])

    // When returning from the gallery: restore the exact scroll position from
    // before it opened — a quick look at one item must not shift the grid at all.
    // Then, as an invariant, the item selected in the gallery must be visible:
    // align 'auto' scrolls nothing when it already is, and scrolls the minimal
    // amount (nearest edge) when the gallery selection moved elsewhere or a
    // resize reflowed the grid while it was closed.
    const selected = useItemSelection((state) => state.getSelected())
    const restoredScroll = useRef(false)
    useEffect(() => {
        if (restoredScroll.current || rowCount === 0) return
        // Mounting onto results that aren't ours yet: closing the gallery
        // during a page-size remap lands here with the anchor already remapped
        // and the previous page still rendered. Restoring against it would
        // take the stale-anchor branch below and *delete* the position we just
        // computed. restoredScroll stays false, so this runs again on the
        // results it belongs to.
        if (resultsAreStale) return
        const savedOffset = savedScrollOffsetRef?.current ?? 0
        // Scroll mode before the count lands: `itemCount` is the loaded extent
        // and still growing, so an anchor past it is NOT the stale anchor the
        // branch below deletes — it is a position the scroll space has not
        // reached yet. On a cold load the results query is SSR-hydrated while
        // the count is still in flight, so this is the ordinary state of every
        // deep link, and deciding now would delete the position it arrived
        // with. Decide nothing: `itemCount` is a dependency, so this runs again
        // on the commit that learns the count.
        if (scroll && !countSettled && savedOffset <= 0
            && scrollAnchor !== null && scrollAnchor >= itemCount) {
            return
        }
        restoredScroll.current = true
        // From here on the current URL anchor is accounted for: the external-
        // change effect below must only react to values arriving later
        lastWrittenAnchor.current = scrollAnchor
        if (savedOffset > 0) {
            // Returning from the gallery: the exact pixel restore wins — the
            // URL anchor is just a coarser record of the same position
            virtualizer.scrollToOffset(savedOffset)
        } else if (scrollAnchor !== null && scrollAnchor > 0) {
            if (scrollAnchor < itemCount) {
                const anchorRow = Math.floor(scrollAnchor / columns)
                virtualizer.scrollToIndex(anchorRow, { align: 'start' })
                // Unmeasured rows above the target make the first scroll land on
                // estimated offsets — re-assert once the rows around the target
                // have mounted and been measured
                //
                // Scroll mode has nothing to wait for: every row is the same
                // measured height, so the first scroll already lands on real
                // offsets, and a height correction (if the constant was wrong)
                // arrives as one event the measure effect above re-asserts
                // against. Re-asserting on a frame timer here would instead
                // race the user's own first scroll.
                if (!scroll) {
                    requestAnimationFrame(() => requestAnimationFrame(() => {
                        virtualizer.scrollToIndex(anchorRow, { align: 'start' })
                    }))
                }
            } else {
                // Stale anchor (e.g. a shared link into a result set that no
                // longer reaches that far) — drop it rather than landing
                // somewhere arbitrary
                lastWrittenAnchor.current = null
                setScrollAnchor(null)
            }
        }
        if (!selected) return
        // Pages mode scans the page, as it always has. Scroll mode scans only
        // the loaded neighbourhood of the position being restored — the whole
        // set is not scannable and this must not fetch — and skips when the
        // item isn't there; see findSelectedIndex.
        const anchorItemIndex = Math.max(scrollAnchor ?? 0, 0)
        const index = scroll
            ? findSelectedIndex(
                source,
                selected,
                Math.max(anchorItemIndex - SCROLL_CHUNK_SIZE, 0),
                Math.min(anchorItemIndex + SCROLL_CHUNK_SIZE, itemCount)
            )
            : findSelectedIndex(source, selected, 0, itemCount)
        if (index < 0) return
        const row = Math.floor(index / columns)
        // The visibility decision must use real DOM geometry: the virtualizer's own
        // align 'auto' reads its cached viewport rect, which is still zero-sized
        // right after mount (its ResizeObserver hasn't delivered yet) and turns
        // "ensure visible" into a bogus scroll. Row offsets are measurement-based
        // and safe to take from the virtualizer.
        const ensureVisible = () => {
            const element = parentRef.current
            if (!element) return
            const offsetForRow = virtualizer.getOffsetForIndex(row, 'start')
            if (!offsetForRow) return
            const rowStart = offsetForRow[0]
            const rowEnd = rowStart + (virtualizer.measurementsCache[row]?.size ?? rowEstimate)
            if (rowStart < element.scrollTop) {
                element.scrollTop = rowStart
            } else if (rowEnd > element.scrollTop + element.clientHeight) {
                element.scrollTop = rowEnd - element.clientHeight
            }
        }
        // Wait a frame so the restored offset has been applied, then once more
        // after the target rows have mounted and been measured
        requestAnimationFrame(() => {
            ensureVisible()
            requestAnimationFrame(ensureVisible)
        })
        // `source` is deliberately absent from the deps (it is minted per
        // render): `rowsIdentity` is the rows change signal, and it moves
        // whenever anything this body reads through `source` could have — so
        // the closure captured here is never stale on a run that matters.
    }, [rowCount, columns, rowsIdentity, itemCount, selected, virtualizer, savedScrollOffsetRef, rowEstimate, scrollAnchor, setScrollAnchor, resultsAreStale, scroll, countSettled])

    // Anchor values we didn't write ourselves arrive from history navigation
    // (back/forward restoring the entry's anchor) or from a query change
    // clearing it: move the grid to match. Our own scroll-stop writes echo
    // back as scrollAnchor === lastWrittenAnchor and are ignored, so plain
    // scrolling never re-enters here.
    // An anchor is only *applied* — and only then recorded as written — once it
    // has been applied against results it actually belongs to. A page-size
    // change can put an anchor beyond the end of the previous page, which
    // keepPreviousData is still rendering: clamping it to that shorter list
    // and marking it done would scroll to the wrong row and leave the correct
    // results unable to move the grid, since the effect would never re-fire.
    useEffect(() => {
        if (!restoredScroll.current) return
        if (scrollAnchor === lastWrittenAnchor.current) return
        if (columns <= 0 || rowCount === 0) return
        if (resultsAreStale) return
        // The same discipline for the same reason one step further out: while
        // the count is in flight the extent is not the end of the results, so
        // clamping a back/forward anchor into the loaded window — and recording
        // it as applied — would strand the user short of where the history
        // entry says they were, with no later commit able to correct it.
        if (scroll && !countSettled && scrollAnchor !== null && scrollAnchor >= itemCount) return
        lastWrittenAnchor.current = scrollAnchor
        if (scrollAnchor === null || scrollAnchor <= 0) {
            virtualizer.scrollToOffset(0)
        } else {
            const clamped = Math.min(scrollAnchor, itemCount - 1)
            virtualizer.scrollToIndex(Math.floor(clamped / columns), { align: 'start' })
        }
    }, [scrollAnchor, columns, rowCount, itemCount, virtualizer, resultsAreStale, scroll, countSettled])

    // Fetch driving (scroll mode): warm the chunks behind the visible range
    // plus a margin, on every commit. No dependency array on purpose — the
    // same reasoning as the anchor tracker above: the virtualizer signals a
    // moved range by re-rendering, and its `range` is mutated internal state
    // that no dep list can name. `ensureRange` is cheap to call at that rate by
    // contract: an unchanged chunk set returns the previous state, so this
    // does not re-render the tree once a frame.
    //
    // On top of that, and until the restore has actually run, scroll mode also
    // warms around the URL ANCHOR. Not a fallback for a missing range — the
    // range exists from the first commit with rows in it, while the restore
    // waits for a settled count, which is strictly later — so a fallback would
    // never fire and the landing chunk would only be asked for once the
    // restore scroll had already happened: one full round trip of skeletons at
    // the destination of every deep link. Repeated on every commit until the
    // restore fires, which is what covers the anchor arriving late (a
    // back/forward entry) as well as the cold load.
    useEffect(() => {
        if (!scroll || columns <= 0) return
        // Stale rows mean the position has not been reset onto the new query
        // yet, so both the range and the anchor still describe the OLD one —
        // warming from them would spend one or two chunk requests at a
        // position under a search nobody is at. No dep array, so the commit
        // that clears the flag re-runs this and warming resumes at the reset
        // position.
        if (resultsAreStale) return
        const range = virtualizer.range
        const firstItem = range ? range.startIndex * columns : Math.max(scrollAnchor ?? 0, 0)
        const lastItem = range ? range.endIndex * columns + columns - 1 : firstItem
        const margin = overscanItemsFor(columns, GRID_OVERSCAN_ROWS)
        source.ensureRange(firstItem - margin, lastItem + margin)
        if (!restoredScroll.current) {
            const anchor = Math.max(scrollAnchor ?? 0, 0)
            source.ensureRange(anchor - margin, anchor + margin)
        }
    })

    return (
        <ScrollAreaPrimitive.Root className="relative overflow-hidden">
            <ScrollAreaPrimitive.Viewport
                ref={parentRef}
                // [&>div]:block! overrides the `display: table` on the content wrapper
                // Radix injects — table layout also sizes to content, which breaks the
                // width measurement the column count is derived from.
                // FIXED height, not max-h: the panel must keep its full size even
                // with few results, so the pagination below stays anchored to the
                // bottom and the viewport is pixel-identical to the pinboard tab
                // (and to the gallery pinboard with thumbnails off, which uses the
                // same 213/151 constants; the ribbon variants add its 48px).
                //
                // pr-4 pairs with the widened scrollbar below (design §10): the
                // thumb sits over the rightmost 16px of the Root, so without
                // this the cards' right edge runs underneath it. The padding
                // belongs on the VIEWPORT and not on the row container below —
                // rows are absolutely positioned, and an abs-positioned child
                // resolves `w-full` against its containing block's PADDING box,
                // so padding there would inset nothing. Nothing derives from the
                // narrowed content width either: the column count comes from
                // window-level media queries (useResultGridLayout), not from a
                // container measurement, and the row height — the one number
                // scroll mode's whole offset space is built on — is fixed per
                // breakpoint and untouched by horizontal padding.
                className={cn('w-full rounded-[inherit] [&>div]:block! pr-4',
                    showPagination
                        ? (updateRibbonVisible ? 'h-[calc(100vh-261px)]' : 'h-[calc(100vh-213px)]')
                        : (updateRibbonVisible ? 'h-[calc(100vh-199px)]' : 'h-[calc(100vh-151px)]')
                )}
            >
                <div
                    className="relative w-full"
                    style={{ height: `${virtualizer.getTotalSize()}px` }}
                >
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                        const startIndex = virtualRow.index * columns
                        return (
                            <div
                                key={virtualRow.key}
                                data-index={virtualRow.index}
                                // Pages mode measures every row as it mounts.
                                // Scroll mode attaches its one-shot measurement
                                // instead, and only until it has an answer —
                                // after that no row carries a ref at all, so
                                // scrolling costs no layout reads.
                                ref={scroll
                                    ? (measuredRowHeight === null ? measureFirstRow : undefined)
                                    : virtualizer.measureElement}
                                className="absolute top-0 left-0 w-full"
                                style={{ transform: `translateY(${virtualRow.start}px)` }}
                            >
                                <div
                                    // These responsive classes must stay in sync with useGridColumns
                                    className={cn('grid gap-4 pb-4 grid-cols-1 md:grid-cols-2',
                                        sidebarOpen ?
                                            ('lg:grid-cols-1 xl:grid-cols-3 2xl:grid-cols-4 4xl:grid-cols-5') :
                                            ('lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5')
                                    )}
                                >
                                    {/* Cells are addressed by global index and
                                        capped at the item count, so the last
                                        row is short in exactly the way slicing
                                        the page's array used to make it. An
                                        index below the count with no row yet is
                                        the scroll-mode "chunk in flight" case
                                        and renders a skeleton; in pages mode
                                        the source always has the row, so that
                                        branch is unreachable there.

                                        KNOWN LIMIT, accepted: a chunk that has
                                        given up (ResultsSource.errorAt) also
                                        renders as skeletons here, with no retry
                                        affordance — the gallery has one because
                                        it is showing a single item the user
                                        asked for, while a grid row is one of
                                        many and a per-cell retry button would
                                        be a wall of them. Recovery in the grid
                                        is a window focus or reconnect refetch,
                                        or scrolling far enough away for the
                                        chunk to leave the observed set
                                        (MAX_WANTED_CHUNKS) and coming back, so
                                        a fresh observer re-arms the query. */}
                                    {Array.from({ length: columns }, (_, indexInRow) => {
                                        const index = startIndex + indexInRow
                                        if (index >= itemCount) return null
                                        const result = source.get(index)
                                        if (!result) {
                                            return <ResultCellSkeleton key={`pending-${index}`} />
                                        }
                                        return (
                                            <SearchResultImage
                                                key={result.file_id}
                                                result={result}
                                                index={index}
                                                dbs={dbs}
                                                onImageClick={onImageClick}
                                                // Every card in the set opens
                                                // the gallery, in both modes:
                                                // `gi` is a global index and
                                                // the gallery resolves it
                                                // against this same source.
                                                galleryLink
                                                nItems={itemCount}
                                                showLoadingSpinner={isLoading}
                                            />
                                        )
                                    })}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </ScrollAreaPrimitive.Viewport>
            {/* Wider and higher-contrast than the shared default, at THIS call
                site only (design §10): the results grid is the one surface in
                the app that is dragged across tens of thousands of rows, where
                a 10px `bg-border` thumb — a token that is nearly the background
                in the light theme — is both hard to see and hard to grab. The
                component itself has ~15 other consumers and stays untouched;
                everything here goes through `className`, which twMerge resolves
                against the defaults (w-4 replaces w-2.5, the `p-px` inset and
                the thumb's `rounded-full` survive, so the thumb is 13px inside
                a 16px grab track). The thumb is the scrollbar's only child, so
                `[&>div]` addresses it; the hover selector is written as
                `[&:hover>div]` rather than a stacked `hover:` variant so the
                generated rule is unambiguous — hovering anywhere on the track
                darkens the thumb. Theme tokens, not literals: muted-foreground
                is defined for both themes (app/globals.css). */}
            <ScrollBar
                orientation="vertical"
                className="w-4 [&>div]:bg-muted-foreground/60 [&>div]:transition-colors [&:hover>div]:bg-muted-foreground/90"
            />
            <ScrollAreaPrimitive.Corner />
        </ScrollAreaPrimitive.Root>
    )
}
