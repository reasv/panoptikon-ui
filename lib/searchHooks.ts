import {
  keepPreviousData,
  QueryClient,
  useQueryClient,
} from "@tanstack/react-query"
import { $api, fetchClient } from "./api"
import { useSelectedDBs } from "./state/database"
import { useInstantSearch, useSearchLoading } from "./state/zust"
import { SearchQueryArgs } from "@/app/search/queryFns"
import {
  useQueryOptions,
  useSearchPage,
  useSearchQuery,
  useSearchQueryState,
} from "./state/searchQuery/clientHooks"
import { components } from "./panoptikon"
import { getSearchPageURL } from "./state/searchQuery/serializers"
import { usePartitionBy } from "./state/partitionBy"
import { useEffect } from "react"
import { queryFromState } from "./state/searchQuery/searchQuery"
import { useThrottle } from "@uidotdev/usehooks"

export function useSearch({ initialQuery }: { initialQuery: SearchQueryArgs }) {
  const isClient = typeof window !== "undefined"
  const searchQueryState = useSearchQuery()
  const throttledSearchQueryState = useThrottle(searchQueryState, 250)
  const searchQuery = isClient
    ? throttledSearchQueryState
    : (initialQuery.body as Required<components["schemas"]["PQLQuery"]>)
  const dbs = isClient ? useSelectedDBs()[0] : initialQuery.params.query
  const [page, setPage] = useSearchPage()
  const pageSize = searchQuery.page_size
  const searchEnabled = useQueryOptions()[0].s_enable
  const instantSearch = useInstantSearch((state) => state.enabled)
  const [partitionBy] = usePartitionBy()
  const { data, error, isError, refetch, isFetching } = $api.useQuery(
    "post",
    "/api/search/pql",
    {
      params: {
        query: dbs,
      },
      body: {
        ...searchQuery,
        page,
        results: true,
        count: false,
        partition_by: partitionBy.partition_by,
      },
    },
    {
      enabled: searchEnabled && instantSearch,
      placeholderData: keepPreviousData,
    }
  )
  const countQuery = $api.useQuery(
    "post",
    "/api/search/pql",
    {
      params: {
        query: dbs,
      },
      body: {
        ...searchQuery,
        page: 1,
        results: false,
        count: true,
        partition_by: partitionBy.partition_by,
      },
    },
    {
      enabled: searchEnabled && instantSearch,
      placeholderData: keepPreviousData,
    }
  )

  const refetchAll = async () => {
    await refetch()
    await countQuery.refetch()
  }
  const [loading, setLoading] = useSearchLoading((state) => [
    state.loading,
    state.setLoading,
  ])

  useEffect(() => {
    let timer: NodeJS.Timeout
    if (isFetching) {
      timer = setTimeout(() => setLoading(true), 400)
    } else {
      setLoading(false)
    }
    return () => clearTimeout(timer)
  }, [isFetching])
  const queryClient = useQueryClient()
  const prefetchSearch = async (searchRequest: SearchQueryArgs) => {
    const timer = setTimeout(() => setLoading(true), 400)
    await queryClient.prefetchQuery({
      queryKey: ["post", "/api/search/pql", searchRequest],
      queryFn: () => fetchSearch(searchRequest),
    })
    clearTimeout(timer)
    setLoading(false)
  }
  const setPagePrefetch = async (newPage: number) => {
    const searchRequest = {
      params: {
        query: dbs,
      },
      body: {
        ...searchQuery,
        page: newPage,
        results: true,
        count: false,
        partition_by: partitionBy.partition_by,
      },
    }
    await prefetchSearch(searchRequest)
    setPage(newPage)
  }

  const nResults = countQuery.data?.count || 0
  return {
    data: {
      results: (data?.results as SearchResult[]) || [],
      count: nResults,
      result_metrics: data?.result_metrics || undefined,
      count_metrics: countQuery.data?.count_metrics || undefined,
    },
    error,
    isError,
    refetch: refetchAll,
    isFetching,
    nResults,
    page,
    pageSize,
    setPage: setPagePrefetch,
    getPageURL: getSearchPageURL,
    searchEnabled,
  }
}

export async function fetchSearch(args: SearchQueryArgs) {
  try {
    const { data, error } = await fetchClient.POST("/api/search/pql", {
      params: args.params,
      body: args.body,
    })
    if (!data || error) {
      console.error(error)
      console.log("Error fetching search results")
      throw error
    }
    return data
  } catch (error) {
    console.error(error)
    console.log("Error fetching search results")
    throw error
  }
}

export function usePrefetchSearch() {
  const queryClient = new QueryClient()
  const searchQueryState = useSearchQueryState()
  const dbs = useSelectedDBs()[0]
  const [partitionBy] = usePartitionBy()
  const [loading, setLoading] = useSearchLoading((state) => [
    state.loading,
    state.setLoading,
  ])
  const prefetchSearch = async (searchRequest: SearchQueryArgs) => {
    const timer = setTimeout(() => setLoading(true), 400)
    await queryClient.prefetchQuery({
      queryKey: ["post", "/api/search/pql", searchRequest],
      queryFn: () => fetchSearch(searchRequest),
    })
    clearTimeout(timer)
    setLoading(false)
  }
  const prefetchSearchPage = async (page: number) => {
    const searchQuery = queryFromState(searchQueryState)[0]
    const searchRequest = {
      params: {
        query: dbs,
      },
      body: {
        ...searchQuery,
        results: true,
        count: false,
        partition_by: partitionBy.partition_by as any,
        page,
      },
    }
    await prefetchSearch(searchRequest)
  }
  return prefetchSearchPage
}
