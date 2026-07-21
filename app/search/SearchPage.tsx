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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { SearchQueryArgs } from "./queryFns"
import { SearchErrorToast } from "@/components/searchErrorToaster"
import { cn } from "@/lib/utils"
import { ScrollBar } from "@/components/ui/scroll-area"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { SideBar } from "@/components/sidebar/SideBar"
import { SearchResultImage } from "@/components/SearchResultImage"
import { useGalleryFullscreen, useGalleryIndex, useGalleryPinBoardLayout, useGridPinboardTab } from "@/lib/state/gallery"
import { useSideBarOpen } from "@/lib/state/sideBar"
import { selectedDBsSerializer, useSelectedDBs } from "@/lib/state/database"
import { useSearch } from "@/lib/searchHooks"
import { ImageGallery, PinboardTabChip } from '@/components/gallery/ImageGallery'
import { PinBoard } from '@/components/gallery/GalleryPinBoard'
import { PinboardLibraryButton } from '@/components/gallery/PinboardLibrary'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePinboardURLLoader } from '@/lib/pinboardLinks'
import { ImageSimilarityHeader } from '@/components/ImageSimilarityHeader'
import { mintSeed, useOrderBy, usePageSize, useQueryOptions, useRandomSeed, useStampRandomSeed } from "@/lib/state/searchQuery/clientHooks"
import Link from "next/link"
import { useScanDrawerOpen } from "@/lib/state/scanDrawer"
import { ScanDrawer } from "@/components/scan/ScanDrawer"
import { useItemSelection } from "@/lib/state/itemSelection"
import { useVirtualizer } from "@tanstack/react-virtual"
import { components } from "@/lib/panoptikon"
import { useGridScrollAnchor } from "@/lib/state/gridScroll"
import { DesktopUpdateRibbon } from "@/components/DesktopUpdateRibbon"
import { SearchMetricsHoverCard } from "@/components/SearchMetricsCard"

