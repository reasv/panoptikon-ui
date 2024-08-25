"use client"
import { $api } from "@/lib/api"
import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Image from 'next/image'
import { PageSelect } from "@/components/pageselect";
import { BookmarkBtn, FilePathComponent, OpenFile, OpenFolder } from "@/components/imageButtons"
import { useDatabase } from "@/lib/zust"
import { Toggle } from "@/components/ui/toggle"

import { Italic, Settings, MSquare } from "lucide-react"
import { AnimatedNumber } from "@/components/ui/animatedNumber"
import { useToast } from "@/components/ui/use-toast"
import { ToastAction } from "@/components/ui/toast"


function SearchPageContent() {
    const [searchQuery, setSearchQuery] = useState('')
    const [raw_fts5_match, setRawFts5Match] = useState(false)
    const page_size = 9
    const [page, setPage] = useState(1)
    useEffect(() => {
        setPage(1);
    }, [searchQuery]);
    const query = useDatabase((state) => state);
    const { data, error, isLoading, isError, status } = $api.useQuery(
        "post",
        "/api/search",
        {
            params: {
                query
            },
            body: {
                query: {
                    filters: {
                        any_text: {
                            extracted_text: {
                                query: searchQuery,
                                raw_fts5_match,
                            },
                            path: {
                                query: searchQuery,
                                only_match_filename: false,
                                raw_fts5_match,
                            }
                        }
                    }
                },
                order_args: {
                    order_by: "last_modified",
                    order: null,
                    page,
                    page_size,
                },
                count: true,
                check_path: true
            }
        },
    );
    const { toast } = useToast()
    const onClickFTS5Toggle = () => {
        const newValue = !raw_fts5_match
        setRawFts5Match(newValue)
        let description = "You can now use natural language queries"
        if (newValue) {
            description = "Consult the SQLite FTS5 documentation for the correct syntax"
        }
        let action = undefined
        if (newValue) {
            action = <ToastAction onClick={() => window.open("https://www.sqlite.org/fts5.html#full_text_query_syntax", "_blank")} altText="FTS5 Docs">Docs</ToastAction>
        }
        toast({
            title: `${newValue ? "Enabled" : "Disabled"} FTS5 MATCH syntax`,
            description,
            action,
            duration: 3000
        })
    }
    useEffect(() => {
        if (isError) {
            let action = undefined
            let message = (error as Error).message
            if (!message && raw_fts5_match) {
                message = "Make sure your query follows FTS5 MATCH syntax or disable the option"
                action = <ToastAction onClick={() => window.open("https://www.sqlite.org/fts5.html#full_text_query_syntax", "_blank")} altText="FTS5 Docs">Docs</ToastAction>
            }
            toast({
                title: "Error occurred while fetching results",
                description: message,
                variant: "destructive",
                action,
                duration: 5000
            })
        }
    }, [isError])
    const total_pages = Math.ceil((data?.count || 1) / page_size) || 1
    const nResults = data?.count || 0
    return (
        <div className="container mx-auto p-4">
            {/* <h1 className="text-2xl font-bold mb-4">Search Page</h1> */}
            <div className="mb-4">
                <div className="flex gap-2">
                    <Toggle disabled title="Advanced Search Options hidden" aria-label="Toggle bold">
                        <Settings className="h-4 w-4" />
                    </Toggle>
                    <Input
                        type="text"
                        placeholder="What do your eyes seek?"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="flex-grow"
                    />
                    <Toggle
                        onClick={() => onClickFTS5Toggle()}
                        title={`FTS5 MATCH syntax in query is ${raw_fts5_match ? "enabled" : "disabled"}`}
                        aria-label="Toggle bold">
                        <MSquare className="h-4 w-4" />
                    </Toggle>
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