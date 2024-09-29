"use server"
import {
    dehydrate,
    HydrationBoundary,
    QueryClient,
} from '@tanstack/react-query'
import { ScanPage } from './ScanPage';

export default async function SearchPage({
    searchParams,
}: {
    searchParams: { [key: string]: string | string[] | undefined };
}) {
    const queryClient = new QueryClient()

    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <ScanPage />
        </HydrationBoundary>
    )
}