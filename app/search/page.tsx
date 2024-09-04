import { SearchPageContent } from './SearchPageContent'

import {
    dehydrate,
    HydrationBoundary,
    QueryClient,
} from '@tanstack/react-query'
import { selectedDBsServer } from '@/lib/state/databaseServer';
import { fetchDB, fetchNs, fetchSearch, fetchStats } from './queryFns';
import { getSearchQueryCache } from '@/lib/state/searchQuery/serverParsers';

export default async function SearchPage({
    searchParams,
}: {
    searchParams: { [key: string]: string | string[] | undefined };
}) {
    const query = getSearchQueryCache(searchParams)
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