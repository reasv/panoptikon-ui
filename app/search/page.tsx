import { SearchPageContent } from './SearchPageContent'

import {
    dehydrate,
    HydrationBoundary,
    QueryClient,
} from '@tanstack/react-query'
import { initialSearchQueryState, queryFromState, SearchQueryStateState } from '@/lib/state/zust';
import { decodeQueryParam } from '@/lib/decodeQuery';
import { selectedDBsServer } from '@/lib/state/databaseServer';
import { fetchDB, fetchNs, fetchSearch, fetchStats } from './queryFns';

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

    const requestDBs = {
        params: {
            query: {
                ...dbs,
            },
        },
    }
    await queryClient.prefetchQuery({
        queryKey: ["get", "/api/search/stats", requestDBs],
        queryFn: () => fetchStats(dbs),
    })

    await queryClient.prefetchQuery({
        queryKey: ["get", "/api/bookmarks/ns", requestDBs],
        queryFn: () => fetchNs(dbs),
    })

    await queryClient.prefetchQuery({
        queryKey: ["get", "/api/db", null],
        queryFn: () => fetchDB(),
    })
    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <SearchPageContent initialQuery={request} />
        </HydrationBoundary>
    )
}