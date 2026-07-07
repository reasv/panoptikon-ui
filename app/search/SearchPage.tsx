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
import { useGalleryFullscreen, useGalleryIndex } from "@/lib/state/gallery"
import { useSideBarOpen } from "@/lib/state/sideBar"
import { selectedDBsSerializer, useSelectedDBs } from "@/lib/state/database"
import { useSearch } from "@/lib/searchHooks"
import { ImageGallery } from '@/components/gallery/ImageGallery'
import { ImageSimilarityHeader } from '@/components/ImageSimilarityHeader'
import { useQueryOptions } from "@/lib/state/searchQuery/clientHooks"
import Link from "next/link"
import { useScanDrawerOpen } from "@/lib/state/scanDrawer"
import { ScanDrawer } from "@/components/scan/ScanDrawer"
import { useItemSelection } from "@/lib/state/itemSelection"
import { useVirtualizer } from "@tanstack/react-virtual"
import { components } from "@/lib/panoptikon"

export function SearchPageContent({ initialQuery, isRestrictedMode }:
    { initialQuery: SearchQueryArgs, isRestrictedMode: boolean }) {
    const [sidebarOpen, _] = useSideBarOpen()
    return (
        <div className="flex w-full h-screen">
            <SideBar />
            {!isRestrictedMode && <ScanDrawer />}
            <div className={cn('p-4 transition-all duration-300 mx-auto',
                sidebarOpen ? 'w-full lg:w-1/2 xl:w-2/3 2xl:w-3/4 4xl:w-[80%] 5xl:w-[82%]' : 'w-full'
            )}>
                <MultiSearchView
                    initialQuery={initialQuery}
                    isRestrictedMode={isRestrictedMode}
                />
            </div>
        </div>
    )
}

