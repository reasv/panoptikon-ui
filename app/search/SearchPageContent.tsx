"use client"
import { PageSelect } from "@/components/pageselect";
import { useInstantSearch } from "@/lib/state/zust"
import { Toggle } from "@/components/ui/toggle"
import { Settings, RefreshCw } from "lucide-react"
import { AnimatedNumber } from "@/components/ui/animatedNumber"
import { InstantSearchLock } from "@/components/InstantSearchLock"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { SearchBar } from "@/components/searchBar"
import { useEffect, useState } from "react";
import { SearchQueryArgs } from "./queryFns";
import { SearchErrorToast } from "@/components/searchErrorToaster";
import { cn, } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { components } from "@/lib/panoptikon";
import { SideBar } from "@/components/sidebar/SideBar";
import { SearchResultImage } from "@/components/SearchResultImage";
import { useGalleryIndex } from "@/lib/state/gallery";
import { useSideBarOpen } from "@/lib/state/sideBar";
import { useSelectedDBs } from "@/lib/state/database";
import { useSearch } from "@/lib/searchHooks";
import { ImageGallery } from '@/components/ImageGallery';
import { ImageSimilarityHeader } from '@/components/ImageSimilarityHeader';
import { useItemSelection } from "@/lib/state/itemSelection";
import { useQueryOptions } from "@/lib/state/searchQuery/clientHooks";

export function SearchPageContent({ initialQuery }:
    { initialQuery: SearchQueryArgs }) {
    const [sidebarOpen, _] = useSideBarOpen()
    return (
        <div className="flex w-full h-screen">
            <SideBar />
            <div className={cn('p-4 transition-all duration-300 mx-auto',
                sidebarOpen ? 'w-full lg:w-1/2 xl:w-2/3 2xl:w-3/4 4xl:w-[80%] 5xl:w-[82%]' : 'w-full'
            )}>
                <MultiSearchView initialQuery={initialQuery} />
            </div>
        </div>
    )
}

export function MultiSearchView({ initialQuery }:
    { initialQuery: SearchQueryArgs }) {
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
    const totalPages = Math.ceil((nResults || 1) / (pageSize)) || 1
    const [index, setIndex] = useGalleryIndex()
    const results = data?.results || []
    const [sidebarOpen, setSideBarOpen] = useSideBarOpen()

    const [delayedFetching, setDelayedFetching] = useState(false)

    useEffect(() => {
        let timer: NodeJS.Timeout;
        if (isFetching) {
            timer = setTimeout(() => setDelayedFetching(true), 1000);
        } else {
            setDelayedFetching(false);
        }
        return () => clearTimeout(timer);
    }, [isFetching])
    const [options, setOptions] = useQueryOptions()
    return (
        <>
            <SearchErrorToast noFtsErrors={options.e_iss} isError={isError} error={error} />
            <div className={cn("mb-4 2xl:mx-auto",
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
                    {options.e_iss ? <ImageSimilarityHeader /> : <SearchBar onSubmit={onRefresh} />}
                    <InstantSearchLock />
                    <Button title="Refresh search results" onClick={onRefresh} variant="ghost" size="icon">
                        <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
            </div>
            {
                (index !== null && results.length > 0)
                    ?
                    <ImageGallery items={results} />
                    :
                    <ResultGrid
                        results={results}
                        totalCount={nResults}
                        onImageClick={(index) => setIndex(index !== undefined ? index : null)}
                        isLoading={delayedFetching}
                    />
            }
            {
                nResults > pageSize && (
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
    onImageClick,
    isLoading,
}: {
    results: SearchResult[],
    totalCount: number,
    onImageClick?: (index?: number) => void,
    isLoading?: boolean,
}) {
    const [dbs, __] = useSelectedDBs()
    const [sidebarOpen, _] = useSideBarOpen()

    return (
        <div className="border rounded p-2">
            <h2 className="text-xl font-bold p-4 flex items-center justify-left">
                <span><AnimatedNumber value={totalCount} /> {totalCount === 1 ? "Result" : "Results"}</span>
            </h2>
            <ScrollArea className="overflow-y-auto">
                <div className={cn('grid gap-4 max-h-[calc(100vh-225px)] grid-cols-1 md:grid-cols-2',
                    sidebarOpen ?
                        ('lg:grid-cols-1 xl:grid-cols-3 2xl:grid-cols-4 4xl:grid-cols-5') :
                        ('lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'))}>
                    {results.map((result, index) => (
                        <SearchResultImage
                            key={result.path}
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

