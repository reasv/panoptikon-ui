'use client'

import { useState } from 'react'
import { useMutation, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Image from 'next/image'

interface SearchResult {
    path: string
    sha256: string
    last_modified: string
    type: string
}

interface SearchResponse {
    count: number
    results: SearchResult[]
}

const searchAPI = async (query: string): Promise<SearchResponse> => {
    const response = await fetch('/api/search', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            query: {
                filters: {
                    any_text: {
                        extracted_text: {
                            query: query
                        }
                    }
                }
            },
            order_args: {
                order_by: "last_modified",
                order: "asc",
                page: 1,
                page_size: 10
            },
            count: true,
            check_path: true
        }),
    })

    if (!response.ok) {
        throw new Error('Network response was not ok')
    }

    return response.json()
}

function SearchPageContent() {
    const [searchQuery, setSearchQuery] = useState('')

    const { mutate, data: searchResponse, isLoading, isError, error } = useMutation({
        mutationFn: searchAPI,
    })

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault()
        if (searchQuery.trim()) {
            mutate(searchQuery)
        }
    }

    return (
        <div className="container mx-auto p-4">
            <h1 className="text-2xl font-bold mb-4">Search Page</h1>
            <form onSubmit={handleSearch} className="mb-4">
                <div className="flex gap-2">
                    <Input
                        type="text"
                        placeholder="Enter search query"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="flex-grow"
                    />
                    <Button type="submit" disabled={isLoading}>
                        {isLoading ? 'Searching...' : 'Search'}
                    </Button>
                </div>
            </form>

            {isLoading && <p>Loading...</p>}
            {isError && <p>Error occurred while fetching results: {(error as Error).message}</p>}

            {searchResponse && (
                <Card>
                    <CardHeader>
                        <CardTitle>Search Results (Total: {searchResponse.count})</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {searchResponse.results.map((result) => (
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
                                        />
                                    </a>
                                    <p className="text-sm truncate">{result.path}</p>
                                    <p className="text-xs text-gray-500">Last modified: {new Date(result.last_modified).toLocaleString()}</p>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {searchResponse && searchResponse.results.length === 0 && (
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