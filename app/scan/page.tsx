"use server"
import {
    dehydrate,
    HydrationBoundary,
    QueryClient,
} from '@tanstack/react-query'
import { ScanPage } from './ScanPage';
import { Suspense } from 'react';

export default async function ScanPageRoot({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const queryClient = new QueryClient()

    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <Suspense>
                <ScanPage />
            </Suspense>
        </HydrationBoundary>
    )
}