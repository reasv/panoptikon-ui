import {
  keepPreviousData,
  QueryClient,
  useQueryClient,
} from "@tanstack/react-query"
import { $api, fetchClient } from "./api"
import { useSelectedDBs } from "./state/database"
import { useBookmarkNs, useInstantSearch, useSearchLoading } from "./state/zust"
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

// Server-side page prefetching is worth it exactly when the query cost does
// not scale down with LIMIT — vector searches scan every candidate embedding
// regardless of page size, so the marginal cost of fetching extra pages in
// the same execution is noise. For cheap indexed queries it is a real tax,
// hence 0 there.
//
// Prefetch is a row budget, not a page count: execution cost is
// LIMIT-insensitive for vector queries and enrich is per-served-page, so a
// fixed ~320 cached rows costs the same whether that's 31 extra 10-row pages
// or 2 extra 100-row pages. At >= 320 rows/page prefetch drops to 0.
const VECTOR_PREFETCH_ROW_BUDGET = 320
const MAX_VECTOR_PREFETCH_PAGES = 32
const VECTOR_FILTER_KEYS = new Set([
  "image_embeddings",
  "text_embeddings",
  "similar_to",
])
export function hasVectorFilter(element: unknown): boolean {
  if (Array.isArray(element)) return element.some(hasVectorFilter)
  if (element && typeof element === "object") {
    return Object.entries(element).some(
      ([key, value]) => VECTOR_FILTER_KEYS.has(key) || hasVectorFilter(value)
    )
  }
  return false
}
export function prefetchPagesFor(
  query: components["schemas"]["PqlQuery"]["query"],
  pageSize: number | undefined
): number {
  if (!hasVectorFilter(query)) return 0
  const size = pageSize && pageSize > 0 ? pageSize : 10
  const pages = Math.floor(VECTOR_PREFETCH_ROW_BUDGET / size) - 1
  return Math.min(Math.max(pages, 0), MAX_VECTOR_PREFETCH_PAGES)
}

export function useSearch({ initialQuery }: { initialQuery: SearchQueryArgs }) {
  const isClient = typeof window !== "undefined"
  const searchQueryState = useSearchQuery()
  const { data: clientConfig } = useClientConfig()
  // ?? rather than ||: an explicit search_throttle_ms = 0 in the gateway
  // policy's [policies.client] table disables throttling
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
  // Bookmark status rides along with the results query (backend post-query
  // enrichment) so the grid's bookmark buttons never fire per-item GETs.
  const bookmarkNs = useBookmarkNs((state) => state.namespace)
  const liveRequest = {
    dbs,
    bookmarkNs,
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
        query: {
          ...request.dbs,
          include_bookmarks: true,
          bookmarks_namespace: request.bookmarkNs,
        },
      },
      body: {
        ...request.body,
        results: true,
        count: false,
        prefetch_pages: prefetchPagesFor(request.body.query, request.body.page_size),
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
        query: {
          ...liveRequest.dbs,
          include_bookmarks: true,
          bookmarks_namespace: liveRequest.bookmarkNs,
        },
      },
      body: {
        ...liveRequest.body,
        page: newPage,
        results: true,
        count: false,
        prefetch_pages: prefetchPagesFor(
          liveRequest.body.query,
          liveRequest.body.page_size
        ),
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
  const bookmarkNs = useBookmarkNs((state) => state.namespace)
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
        query: {
          ...dbs,
          include_bookmarks: true,
          bookmarks_namespace: bookmarkNs,
        },
      },
      body: {
        ...searchQuery,
        results: true,
        count: false,
        partition_by: partitionBy.partition_by as any,
        page,
        prefetch_pages: prefetchPagesFor(searchQuery.query, searchQuery.page_size),
      },
    }
    await prefetchSearch(searchRequest)
  }
  return prefetchSearchPage
}