export function MultiSearchView({ initialQuery, isRestrictedMode }:
    { initialQuery: SearchQueryArgs, isRestrictedMode: boolean }) {
    const { data, error, isError, refetch, isFetching, nResults, page, pageSize, setPage, searchEnabled, getPageURL } = useSearch({ initialQuery })
    const { toast } = useToast()
    const onRefresh = async () => {
        if (!searchEnabled) {
            toast({
                title: "Error",
                description: "Invalid user input",
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
    const instantSearch = useInstantSearch((state) => state.enabled)
    useEffect(() => {
        if (!instantSearch && searchEnabled) {
            // Make pagination work if the user has disabled instant search
            refetch()
        }
    }, [page])
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
        const index = (qIndex || 0) % results.length
        if (selectedItem && results[index] && selectedItem.file_id !== results[index].file_id) {
            const newIndex = results.findIndex((item) => item.file_id === selectedItem.file_id)
            if (newIndex !== -1 && newIndex !== index) {
                setIndex(newIndex)
            }
        }
    }, [selectedItem])
    const [fs, setFs] = useGalleryFullscreen()
    const loading = useSearchLoading((state) => state.loading)
    const showPagination = !fs && (nResults > pageSize) && (pageSize > 0)
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
                    />
                    :
                    <ResultGrid
                        results={results}
                        totalCount={nResults}
                        resultMetrics={data?.result_metrics}
                        countMetrics={data?.count_metrics}
                        onImageClick={(index) => setIndex(index !== undefined ? index : null)}
                        isLoading={loading}
                        showPagination={showPagination}
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

// md, lg, xl, 2xl, 4xl — the Tailwind breakpoints used by the result grid rows
const GRID_BREAKPOINTS = [
    '(min-width: 768px)',
    '(min-width: 1024px)',
    '(min-width: 1280px)',
    '(min-width: 1536px)',
    '(min-width: 2200px)',
]

/**
 * The number of grid columns currently applied by CSS. Must mirror the responsive
 * grid-cols-* classes on the result grid rows exactly — the CSS media queries are
 * what actually lay out the columns; this value only slices results into rows.
 * Uses matchMedia (the same engine that applies the classes) rather than reading
 * window.innerWidth in a resize handler, which can observe a stale width.
 */
function useGridColumns(sidebarOpen: boolean): number {
    // 0 means "not evaluated yet" (SSR and the very first client render) —
    // consumers must not lay out or scroll until this becomes a real count
    const [columns, setColumns] = useState(0)
    useLayoutEffect(() => {
        const queries = GRID_BREAKPOINTS.map((q) => window.matchMedia(q))
        const update = () => {
            const [md, lg, xl, xxl, xxxxl] = queries.map((q) => q.matches)
            setColumns(sidebarOpen
                ? (xxxxl ? 5 : xxl ? 4 : xl ? 3 : lg ? 1 : md ? 2 : 1)
                : (xxl ? 5 : xl ? 4 : lg ? 3 : md ? 2 : 1))
        }
        update()
        queries.forEach((q) => q.addEventListener('change', update))
        return () => queries.forEach((q) => q.removeEventListener('change', update))
    }, [sidebarOpen])
    return columns
}

export function ResultGrid({
    results,
    totalCount,
    resultMetrics,
    countMetrics,
    onImageClick,
    isLoading,
    showPagination = true,
}: {
    results: SearchResult[],
    resultMetrics?: components["schemas"]["SearchMetrics"],
    countMetrics?: components["schemas"]["SearchMetrics"],
    totalCount: number,
    onImageClick?: (index?: number) => void,
    isLoading?: boolean,
    showPagination?: boolean,
}) {
    // TanStack Virtual v3 triggers re-renders by mutating internal state,
    // which the React Compiler's memoization breaks — same as the gallery view.
    "use no memo"
    const [dbs, __] = useSelectedDBs()
    const parentRef = useRef<HTMLDivElement>(null)
    const [sidebarOpen] = useSideBarOpen()
    const columns = useGridColumns(sidebarOpen)
    const rowCount = columns > 0 ? Math.ceil(results.length / columns) : 0

    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 470,
        overscan: 3,
    })

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

    // When returning from the gallery, scroll the grid to the item that was open
    const selected = useItemSelection((state) => state.getSelected())
    const restoredScroll = useRef(false)
    useEffect(() => {
        if (restoredScroll.current || rowCount === 0) return
        restoredScroll.current = true
        if (!selected) return
        const index = results.findIndex((item) => item.item_id === selected.item_id)
        if (index > 0) {
            const row = Math.floor(index / columns)
            // First call lands on estimated row heights; once the target rows have
            // mounted and been measured, align again for the exact position
            virtualizer.scrollToIndex(row, { align: 'center' })
            requestAnimationFrame(() => virtualizer.scrollToIndex(row, { align: 'center' }))
        }
    }, [rowCount, columns, results, selected, virtualizer])

    const executionSummary = `Results: ${resultMetrics?.execute} DB, ${resultMetrics?.build} Build, ${resultMetrics?.compile} Compile`
        + `\nCount: ${countMetrics?.execute} DB, ${countMetrics?.build} Build, ${countMetrics?.compile} Compile`
    return (
        <div className="border rounded p-2">
            <h2 className="text-xl font-bold p-4 flex items-center justify-left">
                <span title={executionSummary}><AnimatedNumber value={totalCount} /> {totalCount === 1 ? "Result" : "Results"} in {resultMetrics?.execute}s</span>
            </h2>
            <ScrollAreaPrimitive.Root className="relative overflow-hidden">
                <ScrollAreaPrimitive.Viewport
                    ref={parentRef}
                    // [&>div]:!block overrides the `display: table` on the content wrapper
                    // Radix injects — table layout also sizes to content, which breaks the
                    // width measurement the column count is derived from
                    className={cn('w-full rounded-[inherit] [&>div]:!block',
                        showPagination ? 'max-h-[calc(100vh-225px)]' : 'max-h-[calc(100vh-163px)]'
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
        </div>
    )
}