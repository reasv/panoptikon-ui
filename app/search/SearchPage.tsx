"use client"
import { PageSelect } from "@/components/pageselect"
import { useInstantSearch, useSearchLoading } from "@/lib/state/zust"
import { AnimatedNumber } from "@/components/ui/animatedNumber"
import { useToast } from "@/components/ui/use-toast"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { SearchQueryArgs } from "./queryFns"
import { SearchErrorToast } from "@/components/searchErrorToaster"
import { cn } from "@/lib/utils"
import { SideBar } from "@/components/sidebar/SideBar"
import { useGalleryFullscreen, useGalleryHidePinBoard, useGalleryIndex, useGalleryPinBoardLayout, useGridLibraryTab, useGridPinboardTab, usePinboardMaximized, useSearchOverlayOpen, useSearchSuppressed, useViewMode } from "@/lib/state/gallery"
import type { ViewMode } from "@/lib/state/gallery"
import { useSearchOverlayReveal } from "@/lib/state/searchOverlayReveal"
import { useSideBarOpen } from "@/lib/state/sideBar"
import { selectedDBsSerializer, useSelectedDBs } from "@/lib/state/database"
import { arrayResultsSource, useChunkedResults, useSearch, type ResultsSource } from "@/lib/searchHooks"
import type { SearchRequestParts } from "@/lib/searchRequest"
import { ImageGallery, PinboardTabChip } from '@/components/gallery/ImageGallery'
import { PinBoard } from '@/components/gallery/GalleryPinBoard'
import { PinboardLibraryButton } from '@/components/gallery/PinboardLibrary'
import { PinboardSearchGrid } from '@/components/gallery/PinboardSearchGrid'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePinboardURLLoader } from '@/lib/pinboardLinks'
import { usePinboardAssociatedOnly } from '@/lib/state/pinboardLibraryPrefs'
import { mintSeed, useOrderBy, usePageSize, usePageSizeRaw, useQueryOptions, useRandomSeed, useSearchPageRaw, useStampRandomSeed } from "@/lib/state/searchQuery/clientHooks"
import { ResultGrid } from "./ResultGrid"
import { SearchBarRow } from "./SearchBarRow"
import { SearchOverlay } from "./SearchOverlay"
import { SidebarOverlay } from "./SidebarOverlay"
import { creationStamp, effectiveCreationDefaults, isFreshSession } from "@/lib/searchDefaults"
import { ViewModeToggle } from "@/components/ViewModeToggle"
import { getScrollPositionURL } from "@/lib/state/searchQuery/serializers"
import { virtualPageAnchor, virtualPageOf } from "@/lib/scrollMode"
import { useSearchParams, type ReadonlyURLSearchParams } from "next/navigation"
import { useItemSelection } from "@/lib/state/itemSelection"
import { CellActionsHost } from "@/components/CellActionsHost"
import { components } from "@/lib/panoptikon"
import { GRID_SCROLL_ANCHOR_KEY, useGridScrollAnchor } from "@/lib/state/gridScroll"
import { createDerivedPageStore } from "@/lib/state/derivedPage"
import { createGridMetricsStore } from "@/lib/state/gridMetricsBox"
import { useGridCellSize } from "@/lib/state/cellSize"
import { GridCellSizeControl } from "@/components/GridCellSizeControl"
import { DesktopUpdateRibbon } from "@/components/DesktopUpdateRibbon"
import { FindNavigator } from "@/components/gallery/FindButton"
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
        // The one owner of every URL/store subscription the per-row
        // components (grid cards, pins, filmstrip cards and their overlay
        // buttons) used to hold themselves — see
        // components/CellActionsHost.tsx. It wraps the whole page rather than
        // just the results panel because the sidebar mounts rows too
        // (SimilarItemsView, the similarity target card).
        <CellActionsHost pinboardMaximized={pinboardMaximized}>
        <div className="flex h-screen w-full flex-col">
            {/* The one owner of find-in-folder's URL-state hooks; every
                FindButton (per cell, per pin, per strip item) calls through
                its registered handle instead of owning the hooks itself */}
            <FindNavigator />
            <DesktopUpdateRibbon onVisibilityChange={setUpdateRibbonVisible} />
            <div className="flex min-h-0 flex-1">
                {!pinboardMaximized && <SideBar />}
                {/* No transition on the toggle: an animated width re-lays
                    out and re-rasters the whole results subtree every frame
                    (a board in the grid host re-runs RGL per frame on top),
                    and any staged transition (overlay entrance, deferred
                    content mount, settle latch) splits the toggle into two
                    visible layout shifts. The panel and the column change
                    together, in one commit, as one reflow — see SideBar for
                    the mount latch that keeps reopen to a CSS visibility
                    flip. */}
                <div className={cn('p-4 mx-auto',
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
        </CellActionsHost>
    )
}

