import { serverFetchClient } from '@/lib/api';
import { SearchPageContent } from './SearchPageContent'

import {
    dehydrate,
    HydrationBoundary,
    QueryClient,
} from '@tanstack/react-query'
import { components } from '@/lib/panoptikon';
import { initialDBOpts, initialSearchQueryState, queryFromState, SearchQueryStateState } from '@/lib/zust';
import { decodeQueryParam } from '@/lib/decodeQuery';

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

export default async function SearchPage({
    searchParams,
}: {
    searchParams?: { [key: string]: string | string[] | undefined };
}) {
    const decodedQueryState = decodeQueryParam<SearchQueryStateState>("query", searchParams)
    const decodedDBs = decodeQueryParam<queryParams>("db", searchParams)
    const query = queryFromState(decodedQueryState || initialSearchQueryState)
    const dbs = decodedDBs || initialDBOpts
    const request = {
        params: {
            query: dbs,
        },
        body: query
    }

    const queryClient = new QueryClient()
    await queryClient.prefetchQuery({
        queryKey: ["post", "/api/search", request],
        queryFn: () => fetchSearch(query, dbs),
    })

    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <SearchPageContent />
        </HydrationBoundary>
    )
}