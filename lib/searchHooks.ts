import { keepPreviousData } from "@tanstack/react-query"
import { $api } from "./api"
import { useSelectedDBs } from "./state/database"
import { useInstantSearch, useSearchLoading } from "./state/zust"
import { SearchQueryArgs } from "@/app/search/queryFns"
import {
  useQueryOptions,
  useSearchPage,
  useSearchQuery,
} from "./state/searchQuery/clientHooks"
import { components } from "./panoptikon"
import { getSearchPageURL } from "./state/searchQuery/serializers"
import { usePartitionBy } from "./state/partitionBy"
import { useEffect } from "react"

export function useSearch({ initialQuery }: { initialQuery: SearchQueryArgs }) {
  const isClient = typeof window !== "undefined"
  const searchQuery = isClient
    ? useSearchQuery()
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

  const nResults = countQuery.data?.count || 0
  return {
    data: {
      results: (data?.results as SearchResult[]) || [],
      count: nResults,
    },
    error,
    isError,
    refetch: refetchAll,
    isFetching,
    nResults,
    page,
    pageSize,
    setPage,
    getPageURL: getSearchPageURL,
    searchEnabled,
  }
}
