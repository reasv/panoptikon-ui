import { serverFetchClient } from '@/lib/api';
import { SearchPageContent } from './SearchPageContent'

import {
    dehydrate,
    HydrationBoundary,
    QueryClient,
} from '@tanstack/react-query'
import { components } from '@/lib/panoptikon';
import { initialDBOpts, initialSearchQueryState, queryFromState } from '@/lib/zust';

const defaultQuery: components["schemas"]["SearchQuery"] = queryFromState(initialSearchQueryState)
const defaultDBOpts = initialDBOpts

interface queryParams {
    index_db: string | null
    user_data_db: string | null
}
export async function fetchSearch(query: components["schemas"]["SearchQuery"], query_params: queryParams) {
    try {
        const { data, error } = await serverFetchClient.POST("/api/search", {
            params: {
                query: query_params,
            },
            body: query
        })
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
    const request = {
        params: {
            query: initialDBOpts,
        },
        body: defaultQuery
    }
    // We can use the queryClient to prefetch data
    await queryClient.prefetchQuery({
        queryKey: ["post", "/api/search", request],
        queryFn: () => fetchSearch(defaultQuery, defaultDBOpts),
    })

    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <SearchPageContent />
        </HydrationBoundary>
    )
}