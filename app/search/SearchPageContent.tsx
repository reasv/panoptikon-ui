"use client"
import { $api } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Image from 'next/image'
import { PageSelect } from "@/components/pageselect";
import { BookmarkBtn, FilePathComponent, OpenFile, OpenFolder } from "@/components/imageButtons"
import { useAdvancedOptions, useDatabase, useInstantSearch, useSearchQuery } from "@/lib/zust"
import { Toggle } from "@/components/ui/toggle"

import { Settings, RefreshCw } from "lucide-react"
import { AnimatedNumber } from "@/components/ui/animatedNumber"
import { keepPreviousData } from "@tanstack/react-query"
import { InstantSearchLock } from "@/components/InstantSearchLock"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { SearchBar } from "@/components/searchBar"
import { useEffect, useState } from "react";
import { AdvancedSearchOptions } from "@/components/advancedSearchOptions";
import { SearchQueryArgs } from "./page";
import { SearchErrorToast } from "@/components/searchErrorToaster";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

export function SearchPageContent({ initialQuery }:
    { initialQuery: SearchQueryArgs }
) {
    const isClient = typeof window !== "undefined"
    const searchQuery = isClient ? useSearchQuery((state) => state.getSearchQuery()) : initialQuery.body
    const dbs = isClient ? useDatabase((state) => state.getDBs()) : initialQuery.params.query
    const setPage = useSearchQuery((state) => state.setPage)
    const page = useSearchQuery((state) => state.order_args.page)
    const page_size = useSearchQuery((state) => state.order_args.page_size)
    const searchEnabled = useSearchQuery((state) => state.enable_search)
    const instantSearch = useInstantSearch((state) => state.enabled)

    const { data, error, isError, refetch } = $api.useQuery(
        "post",
        "/api/search",
        {
            params: {
                query: dbs,
            },
            body: {
                ...searchQuery
            }
        },
        {
            enabled: searchEnabled && instantSearch,
            placeholderData: keepPreviousData
        }
    );
    const total_pages = Math.ceil((data?.count || 1) / (page_size)) || 1
    const nResults = data?.count || 0
    const { toast } = useToast()
    const onRefresh = async () => {
        await refetch()
        toast({
            title: "Refreshed results",
            description: "Results have been updated",
            duration: 2000
        })
    }
    useEffect(() => {
        if (!instantSearch && searchEnabled) {
            // Make pagination work if the user has disabled instant search
            refetch()
        }
    }, [page])
    function getFileURL(sha256: string) {
        // Only use the DB values if they are set
        return `${sha256}?index_db=${dbs.index_db || ''}&user_data_db=${dbs.user_data_db || ''}`
    }
    const toggleOptions = useAdvancedOptions((state) => state.toggle)
    const advancedIsOpen = useAdvancedOptions((state) => state.isOpen)
    const isMobile = useMediaQuery("(max-width: 768px)")
    const isTablet = useMediaQuery("(max-width: 1024px)")
    const isSmallDesktop = useMediaQuery("(max-width: 1600px)")
    const maxPagesButtons = isMobile ? 5 : isTablet ? 10 : isSmallDesktop ? 15 : 25
    return (
        <div className="flex min-h-screen w-full">
            <AdvancedSearchOptions />
            <div className={cn('flex-grow p-4 transition-all duration-300 mx-auto',
                advancedIsOpen ? 'md:w-1/2 lg:w-1/2 xl:w-2/3 2xl:w-3/4' : 'md:w-full lg:w-full xl:w-full 2xl:w-full'
            )}>
                <SearchErrorToast isError={isError} error={error} />
                <div className={cn("mb-4 2xl:mx-auto",
                    advancedIsOpen ? '2xl:w-2/3' : '2xl:w-1/2'
                )}>
                    <div className="flex gap-2">
                        <Toggle
                            pressed={advancedIsOpen}
                            onClick={toggleOptions}
                            title={"Advanced Search Options Are " + (advancedIsOpen ? "Open" : "Closed")}
                            aria-label="Toggle Advanced Search Options"
                        >
                            <Settings className="h-4 w-4" />
                        </Toggle>
                        <SearchBar />
                        <InstantSearchLock />
                        <Button title="Refresh search results" onClick={onRefresh} variant="ghost" size="icon">
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>
                            <AnimatedNumber value={nResults} /> {nResults === 1 ? "Result" : "Results"}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>

                        <div className={cn('grid gap-4',
                            advancedIsOpen ? 'md:grid-cols-1 lg:grid-cols-1 xl:grid-cols-3 2xl:grid-cols-4' :
                                'md:grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5')}>

                            {data && data.results.map((result) => (
                                <div key={result.path} className="border rounded p-2">
                                    <div className="relative w-full pb-full mb-2 overflow-hidden group">
                                        <a
                                            href={`/api/items/file/${getFileURL(result.sha256)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="block relative h-80 mb-2 overflow-hidden"
                                        >
                                            <Image
                                                src={`/api/items/thumbnail/${getFileURL(result.sha256)}`}
                                                alt={`Result ${result.path}`}
                                                fill
                                                className="object-cover transition-transform duration-300 hover:scale-105"
                                                unoptimized={true}
                                            />
                                        </a>
                                        <BookmarkBtn sha256={result.sha256} />
                                        <OpenFile sha256={result.sha256} path={result.path} />
                                        <OpenFolder sha256={result.sha256} path={result.path} />
                                    </div>
                                    <FilePathComponent path={result.path} />
                                    <p className="text-xs text-gray-500">
                                        {new Date(result.last_modified).toLocaleString('en-US')}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
                {data && data.count > page_size && (
                    <PageSelect total_pages={total_pages} current_page={page} setPage={setPage} max_pages={maxPagesButtons} />
                )}

            </div>
        </div>
    );
}