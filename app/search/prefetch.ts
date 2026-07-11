import { QueryClient } from "@tanstack/react-query"
import { selectedDBsServer } from "@/lib/state/databaseServer"
import { fetchDB, fetchNs, fetchSearch, fetchStats } from "./queryFns"
import { getSearchQueryCache } from "@/lib/state/searchQuery/serverParsers"
import { partitionByParamsCache } from "@/lib/state/partitionByServer"
import { getServerClientConfig } from "@/lib/serverApi"

export const prefetchSearchPage = async (
  queryClient: QueryClient,
  searchParams: {
    [key: string]: string | string[] | undefined
  }
) => {
  const searchQuery = getSearchQueryCache(searchParams)
  const dbs = selectedDBsServer.parse(searchParams)
  const partitionBy = partitionByParamsCache.parse(searchParams)
  const searchRequest = {
    params: {
      query: dbs,
    },
    body: {
      ...searchQuery,
      results: true,
      count: false,
      partition_by: partitionBy.partition_by as any,
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
      partition_by: partitionBy.partition_by as any,
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
  // Token-echoed server-side fetch, so the config reflects the original
  // requester's policy. Seeding the query cache hydrates the client-side
  // useClientConfig() hook; on failure the cache is left empty and the
  // client refetches same-origin on mount.
  const clientConfig = await getServerClientConfig()
  if (clientConfig) {
    queryClient.setQueryData(["clientConfig"], clientConfig)
  }
  return { searchRequest, clientConfig }
}