// ---- The three mount/URL hooks MultiSearchView used to own inline.
//
// Extracted for ONE mechanical reason: each of them suppresses
// `react-hooks/exhaustive-deps`, and that suppression makes the React Compiler
// skip the whole enclosing function — per function, not per effect. Inline,
// the three of them cost MultiSearchView (the search page's largest component)
// its memoization entirely. As their own hooks the skip lands on a hook that
// does nothing but the suppressed effect, and MultiSearchView compiles again.
// Each takes exactly the values its body reads; nothing else moved.
//
// Two of them are effect-only (useScrollURLNormalization,
// useSearchCreationStamp). The first, useDerivedVirtualPage, also owns the
// derived-page box it seeds and hands back — the effect is the suppressed
// part, the box is what makes the hook worth calling.

/**
 * The highlighted virtual page: the subscribable box the number lives in (see
 * lib/state/derivedPage.ts for why it is not `useState`), plus the effect that
 * seeds it from the URL anchor.
 *
 * NOTHING HERE RE-RENDERS ON A CROSSING. The box is created once per mount and
 * its `set` is what the grid, the gallery and the maximized strip are handed;
 * the only subscriber is the pagination bar (components/pageselect.tsx). A
 * crossing therefore re-renders the bar and nothing else — where the same
 * crossing used to re-render this component, GridPanel and the whole grid,
 * every `page_size` items scrolled.
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
function useDerivedVirtualPage({ scrollMode, scrollAnchor, k, anchorIsPosition }: {
    scrollMode: boolean,
    scrollAnchor: number | null,
    k: number,
    /**
     * NO grid is mounted to report scrolls, and the URL anchor IS the
     * position — so the anchor write is the authoritative highlight trigger.
     *
     * Two states satisfy it, and neither is "the gallery is open" as such:
     * the gallery open (`gi !== null`, which unmounts the grid), and the
     * maximized board (the P0 frozen host unmounts it too; the overlay
     * strip's programmatic keep-in-view scrolls stand down rather than
     * report — see VirtualizedHorizontalScroll's programmaticScrollRef — so
     * nothing competes with the anchor).
     */
    anchorIsPosition: boolean,
}) {
    // Seeded on the FIRST render, from that render's anchor — the same moment
    // the `useState` initializer this replaces took its value. That is what
    // makes a deep link (and the server render of one) paint the page number
    // it arrived with instead of flashing page 1 until an effect runs.
    const [store] = useState(() =>
        createDerivedPageStore(virtualPageOf(scrollAnchor ?? 0, k)))
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
    // UNDER `anchorIsPosition` that reasoning inverts and the anchor becomes
    // the only trigger there is: no grid means neither the scroll-stop rewrite
    // the exclusion protects against nor a number of its own, while the
    // gallery's manual navigation (arrows, filmstrip, the advance chain) writes
    // the anchor on every step. That anchor IS the position, item for item, so
    // `virtualPageOf` on it is exact rather than row-quantized — which is what
    // lets the scrubber track a binge across the whole set.
    //
    // Neither TRANSITION of the flag re-derives, and both exclusions are
    // load-bearing. Turning ON is the pullback case above one commit later: the
    // anchor standing in the URL is the grid's own scroll-stop write, and
    // adopting it would flip the bar back a page the moment the user opens an
    // item. Turning OFF needs no run either — the live tracking above has
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
    // The dep array is therefore three named triggers, not four raw values —
    // the derived two are hoisted so it reads as what it means.
    const wasAnchorPosition = useRef(anchorIsPosition)
    /**
     * The anchor BECOMING NULL, which is a trigger: the restore effect clears
     * a stale anchor without scrolling anything (there is nowhere to scroll
     * to), so no event would ever walk the bar back off the dead page that
     * anchor put it on. Only the null transition — a non-null self-write is
     * the scroll-stop pullback excluded above, which is why this is the
     * boolean and not the value.
     */
    const anchorCleared = scrollAnchor === null
    /**
     * The anchor's VALUE, but only while it IS the position. Under a mounted
     * grid it is a constant null, which is what keeps the grid's own
     * scroll-stop writes out of the dep array entirely.
     */
    const trackedAnchor = anchorIsPosition ? scrollAnchor : null
    useEffect(() => {
        const previously = wasAnchorPosition.current
        wasAnchorPosition.current = anchorIsPosition
        if (!scrollMode) return
        if (anchorIsPosition !== previously) return
        // A write of the number already held notifies nobody, exactly as the
        // `setDerivedPage` this replaces bailed out on an unchanged value.
        store.set(virtualPageOf(scrollAnchor ?? 0, k))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scrollMode, anchorCleared, anchorIsPosition, trackedAnchor])
    return store
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
function useSearchCreationStamp({ urlParams, setViewMode, setPageSizeRaw, setCellSize }: {
    urlParams: ReadonlyURLSearchParams,
    setViewMode: ReturnType<typeof useViewMode>[1],
    setPageSizeRaw: ReturnType<typeof usePageSizeRaw>[1],
    setCellSize: ReturnType<typeof useGridCellSize>[1],
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
        // Never `null` here — creationStamp only carries keys that DIFFER from
        // the codec default, and `cs`'s codec default is null (auto). So this
        // stamps a width or nothing at all.
        if (stamp.cs != null) setCellSize(stamp.cs, replace)
        // Mount-only, exactly like the normalization effect above: the
        // decision is taken from the snapshot, and the setters churn identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
}

export function MultiSearchView({ initialQuery, isRestrictedMode, updateRibbonVisible = false }:
    { initialQuery: SearchQueryArgs, isRestrictedMode: boolean, updateRibbonVisible?: boolean }) {
    const { data, error, isError, refetch, isFetching, resultsAreStale, nResults, countIsPlaceholder, page, pageSize, setPage, searchEnabled, getPageURL, committedQuery, committedKey, queryEnabled } = useSearch({ initialQuery })
    const { toast } = useToast()
    // Random ordering is now a stable shuffle pinned by a seed, so refetching
    // deliberately returns the *same* results — that stability is the point.
    // Refresh therefore means "reshuffle" here: mint a new seed and let the
    // changed query drive the request (an explicit refetch would be
    // redundant). history "push" so Back returns to the previous shuffle,
    // which is now a working operation rather than a fresh random draw.
    const orderedRandomly = useOrderBy().order_by === "random"
    const setSeed = useRandomSeed()[1]
    const runRefresh = async () => {
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
    // …and it is handed down with a FIXED identity. The closure above is
    // rebuilt on every render of this component (it reads the seed setter, the
    // toast and react-query's refetch), and this component re-renders on every
    // scroll stop — it owns the URL scroll anchor. Passed straight through,
    // that churning identity re-rendered the whole search-bar row, and
    // everything mounted in it, once per stop for a callback nobody had
    // invoked. Same reasoning as the grid cards' click handler (see
    // ResultGrid's imageClickRef), with one difference: the ref is filled from
    // an EFFECT rather than during render, because a render-phase ref write
    // opts this whole component out of the React Compiler — the very trade the
    // three extracted mount hooks above exist to avoid.
    const refreshRef = useRef(runRefresh)
    useEffect(() => { refreshRef.current = runRefresh })
    const onRefresh = useCallback(() => { void refreshRef.current() }, [])
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
    const [sidebarOpen] = useSideBarOpen()
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
    // `searchEnabled && !searchSuppressed` rather than useSearch's
    // `queryEnabled`: chunk bodies are built from the COMMITTED query, so
    // there is no uncommitted edit a chunk fetch could leak, while the
    // committed-vs-live half of `queryEnabled` would freeze scrolling on
    // skeletons whenever the user has instant search off or nudges page_size
    // (see useChunkedResults' `enabled` param). The suppression predicate,
    // not `pinboardMaximized`: an open search overlay over the maximized
    // board is a consumer of these rows
    // (docs/maximized-pinboard-search-overlay-design.md §4).
    const pinboardMaximized = usePinboardMaximized()
    const searchSuppressed = useSearchSuppressed()
    const chunkSource = useChunkedResults({
        committedQuery,
        // The hash useSearch already computed for the same request — the
        // store's throttle takes it instead of serializing the search again
        // per render (see the prop).
        committedKey,
        enabled: scrollMode && searchEnabled && !searchSuppressed,
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

    // The gallery-vs-grid host choice, latched while the board is maximized:
    // the maximized search overlay writes `gi` (selection IS `gi`) and results
    // churn `itemCount`, and a live choice here would swap hosts and remount
    // the board mid-maximize — RGL mounts are expensive on large boards, and
    // maximize must stay the cheap in-instance transition it is today
    // (docs/maximized-pinboard-search-overlay-design.md §3). Only the render
    // branch below freezes: every other reader of `qIndex`/`itemCount` (the
    // gallery's own clamp, useDerivedVirtualPage's `anchorIsPosition` —
    // position semantics, not mount semantics) keeps tracking the live values. Not
    // maximized, the ternary reads the live value directly, so a restore
    // shows the right host in the same render with no wrong-host frame; the
    // effect only re-syncs the latch afterwards. State+effect rather than a
    // render-time ref write, which the React Compiler cannot accept.
    const liveGalleryHost = qIndex !== null && itemCount > 0
    const [frozenGalleryHost, setFrozenGalleryHost] = useState(liveGalleryHost)
    useEffect(() => {
        if (!pinboardMaximized) setFrozenGalleryHost(liveGalleryHost)
    }, [pinboardMaximized, liveGalleryHost])
    const galleryHost = pinboardMaximized ? frozenGalleryHost : liveGalleryHost

    // Is GalleryImageLarge on screen right now? Exactly ImageGallery's own
    // `showsLargeImage` test, evaluated against the host that is actually
    // mounted — which is what the maximized viewer needs and what
    // isPinboardMaximized cannot say, since it ORs the two hosts' board tabs
    // (`ghp`, `gpb`) without knowing which host is live. Maximizing from the
    // gallery's image tab with a stale `gpb=true` therefore reports a
    // maximized board while the large image is what is shown; the viewer
    // stands down there rather than becoming a second mount of the same
    // component (docs/maximized-pinboard-search-overlay-design.md §8.3, "No
    // double mount").
    const pinboardLayout = useGalleryPinBoardLayout()[0]
    const hidePinBoard = useGalleryHidePinBoard()[0]
    const largeImageHosted =
        galleryHost && (pinboardLayout.length === 0 || hidePinBoard)

    // The maximized board's search dock chord: Ctrl+Shift+F is a clean
    // SHOW/HIDE toggle over the dock's whole show state, not over one of
    // its two halves. Shown (open or pinned) → close it fully: unpin AND
    // clear the open flag, because clearing only one of the two would leave
    // the panel up and the chord would read as broken. Hidden → open AND
    // pin, since a chord is a deliberate "keep this here" gesture (the
    // handles are the transient way in), and the raised open flag is what
    // keeps the panel up if the pin toggle is later pressed.
    //
    // The chord follows the grid host's Ctrl+Shift+M effect: registered
    // only while it can mean anything (the dock exists only over a
    // maximized board). `open` is read through getState() rather than
    // subscribed — the handler wants the value at press time and re-binding
    // this listener on every open/close would be noise.
    const [overlayPinned, setOverlayPinned] = useSearchOverlayOpen()
    const setOverlayOpen = useSearchOverlayReveal((s) => s.setRevealed)
    useEffect(() => {
        if (!pinboardMaximized) return
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey && event.shiftKey && event.code === 'KeyF') {
                event.preventDefault()
                const shown =
                    overlayPinned || useSearchOverlayReveal.getState().revealed
                setOverlayOpen(!shown)
                // GUARDED, because `gso` is history:"push" with
                // clearOnDefault and nuqs 2.9.0's app-router adapter calls
                // pushState UNCONDITIONALLY — it has no same-value
                // short-circuit. Opening with a HANDLE leaves `gso` absent,
                // so closing with the chord wanted to write false over an
                // already-false flag: an identical URL pushed onto the
                // stack, and Back appearing dead for one press per
                // handle-open/chord-close round. Exactly the defect
                // documented for `gsv` on the strip's preview button
                // (SearchOverlay), and every other close path already
                // guards. The ephemeral open flag above needs no guard —
                // it is client state and writes no history.
                if (overlayPinned !== !shown) void setOverlayPinned(!shown)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [pinboardMaximized, overlayPinned, setOverlayPinned, setOverlayOpen])

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
    // under `anchorIsPosition`, for as long as that holds (see the hook).
    // `|| pinboardMaximized` is why the flag is not called `galleryOpen`: the
    // maximized board satisfies it by construction (frozen host, grid
    // unmounted) whatever `gi` is, and that is what makes an overlay scrubber
    // click with nothing selected (`gi` null, anchor-only write) move the
    // highlight at all.
    //
    // A BOX, not a state value: the number moves every k items scrolled, and
    // the only thing that needs to see it move is the pagination bar itself
    // (lib/state/derivedPage.ts). `derivedPage.set` is stable for the life of
    // the mount — the contract the grid's and the strip's scroll listeners
    // depend on, previously satisfied by a `useState` setter — and
    // `derivedPage` itself is what the bar subscribes to.
    const derivedPage = useDerivedVirtualPage({
        scrollMode,
        scrollAnchor,
        k,
        anchorIsPosition: qIndex !== null || pinboardMaximized,
    })

    // The two mount-time URL corrections, mutually exclusive by construction —
    // see `freshSession` in the first of them. One `useSearchParams` read feeds
    // both, so they cannot disagree about the URL the session started on.
    const urlParams = useSearchParams()
    const setPageRaw = useSearchPageRaw()[1]
    useScrollURLNormalization({ urlParams, scrollMode, page, k, setScrollAnchor, setPageRaw })
    const setPageSizeRaw = usePageSizeRaw()[1]
    const setCellSize = useGridCellSize()[1]
    useSearchCreationStamp({ urlParams, setViewMode, setPageSizeRaw, setCellSize })

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
    // The maximize answer is needed PER RESULT ROW — every grid card's Data
    // View button and every pin's corner checkbox route to a different details
    // pane depending on it (components/OpenFileDetails.tsx) — and deriving it
    // per row would mean every one of them subscribing to `pinboard`, the
    // longest URL parameter the app has. SearchPageContent computes it once
    // and hands it to CellActionsHost, which publishes the routed verbs
    // themselves; nothing below needs to pass it down.
    return (
        <>
            <SearchErrorToast noFtsErrors={options.e_iss} isError={isError} error={error} />
            {!fs && <div className={cn("mb-4 2xl:mx-auto",
                sidebarOpen ? '2xl:w-2/3' : '2xl:w-1/2'
            )}>
                <SearchBarRow
                    variant="page"
                    onRefresh={onRefresh}
                    isFetching={isFetching}
                    isRestrictedMode={isRestrictedMode}
                    scanLink={scanLink}
                />
            </div>}
            {
                // The gallery is mounted while there is a position and there
                // are results to resolve it against. `itemCount`, not
                // `results.length`: in pages mode they are the same number
                // (the source wraps the page's array), while in scroll mode
                // the navigable extent is the whole set — and the gallery
                // resolves a global `gi` against it, holding a loading frame
                // for the frame or two a cold chunk takes to arrive. Latched
                // while the board is maximized — see galleryHost above.
                galleryHost
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
                        // Stable by construction (a box member, minted once
                        // per mount) — the strip's scroll listener depends on
                        // it, same contract as the grid's. Scroll mode only:
                        // what it reports is a virtual-page number.
                        onDerivedPageChange={scrollMode ? derivedPage.set : undefined}
                    />
                    :
                    <GridPanel
                        source={resultsSource}
                        mode={viewMode}
                        pageSize={k}
                        // Stable by construction (a box member, minted once per
                        // mount), which the grid's scroll-listener effect
                        // depends on: a callback minted per render would
                        // re-subscribe that listener and reset its 350ms
                        // scroll-stop timer. Writing it re-renders the
                        // pagination bar alone — never this component, never
                        // this panel, never the grid.
                        onDerivedPageChange={scrollMode ? derivedPage.set : undefined}
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
            {/* The maximized board's bottom search dock — search chrome,
                so it mounts here where every value it needs is in scope,
                never inside PinBoard. Mounted whenever the board is
                maximized: visibility (hidden, click-opened, pinned) is the
                dock's own affair, the way PinboardFullscreenBar owns its
                hover state (docs/maximized-pinboard-search-overlay-
                design.md §5.1) */}
            {pinboardMaximized && (
                <SearchOverlay
                    onRefresh={onRefresh}
                    isFetching={isFetching}
                    nResults={nResults}
                    resultMetrics={data?.result_metrics}
                    countMetrics={data?.count_metrics}
                    source={resultsSource}
                    count={itemCount}
                    // Same two flags, same expressions, as the gallery gets —
                    // the viewer inside the dock resolves and steps a position
                    // exactly as the gallery does and needs both corrections.
                    countSettled={countSettled}
                    resultsAreStale={resultsAreStale}
                    scrollMode={scrollMode}
                    // Scroll mode only: in pages mode `top` is a within-page
                    // index the grid owns, not a strip position (§5.3).
                    fallbackAnchor={scrollMode ? scrollAnchor : null}
                    // Stable by construction (a box member, minted once per
                    // mount) — the strip's scroll listener depends on it. The
                    // division of labor: USER pans push through this
                    // (leading-card derivation), while anchor/selection-driven
                    // moves are
                    // reported by useDerivedVirtualPage's anchor-trigger
                    // branch (its `galleryOpen` flag covers the maximized
                    // board) — the strip suppresses its own programmatic
                    // keep-in-view scrolls, whose 'auto' alignment can put a
                    // previous-page card in the lead (§5.4, §6).
                    onDerivedPageChange={scrollMode ? derivedPage.set : undefined}
                    pageSize={k}
                    // The exact four-prop switch the page-level bar gets —
                    // that one is gated `!fs`, so only one PageSelect is
                    // ever on screen (§5.4).
                    totalPages={scrollMode ? scrollTotalPages : totalPages}
                    currentPage={scrollMode ? derivedPage : page}
                    setPage={scrollMode ? setVirtualPage : setPage}
                    getPageURL={scrollMode ? getVirtualPageURL : getPageURL}
                    // The one input the pinned viewer needs that only this
                    // component can compute — see the prop and §8.3.
                    largeImageHosted={largeImageHosted}
                />
            )}
            {/* The left-edge sidebar dock — the same model rotated
                (design §9). The sidebar CONTENT reads everything from
                hooks; the one prop is the same `largeImageHosted` the
                bottom dock gets one block up, because this dock's Esc
                yields to the viewer and only this component can say whether
                a viewer surface is actually mounted to consume the key
                (§8.3). The page <SideBar/> is unmounted while maximized
                (SearchPageContent gates it on !pinboardMaximized), so this
                is the only mount of the sidebar content — the two can never
                double-mount. */}
            {pinboardMaximized && (
                <SidebarOverlay largeImageHosted={largeImageHosted} />
            )}
        </>
    )
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
    // The grid's measured cell width, from the one component that can compute
    // it to the one control that reads it, without re-rendering this panel on
    // the way (lib/state/gridMetricsBox.ts). Per mount, never a module
    // singleton — the derived-page box's rule, for its reason.
    const [metricsStore] = useState(() => createGridMetricsStore())
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
                            {pinboard.length > 0 && (
                                <PinboardTabChip
                                    active={showPinboard}
                                    // The same pair of writes the strip's
                                    // own onValueChange makes for "pins":
                                    // one tab wins, the other flag stands
                                    // down, same tick, one URL update.
                                    onActivate={() => {
                                        setPinboardTab(true)
                                        setLibraryTab(false)
                                    }}
                                />
                            )}
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
                    {/* Beside the mode toggle rather than inside it: both
                        are about how the Results tab presents, and the size
                        slider is the other half of the answer the toggle
                        starts. Deliberately NOT mounted in the maximized
                        board's search dock, which shares ViewModeToggle but
                        renders no result grid for a cell size to describe. */}
                    <GridCellSizeControl metricsStore={metricsStore} />
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
                    metricsStore={metricsStore}
                />
            )}
        </div>
    )
}
