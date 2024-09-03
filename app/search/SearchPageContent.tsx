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
import { useEffect } from "react";
import { SearchQueryArgs } from "./queryFns";
import { SearchErrorToast } from "@/components/searchErrorToaster";
import { cn, } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { components } from "@/lib/panoptikon";
import { SideBar } from "@/components/sidebar/SideBar";
import { SearchResultImage } from "@/components/SearchResultImage";
import { Mode, useSearchMode } from "@/lib/state/similarityQuery";
import { useGalleryIndex, useGalleryName } from "@/lib/state/gallery";
import { useSideBarOpen } from "@/lib/state/sideBar";
import { useSelectedDBs } from "@/lib/state/database";
import { useItemSimilaritySearch, useSearch } from "@/lib/searchHooks";
import { ImageGallery } from '@/components/ImageGallery';
import { ImageSimilarityHeader } from '@/components/ImageSimilarityHeader';

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
    const [mode, _] = useSearchMode()
    const search = useSearch({ initialQuery })
    const similarity = useItemSimilaritySearch()
    const hook = mode === Mode.ItemSimilarity ? similarity : search
    const { data, error, isError, refetch, isFetching, nResults, page, pageSize, setPage, searchEnabled } = hook
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
    const [name, __] = useGalleryName()
    const [index, setIndex] = useGalleryIndex(name)
    const results = data?.results || []
    const [sidebarOpen, setSideBarOpen] = useSideBarOpen()
    return (
        <>
            <SearchErrorToast noFtsErrors={mode === Mode.ItemSimilarity} isError={isError} error={error} />
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
                    {mode === Mode.Search ? <SearchBar onSubmit={onRefresh} /> : <ImageSimilarityHeader />}
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
                    />
            }
            {
                nResults > pageSize && (
                    <PageSelect totalPages={totalPages} currentPage={page} setPage={setPage} />
                )
            }
        </>
    )
}

export function ResultGrid({
    results,
    totalCount,
    onImageClick
}: { results: components["schemas"]["FileSearchResult"][], totalCount: number, onImageClick?: (index?: number) => void }) {
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
                        />
                    ))}
                </div>
            </ScrollArea>
        </div>
    )
}

