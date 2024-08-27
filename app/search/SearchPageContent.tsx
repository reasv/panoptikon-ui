"use client"
import { $api } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Image from 'next/image'
import { PageSelect } from "@/components/pageselect";
import { BookmarkBtn, FilePathComponent, OpenFile, OpenFolder } from "@/components/imageButtons"
import { useDatabase, useSearchQuery } from "@/lib/zust"
import { Toggle } from "@/components/ui/toggle"

import { Settings, RefreshCw, SidebarClose } from "lucide-react"
import { AnimatedNumber } from "@/components/ui/animatedNumber"
import { Fts5ToggleButton } from "@/components/FTS5Toggle"
import { keepPreviousData } from "@tanstack/react-query"
import { InstantSearchLock } from "@/components/InstantSearchLock"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { SearchBar } from "@/components/searchBar"
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { AdvancedSearchOptions } from "@/components/advancedSearchOptions";
import { SearchQueryArgs } from "./page";

export function SearchPageContent({ initialQuery }:
    { initialQuery: SearchQueryArgs }
) {
    const isClient = typeof window !== "undefined"
    const searchQuery = isClient ? useSearchQuery((state) => state.getSearchQuery()) : initialQuery.body
    const dbs = isClient ? useDatabase((state) => state.getDBs()) : initialQuery.params.query
    const setPage = useSearchQuery((state) => state.setPage)
    const page = useSearchQuery((state) => state.order_args.page)
    const page_size = useSearchQuery((state) => state.order_args.page_size)
    const queryEnabled = useSearchQuery((state) => state.getSearchEnabled())

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
            enabled: queryEnabled,
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
    const queryEnabledByUser = useSearchQuery((state) => state.user_enable_search)
    const queryEnabledBySystem = useSearchQuery((state) => state.enable_search)
    useEffect(() => {
        if (!queryEnabledByUser && queryEnabledBySystem) {
            // Make pagination work if the user has disabled search
            refetch()
        }
    }, [page])
    const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
    const toggleAdvancedOptions = () => {
        setShowAdvancedOptions((prev) => !prev);
    };
    function getFileURL(sha256: string) {
        // Only use the DB values if they are set
        return `${sha256}?index_db=${dbs.index_db || ''}&user_data_db=${dbs.user_data_db || ''}`
    }
    return (
        <div className="container mx-auto p-4 relative">
            {/* Main Content Area */}
            <div className="mb-4">
                <div className="flex gap-2">
                    <Toggle
                        pressed={showAdvancedOptions}
                        onClick={toggleAdvancedOptions}
                        title={"Advanced Search Options Are " + (showAdvancedOptions ? "Open" : "Closed")}
                        aria-label="Toggle Advanced Search Options"
                    >
                        <Settings className="h-4 w-4" />
                    </Toggle>
                    <SearchBar />
                    <Fts5ToggleButton isError={isError} error={error} />
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
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                <PageSelect total_pages={total_pages} current_page={page} setPage={setPage} max_pages={25} />
            )}

            {/* Advanced Search Options Panel */}
            {showAdvancedOptions && (
                <AdvancedSearchOptions onClose={toggleAdvancedOptions} />
            )}
        </div>
    );
}