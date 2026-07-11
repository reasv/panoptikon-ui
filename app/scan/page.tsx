"use server"
import {
    dehydrate,
    HydrationBoundary,
    QueryClient,
} from '@tanstack/react-query'
import { ScanPage } from './ScanPage';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getServerClientConfig } from '@/lib/serverApi';

export default async function ScanPageRoot({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    // Runtime replacement for the old RESTRICTED_MODE build-time redirect:
    // when the matched gateway policy's ruleset blocks scan/job management
    // (capabilities.scan_jobs === false in /api/client-config, fetched
    // server-side with the policy token echoed), bounce to search. The
    // gateway would 403 every API call this page makes anyway.
    const clientConfig = await getServerClientConfig()
    if (clientConfig?.restrictedMode) {
        redirect("/search")
    }
    const queryClient = new QueryClient()

    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <Suspense>
                <ScanPage />
            </Suspense>
        </HydrationBoundary>
    )
}