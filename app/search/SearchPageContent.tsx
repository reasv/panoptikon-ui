"use client"
import { $api } from "@/lib/api"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Image from 'next/image'
import { PageSelect } from "@/components/pageselect";
import { BookmarkBtn, FilePathComponent, OpenFile, OpenFolder } from "@/components/imageButtons"
import { useDatabase, useSearchQuery } from "@/lib/zust"
import { Toggle } from "@/components/ui/toggle"

import { Settings, RefreshCw } from "lucide-react"
import { AnimatedNumber } from "@/components/ui/animatedNumber"
import { Fts5ToggleButton } from "@/components/FTS5Toggle"
import { keepPreviousData } from "@tanstack/react-query"
import { InstantSearchLock } from "@/components/InstantSearchLock"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"

function SearchPageContent() {
    const searchQuery = useSearchQuery((state) => state.getSearchQuery())
    const setAnyTextQuery = useSearchQuery((state) => state.setAnyTextQuery)
    const anyTextQuery = useSearchQuery((state) => state.any_text.query)

    const setPage = useSearchQuery((state) => state.setPage)
    const page = useSearchQuery((state) => state.order_args.page)
    const page_size = useSearchQuery((state) => state.order_args.page_size)

    const queryArgs = useDatabase((state) => state);
    const queryEnabled = useSearchQuery((state) => state.getSearchEnabled())
    const queryIsEnabled = (condition = false) => condition
    const setEnabled = useSearchQuery((state) => state.setEnableSearch)
    const { data, error, isError, refetch } = $api.useQuery(
        "post",
        "/api/search",
        {
            params: {
                query: queryArgs,
            },
            body: {
                ...searchQuery
            }
        },
        {
            enabled: queryIsEnabled(queryEnabled),
            placeholderData: keepPreviousData
        }
    );
    const total_pages = Math.ceil((data?.count || 1) / (page_size)) || 1
    const nResults = data?.count || 0
    const onTextInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setAnyTextQuery(e.target.value)
    }
    const { toast } = useToast()
    const onRefresh = async () => {
        await refetch()
        toast({
            title: "Refreshed results",
            description: "Results have been updated",
            duration: 2000
        })
    }
    return (
        <div className="container mx-auto p-4">
            <div className="mb-4">
                <div className="flex gap-2">
                    <Toggle disabled title="Advanced Search Options hidden" aria-label="Toggle bold">
                        <Settings className="h-4 w-4" />
                    </Toggle>
                    <Input
                        type="text"
                        placeholder="What do you seek?"
                        value={anyTextQuery}
                        onChange={onTextInputChange}
                        className="flex-grow"
                    />
                    <Fts5ToggleButton isError={isError} error={error} />
                    <InstantSearchLock />
                    <Button title="Refresh search results" onClick={onRefresh} variant="ghost" size="icon">
                        <RefreshCw className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle><AnimatedNumber value={nResults} /> {nResults == 1 ? "Result" : "Results"}</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {data && data.results.map((result) => (
                            <div key={result.path} className="border rounded p-2">
                                <div className="relative w-full pb-full mb-2 overflow-hidden group">
                                    <a
                                        href={`/api/items/file/${result.sha256}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="block relative h-80 mb-2 overflow-hidden"
                                    >
                                        <Image
                                            src={`/api/items/thumbnail/${result.sha256}`}
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
                                <p className="text-xs text-gray-500">{new Date(result.last_modified).toLocaleString()}</p>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
            {data && data.count > page_size &&
                <PageSelect total_pages={total_pages} current_page={page} setPage={setPage} max_pages={25} />
            }
        </div>
    )
}

// Wrap the component with QueryClientProvider
export default function SearchPageWrapper() {
    return (
        <SearchPageContent />
    )
}