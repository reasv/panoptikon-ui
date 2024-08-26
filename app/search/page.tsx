import { serverFetchClient } from '@/lib/api';
import SearchPageWrapper from './SearchPageContent'

import {
    dehydrate,
    HydrationBoundary,
    QueryClient,
} from '@tanstack/react-query'
import { components } from '@/lib/panoptikon';

const defaultQuery: components["schemas"]["SearchQuery"] = {
    "order_args": {
        "order_by": "last_modified",
        "order": null,
        "page": 1,
        "page_size": 9
    },
    "count": true,
    "check_path": true,
    "query": {
        "filters": {
            "any_text": {}
        }
    }
}

const defaultArgs = {
    "params": {
        "query": {
            "index_db": null,
            "user_data_db": null
        }
    },
    "body": defaultQuery
}

export async function fetchSearch() {
    try {
        const { data, error } = await serverFetchClient.POST("/api/search", defaultArgs)
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

export default async function SearchPage() {
    const queryClient = new QueryClient()

    // We can use the queryClient to prefetch data
    await queryClient.prefetchQuery({
        queryKey: ["post", "/api/search", defaultArgs],
        queryFn: () => fetchSearch(),
    })

    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <SearchPageWrapper />
        </HydrationBoundary>
    )
}