import { keepPreviousData } from "@tanstack/react-query"
import { $api } from "./api"
import { useSelectedDBs } from "./state/database"
import {
  Mode,
  useSearchMode,
  useSimilarityQuery,
} from "./state/similarityQuery"
import { useImageSimilarity } from "./state/similarityStore"
import { useInstantSearch } from "./state/zust"
import { SearchQueryArgs } from "@/app/search/queryFns"
import {
  useQueryOptions,
  useSearchPage,
  useSearchQuery,
} from "./state/searchQuery/clientHooks"
import { components } from "./panoptikon"

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
      enabled: validQuery && mode === Mode.ItemSimilarity,
      placeholderData: keepPreviousData,
    }
  )

  const nResults = data?.count || 0
  const page = query.is_page
  const pageSize = query.is_page_size
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
    searchEnabled,
  }
}
