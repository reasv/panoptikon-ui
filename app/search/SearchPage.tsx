"use client"
import { PageSelect } from "@/components/pageselect"
import { useInstantSearch, useSearchLoading } from "@/lib/state/zust"
import { Toggle } from "@/components/ui/toggle"
import { Settings, RefreshCw, ScanEye } from "lucide-react"
import { AnimatedNumber } from "@/components/ui/animatedNumber"
import { InstantSearchLock } from "@/components/InstantSearchLock"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { SearchBar } from "@/components/searchBar"
import { useEffect, useMemo, useRef, useState } from "react"
import { SearchQueryArgs } from "./queryFns"
import { SearchErrorToast } from "@/components/searchErrorToaster"
import { cn } from "@/lib/utils"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
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
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
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
    useEffect(() => {
        if (qIndex === null) {
            return
        }
        const index = (qIndex || 0) % results.length
        if (selectedItem && results[index] && selectedItem.item_id !== results[index].item_id) {
            const newIndex = results.findIndex((item) => item.item_id === selectedItem.item_id)
            if (newIndex !== -1) {
                setIndex(newIndex)
            }
        }
    }, [selectedItem])
    const [fs, setFs] = useGalleryFullscreen()
    const loading = useSearchLoading((state) => state.loading)
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
                    {options.e_iss ? <ImageSimilarityHeader /> : <SearchBar onSubmit={onRefresh} />}
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
                    />
                    :
                    // (results.length <= 20 ?
                    <ResultGrid
                        results={results}
                        totalCount={nResults}
                        resultMetrics={data?.result_metrics}
                        countMetrics={data?.count_metrics}
                        onImageClick={(index) => setIndex(index !== undefined ? index : null)}
                        isLoading={loading}
                    />
                // :
                // <VirtualResultGrid

                //     results={results}
                //     totalCount={nResults}
                //     onImageClick={(index) => setIndex(index !== undefined ? index : null)}
                //     isLoading={loading}
                // />
                // )

            }
            {
                !fs && (nResults > pageSize) && (pageSize > 0) && (
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

export function ResultGrid({
    results,
    totalCount,
    resultMetrics,
    countMetrics,
    onImageClick,
    isLoading,
}: {
    results: SearchResult[],
    resultMetrics?: components["schemas"]["SearchMetrics"],
    countMetrics?: components["schemas"]["SearchMetrics"],
    totalCount: number,
    onImageClick?: (index?: number) => void,
    isLoading?: boolean,
}) {
    const [dbs, __] = useSelectedDBs()
    const [sidebarOpen, _] = useSideBarOpen()
    const executionSummary = `Results: ${resultMetrics?.execute} DB, ${resultMetrics?.build} Build, ${resultMetrics?.compile} Compile`
        + `\nCount: ${countMetrics?.execute} DB, ${countMetrics?.build} Build, ${countMetrics?.compile} Compile`
    return (
        <div className="border rounded p-2">
            <h2 className="text-xl font-bold p-4 flex items-center justify-left">
                <span title={executionSummary}><AnimatedNumber value={totalCount} /> {totalCount === 1 ? "Result" : "Results"} in {resultMetrics?.execute}s</span>
            </h2>
            <ScrollArea className="overflow-y-auto">
                <div className={cn('grid gap-4 max-h-[calc(100vh-225px)] grid-cols-1 md:grid-cols-2',
                    sidebarOpen ?
                        ('lg:grid-cols-1 xl:grid-cols-3 2xl:grid-cols-4 4xl:grid-cols-5') :
                        ('lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'))}>
                    {results.map((result, index) => (
                        <SearchResultImage
                            key={result.file_id}
                            result={result}
                            index={index}
                            dbs={dbs}
                            onImageClick={onImageClick}
                            galleryLink
                            nItems={results.length}
                            showLoadingSpinner={isLoading}
                        />
                    ))}
                </div>
            </ScrollArea>
        </div>
    )
}

/**
 * Determines the number of columns and row height based on window width and sidebar state.
 * @param sidebarOpen - Indicates if the sidebar is open.
 * @returns An object containing the number of columns and the row height in pixels.
 */
function useColumnsAndRowHeight(sidebarOpen: boolean): { columns: number, rowHeight: number } {
    const [columns, setColumns] = useState(1)
    const [rowHeight, setRowHeight] = useState(400)

    useEffect(() => {
        const update = () => {
            const width = window.innerWidth
            let newColumns = 1
            let newRowHeight = 470

            if (sidebarOpen) {
                if (width >= 2200) { // 4xl
                    newColumns = 5
                    newRowHeight = 694 // h-[38rem] + padding/borders
                } else if (width >= 1536) { // 2xl
                    newColumns = 4
                    newRowHeight = 470 // h-[30rem] + padding/borders
                } else if (width >= 1280) { // xl
                    newColumns = 3
                    newRowHeight = 470 // h-96 + padding/borders
                } else if (width >= 1024) { // lg
                    newColumns = 1
                    newRowHeight = 470 // h-96 without extra padding
                } else if (width >= 768) { // md
                    newColumns = 2
                    newRowHeight = 470 // h-96 + padding/borders
                } else {
                    newColumns = 1
                    newRowHeight = 470 // h-96 without extra padding
                }
            } else {
                if (width >= 2200) { // 4xl
                    newColumns = 5
                    newRowHeight = 694
                } else if (width >= 1536) { // 2xl
                    newColumns = 5
                    newRowHeight = 470
                } else if (width >= 1280) { // xl
                    newColumns = 4
                    newRowHeight = 470
                } else if (width >= 1024) { // lg
                    newColumns = 3
                    newRowHeight = 470
                } else if (width >= 768) { // md
                    newColumns = 2
                    newRowHeight = 470
                } else {
                    newColumns = 1
                    newRowHeight = 470
                }
            }

            setColumns(newColumns)
            setRowHeight(newRowHeight)
        }

        update()
        window.addEventListener('resize', update)
        return () => window.removeEventListener('resize', update)
    }, [sidebarOpen])

    return { columns, rowHeight }
}

interface VirtualResultGridProps {
    results: SearchResult[];
    totalCount: number;
    onImageClick?: (index?: number) => void;
    isLoading?: boolean;
}

/**
 * VirtualResultGrid component that virtualizes the rendering of a result grid.
 */
export function VirtualResultGrid({
    results,
    totalCount,
    onImageClick,
    isLoading,
}: VirtualResultGridProps) {
    const [dbs] = useSelectedDBs();
    const [sidebarOpen] = useSideBarOpen();
    const parentRef = useRef<HTMLDivElement>(null);

    // Determine the number of columns and row height based on window size and sidebar state
    const { columns, rowHeight } = useColumnsAndRowHeight(sidebarOpen);

    // Calculate the number of rows needed
    const rowCount = Math.ceil(results.length / columns);

    // Initialize the virtualizer
    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => parentRef.current,
        estimateSize: () => rowHeight,
        overscan: 5, // Adjust overscan as needed
    });

    // Get the virtual items (rows) to render
    const virtualRows = virtualizer.getVirtualItems();

    return (
        <div className="border rounded p-2 " >
            <h2 className="text-xl font-bold p-4 flex items-center justify-left">
                <span>
                    <AnimatedNumber value={totalCount} /> {totalCount === 1 ? 'Result' : 'Results'}
                </span>
            </h2>
            <ScrollAreaPrimitive.Root
                className="overflow-y-auto max-h-[calc(100vh-225px)] w-full whitespace-nowrap rounded-md border"
            >
                <ScrollAreaPrimitive.Viewport
                    ref={parentRef}
                    className="w-full h-full rounded-[inherit]"
                >
                    <div
                        style={{
                            height: `${virtualizer.getTotalSize()}px`,
                            width: '100%',
                            position: 'relative',
                        }}
                    >
                        {virtualRows.map((virtualRow) => {
                            const startIndex = virtualRow.index * columns;
                            const endIndex = Math.min(startIndex + columns, results.length);
                            const items = results.slice(startIndex, endIndex);

                            return (
                                <div
                                    key={virtualRow.key}
                                    className="absolute w-full"
                                    style={{
                                        transform: `translateY(${virtualRow.start}px)`,
                                        height: `${virtualRow.size}px`,
                                    }}
                                >
                                    <div
                                        className={cn('grid gap-4', {
                                            'grid-cols-1 md:grid-cols-2': true, // Base and md
                                            // Apply additional grid columns based on sidebar state
                                            'lg:grid-cols-1 xl:grid-cols-3 2xl:grid-cols-4 4xl:grid-cols-5':
                                                sidebarOpen,
                                            'lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5':
                                                !sidebarOpen,
                                        })}
                                        style={{
                                            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                                        }}
                                    >
                                        {items.map((result, index) => {
                                            const actualIndex = startIndex + index;
                                            return (
                                                <SearchResultImage
                                                    key={result.file_id}
                                                    result={result}
                                                    index={actualIndex}
                                                    dbs={dbs}
                                                    onImageClick={onImageClick}
                                                    galleryLink
                                                    nItems={results.length}
                                                    showLoadingSpinner={isLoading}
                                                />
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </ScrollAreaPrimitive.Viewport>
                <ScrollBar orientation="vertical" />
                <ScrollAreaPrimitive.Corner />
            </ScrollAreaPrimitive.Root>
        </div>
    );
}