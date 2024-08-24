"use client"
import { $api } from "@/lib/api";

const BookmarkBtn = (
    { sha256, }: {
        sha256: string;
    }
) => {
    const params = {
        path: { namespace: "default", sha256: sha256 },
        query: {
            index_db: "default"
        }
    }
    const { data, error, isLoading, isError, status } = $api.useQuery(
        "get",
        "/api/bookmarks/ns/{namespace}/{sha256}",
        {
            params,
        },
    );

    const { mutate } = $api.useMutation(
        "put",
        "/api/bookmarks/ns/{namespace}/{sha256}",
    );

    const buttonLabel = (isLoading || !data) ? "Loading" : (data.exists ? "Remove bookmark" : "Add bookmark");
    return <button
        className="absolute top-2 right-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        onClick={() => console.log("test")} // Your bookmark handling function
    >
        <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="currentColor"
            viewBox="0 0 24 24"
            className="w-6 h-6 text-gray-800"
        >
            <path d="M5 3v18l7-5 7 5V3H5z" />
        </svg>
    </button>
};
import { useState } from 'react'
import { useMutation, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Image from 'next/image'
import { PageSelect } from "@/components/pageselect";


function SearchPageContent() {
    const [searchQuery, setSearchQuery] = useState('')
    const page_size = 9
    const [page, setPage] = useState(1)
    const { data, error, isLoading, isError, status } = $api.useQuery(
        "post",
        "/api/search",
        {
            body: {
                query: {
                    filters: {
                        any_text: {
                            extracted_text: {
                                query: searchQuery
                            },
                            path: {
                                query: searchQuery,
                                only_match_filename: false
                            }
                        }
                    }
                },
                order_args: {
                    order_by: "last_modified",
                    order: "asc",
                    page,
                    page_size,
                },
                count: true,
                check_path: true
            }
        }
    );

    const total_pages = Math.ceil((data?.count || 1) / page_size) || 1

    return (
        <div className="container mx-auto p-4">
            {/* <h1 className="text-2xl font-bold mb-4">Search Page</h1> */}
            <div className="mb-4">
                <div className="flex gap-2">
                    <Input
                        type="text"
                        placeholder="Enter search query"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="flex-grow"
                    />
                </div>
            </div>

            {isError && <p>Error occurred while fetching results: {(error as Error).message}</p>}

            {data && (
                <>
                    <Card>
                        <CardHeader>
                            <CardTitle>Search Results (Total: {data.count})</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {data.results.map((result) => (
                                    <div key={result.sha256} className="border rounded p-2">
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
                                        </div>
                                        <p title={result.path} className="text-sm truncate" style={{ direction: 'rtl', textAlign: 'left' }}>{result.path}</p>
                                        <p className="text-xs text-gray-500">{new Date(result.last_modified).toLocaleString()}</p>
                                    </div>
                                ))}
                            </div>
                        </CardContent>

                    </Card>
                    <PageSelect total_pages={total_pages} current_page={page} setPage={setPage} max_pages={25} />
                </>

            )}

            {data && data.results.length === 0 && (
                <p>No results found.</p>
            )}
        </div>
    )
}

// Create a new client
const queryClient = new QueryClient()

// Wrap the component with QueryClientProvider
export default function SearchPageWrapper() {
    return (
        <QueryClientProvider client={queryClient}>
            <SearchPageContent />
        </QueryClientProvider>
    )
}