export function SearchPageContent({ initialQuery, isRestrictedMode }:
    { initialQuery: SearchQueryArgs, isRestrictedMode: boolean }) {
    const [sidebarOpen, _] = useSideBarOpen()
    const [updateRibbonVisible, setUpdateRibbonVisible] = useState(false)
    return (
        <div className="flex h-screen w-full flex-col">
            <DesktopUpdateRibbon onVisibilityChange={setUpdateRibbonVisible} />
            <div className="flex min-h-0 flex-1">
                <SideBar />
                {!isRestrictedMode && <ScanDrawer />}
                <div className={cn('p-4 transition-all duration-300 mx-auto',
                    sidebarOpen ? 'w-full lg:w-1/2 xl:w-2/3 2xl:w-3/4 4xl:w-[80%] 5xl:w-[82%]' : 'w-full'
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

export function MultiSearchView({ initialQuery, isRestrictedMode, updateRibbonVisible = false }:
    { initialQuery: SearchQueryArgs, isRestrictedMode: boolean, updateRibbonVisible?: boolean }) {
    const { data, error, isError, refetch, isFetching, resultsAreStale, nResults, page, pageSize, setPage, searchEnabled, getPageURL } = useSearch({ initialQuery })
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

    const [options, setOptions] = useQueryOptions()
    const dbs = useSelectedDBs()[0]
    const scanLink = useMemo(() => {
        return selectedDBsSerializer("/scan", {
            index_db: dbs.index_db,
            user_data_db: dbs.user_data_db,
        })
    }, [dbs])
    const [scanOpen, setScanOpen] = useScanDrawerOpen()

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
                    {!isRestrictedMode && <Link href={scanLink} onClick={() => setScanOpen(true)}>
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
                (qIndex !== null && results.length > 0)
                    ?
                    <ImageGallery
                        items={results}
                        totalPages={totalPages}
                        setPage={setPage}
                        resultsAreStale={resultsAreStale}
                    />
                    :
                    <GridPanel
                        results={results}
                        totalCount={nResults}
                        resultMetrics={data?.result_metrics}
                        countMetrics={data?.count_metrics}
                        onImageClick={(index) => setIndex(index !== undefined ? index : null)}
                        isLoading={loading}
                        resultsAreStale={resultsAreStale}
                        showPagination={showPagination}
                        savedScrollOffsetRef={gridScrollOffsetRef}
                        updateRibbonVisible={updateRibbonVisible}
                    />
            }
            {
                showPagination && (
                    <PageSelect
                        totalPages={totalPages}
                        currentPage={page}
                        setPage={setPage}
                        getPageURL={getPageURL}
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
    results,
    totalCount,
    resultMetrics,
    countMetrics,
    onImageClick,
    isLoading,
    resultsAreStale = false,
    showPagination = true,
    savedScrollOffsetRef,
    updateRibbonVisible = false,
}: {
    results: SearchResult[],
    resultMetrics?: components["schemas"]["SearchMetrics"],
    countMetrics?: components["schemas"]["SearchMetrics"],
    totalCount: number,
    onImageClick?: (index?: number) => void,
    isLoading?: boolean,
    resultsAreStale?: boolean,
    showPagination?: boolean,
    savedScrollOffsetRef?: React.MutableRefObject<number>,
    updateRibbonVisible?: boolean,
}) {
    const pinboard = useGalleryPinBoardLayout()[0]
    const [pinboardTab, setPinboardTab] = useGridPinboardTab()
    const [fs, setFs] = useGalleryFullscreen()
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
                {pinboard.length > 0 && (
                    <Tabs
                        value={showPinboard ? "pins" : "results"}
                        onValueChange={(value) => setPinboardTab(value === "pins")}
                    >
                        <TabsList className="flex">
                            <PinboardTabChip active={showPinboard} />
                            <TabsTrigger value="results" className="shrink-0 px-3">
                                Results
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                )}
                {/* col-start-3: the tabs cell above is conditional, so
                    without an explicit track this would slide into the
                    center when no board exists */}
                <div className="col-start-3 flex justify-end">
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
            ) : (
                <ResultGrid
                    results={results}
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

export function ResultGrid({
    results,
    onImageClick,
    isLoading,
    resultsAreStale = false,
    showPagination = true,
    savedScrollOffsetRef,
    updateRibbonVisible = false,
}: {
    results: SearchResult[],
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
    const rowCount = columns > 0 ? Math.ceil(results.length / columns) : 0

    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => parentRef.current,
        estimateSize: () => rowEstimate,
        overscan: 3,
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

    // Persist the anchor only once scrolling pauses — never during a scroll,
    // so the URL write can't cost scroll frames (and browsers rate-limit
    // history.replaceState). While the top row is still (partially) visible
    // the param is removed entirely: short result sets and barely-scrolled
    // views keep a clean URL and today's behaviour.
    useEffect(() => {
        const element = parentRef.current
        if (!element || columns <= 0) return
        let timer: ReturnType<typeof setTimeout> | undefined
        const onScrollStop = () => {
            const startRow = virtualizer.range?.startIndex ?? 0
            const anchor = startRow > 0 ? startRow * columns : null
            if (anchor === lastWrittenAnchor.current) return
            lastWrittenAnchor.current = anchor
            setScrollAnchor(anchor)
        }
        const onScroll = () => {
            clearTimeout(timer)
            timer = setTimeout(onScrollStop, 350)
        }
        element.addEventListener('scroll', onScroll, { passive: true })
        return () => {
            clearTimeout(timer)
            element.removeEventListener('scroll', onScroll)
        }
    }, [columns, virtualizer, setScrollAnchor])

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
        restoredScroll.current = true
        // From here on the current URL anchor is accounted for: the external-
        // change effect below must only react to values arriving later
        lastWrittenAnchor.current = scrollAnchor
        const savedOffset = savedScrollOffsetRef?.current ?? 0
        if (savedOffset > 0) {
            // Returning from the gallery: the exact pixel restore wins — the
            // URL anchor is just a coarser record of the same position
            virtualizer.scrollToOffset(savedOffset)
        } else if (scrollAnchor !== null && scrollAnchor > 0) {
            if (scrollAnchor < results.length) {
                const anchorRow = Math.floor(scrollAnchor / columns)
                virtualizer.scrollToIndex(anchorRow, { align: 'start' })
                // Unmeasured rows above the target make the first scroll land on
                // estimated offsets — re-assert once the rows around the target
                // have mounted and been measured
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    virtualizer.scrollToIndex(anchorRow, { align: 'start' })
                }))
            } else {
                // Stale anchor (e.g. a shared link into a result set that no
                // longer reaches that far) — drop it rather than landing
                // somewhere arbitrary
                lastWrittenAnchor.current = null
                setScrollAnchor(null)
            }
        }
        if (!selected) return
        const index = results.findIndex((item) => item.item_id === selected.item_id)
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
    }, [rowCount, columns, results, selected, virtualizer, savedScrollOffsetRef, rowEstimate, scrollAnchor, setScrollAnchor, resultsAreStale])

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
        lastWrittenAnchor.current = scrollAnchor
        if (scrollAnchor === null || scrollAnchor <= 0) {
            virtualizer.scrollToOffset(0)
        } else {
            const clamped = Math.min(scrollAnchor, results.length - 1)
            virtualizer.scrollToIndex(Math.floor(clamped / columns), { align: 'start' })
        }
    }, [scrollAnchor, columns, rowCount, results.length, virtualizer, resultsAreStale])

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
                className={cn('w-full rounded-[inherit] [&>div]:block!',
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
                        const rowItems = results.slice(startIndex, startIndex + columns)
                        return (
                            <div
                                key={virtualRow.key}
                                data-index={virtualRow.index}
                                ref={virtualizer.measureElement}
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
                                    {rowItems.map((result, indexInRow) => (
                                        <SearchResultImage
                                            key={result.file_id}
                                            result={result}
                                            index={startIndex + indexInRow}
                                            dbs={dbs}
                                            onImageClick={onImageClick}
                                            galleryLink
                                            nItems={results.length}
                                            showLoadingSpinner={isLoading}
                                        />
                                    ))}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </ScrollAreaPrimitive.Viewport>
            <ScrollBar orientation="vertical" />
            <ScrollAreaPrimitive.Corner />
        </ScrollAreaPrimitive.Root>
    )
}
