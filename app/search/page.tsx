import { SearchPageContent } from './SearchPage'

import {
    dehydrate,
    HydrationBoundary,
    QueryClient,
} from '@tanstack/react-query'
import { prefetchSearchPage } from './prefetch';

export default async function SearchPage({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const queryClient = new QueryClient()
    const { searchRequest, clientConfig } = await prefetchSearchPage(queryClient, await searchParams)
    // "Restricted" = the matched gateway policy's ruleset blocks scan/job
    // management; hide the scan drawer and related navigation. Purely
    // cosmetic — the gateway enforces the policy on every API call.
    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <SearchPageContent
                initialQuery={searchRequest}
                isRestrictedMode={clientConfig?.restrictedMode ?? false}
            />
        </HydrationBoundary>
    )
}