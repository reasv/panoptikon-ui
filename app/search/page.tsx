import { serverFetchClient } from '@/lib/api';
import { SearchPageContent } from './SearchPageContent'

import {
    dehydrate,
    HydrationBoundary,
    QueryClient,
} from '@tanstack/react-query'
import { components } from '@/lib/panoptikon';
import { initialSearchQueryState, queryFromState, SearchQueryStateState } from '@/lib/state/zust';
import { decodeQueryParam } from '@/lib/decodeQuery';
import { selectedDBsServer } from '@/lib/state/databaseServer';

interface queryParams {
    index_db: string | null
    user_data_db: string | null
}
export interface SearchQueryArgs {
    params: {
        query: queryParams
    }
    body: components["schemas"]["SearchQuery"]
}
export async function fetchSearch(args: SearchQueryArgs) {
    try {
        const { data, error } = await serverFetchClient.POST("/api/search", {
            params: args.params,
            body: args.body
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

export async function fetchStats(args: {
    index_db?: string | null;
    user_data_db?: string | null;
}) {
    try {
        const { data, error } = await serverFetchClient.GET("/api/search/stats", {
            params: {
                query: {
                    index_db: args.index_db,
                    user_data_db: args.user_data_db
                }
            }
        })
        if (!data || error) {
            console.error(error)
            throw error
        }
        return data
    } catch (error) {
        console.error(error)
        throw error
    }
}

export default async function SearchPage({
    searchParams,
}: {
    searchParams: { [key: string]: string | string[] | undefined };
}) {
    const decodedQueryState = decodeQueryParam<SearchQueryStateState>("query", searchParams)
    const query = queryFromState(decodedQueryState || initialSearchQueryState)
    const dbs = selectedDBsServer.parse(searchParams)
    const request = {
        params: {
            query: dbs,
        },
        body: query
    }

    const queryClient = new QueryClient()
    await queryClient.prefetchQuery({
        queryKey: ["post", "/api/search", request],
        queryFn: () => fetchSearch(request),
    })

    const statsRequest = {
        params: {
            query: {
                ...dbs,
            },
        },
    }
    await queryClient.prefetchQuery({
        queryKey: ["get", "/api/search/stats", statsRequest],
        queryFn: () => fetchStats(dbs),
    })

    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <SearchPageContent initialQuery={request} />
        </HydrationBoundary>
    )
}