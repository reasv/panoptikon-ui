import { SearchPageContent } from './SearchPageContent'

import {
    dehydrate,
    HydrationBoundary,
    QueryClient,
} from '@tanstack/react-query'
import { selectedDBsServer } from '@/lib/state/databaseServer';
import { fetchDB, fetchNs, fetchSearch, fetchSimilarity, fetchStats } from './queryFns';
import { getSearchQueryCache } from '@/lib/state/searchQuery/serverParsers';
import { getSimilarityOptionsCache, getSimilarityQueryCache } from '@/lib/state/similarityQuery/serverParser';
import { getSearchMode, Mode } from '@/lib/state/searchMode';
import { prefetchSearchPage } from './prefetch';

export default async function SearchPage({
    searchParams,
}: {
    searchParams: { [key: string]: string | string[] | undefined };
}) {
    const queryClient = new QueryClient()
    const request = await prefetchSearchPage(queryClient, searchParams)

    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <SearchPageContent initialQuery={request} />
        </HydrationBoundary>
    )
}