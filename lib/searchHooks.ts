import { keepPreviousData } from "@tanstack/react-query"
import { $api } from "./api"
import { useSelectedDBs } from "./state/database"
import {
  Mode,
  useSearchMode,
  useSimilarityQuery,
} from "./state/similarityQuery"
import { useImageSimilarity } from "./state/similarityStore"
import { useInstantSearch, useSearchQuery } from "./state/zust"
import { SearchQueryArgs } from "@/app/search/page"

export function useItemSimilaritySearch() {
  const [query, setQuery] = useSimilarityQuery()
  const [dbs, ___] = useSelectedDBs()
  const similarityQuery = useImageSimilarity((state) =>
    query.is_type == "clip"
      ? state.getClipQuery(query.is_model!)
      : state.getTextEmbedQuery(query.is_model!)
  )
  const instantSearch = useInstantSearch((state) => state.enabled)
  const validQuery = !!(
    query.is_item &&
    query.is_item.length > 0 &&
    query.is_model &&
    query.is_model.length > 0
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
          sha256: query.is_item || "",
        },
      },
      body: {
        ...similarityQuery,
        setter_name: query.is_model!,
        page: query.is_page,
        page_size: query.is_page_size,
        full_count: true,
      },
    },
    {
      enabled: instantSearch && validQuery && mode === Mode.ItemSimilarity,
      placeholderData: keepPreviousData,
    }
  )

  const nResults = data?.count || 0
  const page = query.is_page
  const pageSize = similarityQuery.page_size
  const setPage = (page: number) => setQuery({ is_page: page })
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
    searchEnabled: validQuery,
  }
}

export function useSearch({ initialQuery }: { initialQuery: SearchQueryArgs }) {
  const isClient = typeof window !== "undefined"
  const searchQuery = isClient
    ? useSearchQuery((state) => state.getSearchQuery())
    : initialQuery.body
  const dbs = isClient ? useSelectedDBs()[0] : initialQuery.params.query
  const setPage = useSearchQuery((state) => state.setPage)
  const page = useSearchQuery((state) => state.order_args.page)
  const pageSize = useSearchQuery((state) => state.order_args.page_size)
  const searchEnabled = useSearchQuery((state) => state.enable_search)
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
    searchEnabled,
  }
}
