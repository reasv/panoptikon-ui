import { keepPreviousData } from "@tanstack/react-query"
import { $api } from "./api"
import { useSelectedDBs } from "./state/database"
import { Mode, useSearchMode } from "./state/searchMode"
import { useInstantSearch } from "./state/zust"
import { SearchQueryArgs } from "@/app/search/queryFns"
import {
  useQueryOptions,
  useSearchPage,
  useSearchQuery,
} from "./state/searchQuery/clientHooks"
import { components } from "./panoptikon"
import {
  useItemSimilarityOptions,
  useSimilarityQuery,
} from "./state/similarityQuery/clientHooks"
import { getSimilarityPageURL } from "./state/similarityQuery/serializers"
import { getSearchPageURL } from "./state/searchQuery/serializers"

export function useItemSimilaritySearch() {
  const query = useSimilarityQuery()
  const [queryOptions, setQueryOptions] = useItemSimilarityOptions()
  const [dbs, ___] = useSelectedDBs()
  const instantSearch = useInstantSearch((state) => state.enabled)
  const validQuery = !!(
    queryOptions.item &&
    queryOptions.item.length > 0 &&
    queryOptions.setter_name &&
    queryOptions.setter_name.length > 0
  )
  const [mode, _] = useSearchMode()
  const { data, refetch, isFetching, isError, error } = $api.useQuery(
    "post",
    "/api/search/similar/{sha256}",
    {
      params: {
        query: {
          ...dbs,
        },
        path: {
          sha256: queryOptions.item || "",
        },
      },
      body: {
        ...query,
        full_count: true,
      },
    },
    {
      enabled: validQuery && mode === Mode.ItemSimilarity,
      placeholderData: keepPreviousData,
    }
  )

  const nResults = data?.count || 0
  const page = query.page
  const pageSize = query.page_size
  const setPage = (page: number) => setQueryOptions({ page: page })
  return {
    data,
    error,
    isError,
    refetch,
    isFetching,
    nResults,
    page,
    pageSize,
    setPage,
    getPageURL: getSimilarityPageURL,
    searchEnabled: validQuery,
  }
}

export function useSearch({ initialQuery }: { initialQuery: SearchQueryArgs }) {
  const isClient = typeof window !== "undefined"
  const searchQuery = isClient
    ? useSearchQuery()
    : (initialQuery.body as Required<components["schemas"]["SearchQuery"]>)
  const dbs = isClient ? useSelectedDBs()[0] : initialQuery.params.query
  const [page, setPage] = useSearchPage()
  const pageSize = searchQuery.order_args.page_size
  const searchEnabled = useQueryOptions()[0].s_enable
  const instantSearch = useInstantSearch((state) => state.enabled)
  const [mode, _] = useSearchMode()
  const { data, error, isError, refetch, isFetching } = $api.useQuery(
    "post",
    "/api/search",
    {
      params: {
        query: dbs,
      },
      body: {
        ...searchQuery,
      },
    },
    {
      enabled: searchEnabled && instantSearch && mode === Mode.Search,
      placeholderData: keepPreviousData,
    }
  )
  const nResults = data?.count || 0
  return {
    data,
    error,
    isError,
    refetch,
    isFetching,
    nResults,
    page,
    pageSize,
    setPage,
    getPageURL: getSearchPageURL,
    searchEnabled,
  }
}
