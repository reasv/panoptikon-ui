'use client'

import createFetchClient from "openapi-fetch";
import createClient from "openapi-react-query";
import type { paths } from "@/lib/panoptikon"; // generated by openapi-typescript

const fetchClient = createFetchClient<paths>({
    baseUrl: "/",
});
const $api = createClient(fetchClient);

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
    return <Button onClick={() => mutate({ params })}>{buttonLabel}</Button>;
};
import { useState } from 'react'
import { useMutation, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Image from 'next/image'
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination"
const range = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, i) => start + i);
export function PageSelect({
    total_pages,
    current_page,
    max_pages,
    setPage
}: {
    total_pages: number;
    current_page: number;
    max_pages: number;
    setPage: (page: number) => void;
}) {
    // Remove the first and last page from max_pages since they are always shown
    max_pages = Math.max(max_pages - 2, 1);

    // Calculate the range of pages to display
    const half_max_pages = Math.floor(max_pages / 2);
    let startPage = Math.max(current_page - half_max_pages, 2);
    let endPage = Math.min(current_page + half_max_pages, total_pages - 1);

    // Adjust if the calculated range is too close to the start or end
    if (current_page - half_max_pages < 2) {
        startPage = 2;
        endPage = Math.min(2 + max_pages - 1, total_pages - 1);
    }
    if (current_page + half_max_pages > total_pages - 1) {
        startPage = Math.max(total_pages - max_pages, 2);
        endPage = total_pages - 1;
    }

    return (
        <Pagination className="mt-4">
            <PaginationContent>
                {/* Previous Button */}
                <PaginationItem>
                    <PaginationPrevious
                        href="#"
                        onClick={(e) => {
                            e.preventDefault();
                            if (current_page > 1) setPage(current_page - 1);
                        }}
                    />
                </PaginationItem>

                {/* First Page */}
                <PaginationItem>
                    <PaginationLink
                        href="#"
                        isActive={1 === current_page}
                        onClick={(e) => {
                            e.preventDefault();
                            setPage(1);
                        }}
                    >
                        1
                    </PaginationLink>
                </PaginationItem>

                {/* Ellipsis before middle pages */}
                {startPage > 2 && (
                    <PaginationItem>
                        <PaginationEllipsis />
                    </PaginationItem>
                )}

                {/* Middle Pages */}
                {range(startPage, endPage).map((page) => (
                    <PaginationItem key={page}>
                        <PaginationLink
                            href="#"
                            isActive={page === current_page}
                            onClick={(e) => {
                                e.preventDefault();
                                setPage(page);
                            }}
                        >
                            {page}
                        </PaginationLink>
                    </PaginationItem>
                ))}

                {/* Ellipsis after middle pages */}
                {endPage < total_pages - 1 && (
                    <PaginationItem>
                        <PaginationEllipsis />
                    </PaginationItem>
                )}

                {/* Last Page */}
                <PaginationItem>
                    <PaginationLink
                        href="#"
                        isActive={total_pages === current_page}
                        onClick={(e) => {
                            e.preventDefault();
                            setPage(total_pages);
                        }}
                    >
                        {total_pages}
                    </PaginationLink>
                </PaginationItem>

                {/* Next Button */}
                <PaginationItem>
                    <PaginationNext
                        href="#"
                        onClick={(e) => {
                            e.preventDefault();
                            if (current_page < total_pages) setPage(current_page + 1);
                        }}
                    />
                </PaginationItem>
            </PaginationContent>
        </Pagination>
    );
}

function SearchPageContent() {
    const [searchQuery, setSearchQuery] = useState('')
    const page_size = 12
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
                                        <a
                                            href={`/api/items/thumbnail/${result.sha256}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="block relative h-48 mb-2 overflow-hidden"
                                        >
                                            <Image
                                                src={`/api/items/thumbnail/${result.sha256}`}
                                                alt={`Result ${result.path}`}
                                                fill
                                                className="object-cover transition-transform duration-300 hover:scale-105"
                                                unoptimized={true}
                                            />
                                        </a>
                                        <p className="text-sm truncate">{result.path}</p>
                                        <p className="text-xs text-gray-500">{new Date(result.last_modified).toLocaleString()}</p>
                                        <BookmarkBtn sha256={result.sha256} />
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