import { QueryClient } from "@tanstack/react-query"
import { selectedDBsServer } from "@/lib/state/databaseServer"
import {
  fetchDB,
  fetchNs,
  fetchSearch,
  fetchSimilarity,
  fetchStats,
} from "./queryFns"
import { getSearchQueryCache } from "@/lib/state/searchQuery/serverParsers"
import {
  getSimilarityOptionsCache,
  getSimilarityQueryCache,
} from "@/lib/state/similarityQuery/serverParser"
import { getSearchMode, Mode } from "@/lib/state/searchMode"

export const prefetchSearchPage = async (
  queryClient: QueryClient,
  searchParams: {
    [key: string]: string | string[] | undefined
  }
) => {
  const searchQuery = getSearchQueryCache(searchParams)
  const dbs = selectedDBsServer.parse(searchParams)
  const searchRequest = {
    params: {
      query: dbs,
    },
    body: searchQuery,
  }

  await queryClient.prefetchQuery({
    queryKey: ["post", "/api/search", searchRequest],
    queryFn: () => fetchSearch(searchRequest),
  })

  const similarityQuery = getSimilarityQueryCache(searchParams)
  const similarityOptions = getSimilarityOptionsCache(searchParams)
  const similarityRequest = {
    params: {
      query: dbs,
      path: {
        sha256: similarityOptions.item || "",
      },
    },
    body: {
      ...similarityQuery,
      full_count: true,
    },
  }
  const searchMode = getSearchMode(searchParams).mode
  if (searchMode === Mode.ItemSimilarity) {
    await queryClient.prefetchQuery({
      queryKey: ["post", "/api/search/similar/{sha256}", similarityRequest],
      queryFn: () => fetchSimilarity(similarityRequest),
    })
  }

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
  return searchRequest
}