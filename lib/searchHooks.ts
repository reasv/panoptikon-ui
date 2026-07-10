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
import { useThrottledValue } from "./useThrottledValue"
import { useClientConfig } from "./useClientConfig"

export function useSearch({ initialQuery }: { initialQuery: SearchQueryArgs }) {
  const isClient = typeof window !== "undefined"
  const searchQueryState = useSearchQuery()
  const { data: clientConfig } = useClientConfig()
  // ?? rather than ||: an explicit SEARCH_THROTTLE_MS=0 disables throttling
  const throttleMs = clientConfig?.searchThrottleMs ?? 500
  const searchQuery = isClient
    ? searchQueryState
    : (initialQuery.body as Required<components["schemas"]["PqlQuery"]>)
  const dbs = isClient ? useSelectedDBs()[0] : initialQuery.params.query
  const [page, setPage] = useSearchPage()
  const searchEnabled = useQueryOptions()[0].s_enable
  const instantSearch = useInstantSearch((state) => state.enabled)
  const [partitionBy] = usePartitionBy()
  // The request is throttled as a single unit — filters, page, partitioning
  // and database selection together — so a partially-updated "hybrid" query
  // (e.g. new page + stale filters) can never reach the backend. The throttle
  // fires on the leading edge, so an isolated change (a click, a toggle, a
  // page turn) still queries instantly; only rapid successions (typing,
  // slider drags) are coalesced.
  const liveRequest = {
    dbs,
    body: {
      ...searchQuery,
      page,
      partition_by: partitionBy.partition_by,
    },
  }
  const throttledRequest = useThrottledValue(liveRequest, throttleMs)
  const request = throttleMs > 0 ? throttledRequest : liveRequest
  // page_size is optional in the spec (server default 10); the query
  // builders always set it, but the type can't promise that.
  const pageSize = request.body.page_size ?? 10
  const { data, error, isError, refetch, isFetching } = $api.useQuery(
    "post",
    "/api/search/pql",
    {
      params: {
        query: request.dbs,
      },
      body: {
        ...request.body,
        results: true,
        count: false,
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
        query: request.dbs,
      },
      body: {
        ...request.body,
        page: 1,
        results: false,
        count: true,
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
  const setLoading = useSearchLoading((state) => state.setLoading)

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
    // Built from the live request: after setPage the throttle propagates the
    // live content on its leading edge, so this is the key the query will use
    const searchRequest = {
      params: {
        query: liveRequest.dbs,
      },
      body: {
        ...liveRequest.body,
        page: newPage,
        results: true,
        count: false,
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
  const setLoading = useSearchLoading((state) => state.setLoading)
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
