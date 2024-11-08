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
    const request = await prefetchSearchPage(queryClient, await searchParams)
    const restrictedMode = process.env.RESTRICTED_MODE === "true"
    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <SearchPageContent
                initialQuery={request}
                isRestrictedMode={restrictedMode}
            />
        </HydrationBoundary>
    )
}