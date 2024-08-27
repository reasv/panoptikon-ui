import { serverFetchClient } from '@/lib/api';
import { SearchPageContent } from './SearchPageContent'

import {
    dehydrate,
    HydrationBoundary,
    QueryClient,
} from '@tanstack/react-query'
import { components } from '@/lib/panoptikon';
import { initialSearchQueryState, queryFromState } from '@/lib/zust';

const defaultQuery: components["schemas"]["SearchQuery"] = queryFromState(initialSearchQueryState)

export async function fetchSearch(query: components["schemas"]["SearchQuery"]) {
    try {
        const { data, error } = await serverFetchClient.POST("/api/search", query)
        if (!data || error) {
            console.error(error)
            console.log("Error fetching search results")
            throw error
        }
        console.log("Fetched search results successfully")
        return data
    } catch (error) {
        console.error(error)
        console.log("Error fetching search results")
        throw error
    }
}

export default async function SearchPage() {
    const queryClient = new QueryClient()

    // We can use the queryClient to prefetch data
    await queryClient.prefetchQuery({
        queryKey: ["post", "/api/search", defaultQuery],
        queryFn: () => fetchSearch(defaultQuery),
    })

    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <SearchPageContent />
        </HydrationBoundary>
    )
}