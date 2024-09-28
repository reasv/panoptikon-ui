import { QueryClient } from "@tanstack/react-query"
import { selectedDBsServer } from "@/lib/state/databaseServer"
import { fetchDB, fetchNs, fetchSearch, fetchStats } from "./queryFns"
import { getSearchQueryCache } from "@/lib/state/searchQuery/serverParsers"

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
    body: {
      ...searchQuery,
      results: true,
      count: false,
    },
  }

  const countRequest = {
    params: {
      query: dbs,
    },
    body: {
      ...searchQuery,
      page: 1,
      results: false,
      count: true,
    },
  }

  await queryClient.prefetchQuery({
    queryKey: ["post", "/api/search/pql", searchRequest],
    queryFn: () => fetchSearch(searchRequest),
  })
  await queryClient.prefetchQuery({
    queryKey: ["post", "/api/search/pql", countRequest],
    queryFn: () => fetchSearch(countRequest),
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
  return searchRequest
}
