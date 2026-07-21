import { hashKey, keepPreviousData, useQueryClient } from "@tanstack/react-query"
import { $api, fetchClient } from "./api"
import { useSelectedDBs } from "./state/database"
import { useBookmarkNs, useInstantSearch, useSearchLoading } from "./state/zust"
import { SearchQueryArgs } from "@/app/search/queryFns"
import {
  usePageSizeRaw,
  useQueryOptions,
  useSearchPage,
  useSearchPageRaw,
  useSearchQuery,
} from "./state/searchQuery/clientHooks"
import { components } from "./panoptikon"
import { getSearchPageURL } from "./state/searchQuery/serializers"
import { usePartitionBy } from "./state/partitionBy"
import { useEffect, useRef } from "react"
import { useThrottledValue } from "./useThrottledValue"
import { useGalleryIndex, usePinboardMaximized } from "./state/gallery"
import { useGridScrollAnchor } from "./state/gridScroll"
import { useClientConfig } from "./useClientConfig"
import { buildCountRequest, buildResultsRequest } from "./searchRequest"

// The request builders live in lib/searchRequest.ts so the server-side
// prefetch (app/search/prefetch.ts, which cannot call hooks) can build the
// exact same requests. Re-exported here for the callers that already import
// them from this module.
export {
  COUNT_QUERY_PAGE_SIZE,
  hasVectorFilter,
  prefetchRowsFor,
} from "./searchRequest"

/**
 * The query the update lock considers *committed*, as a request hash.
 *
 * With the lock off there is nothing to withhold, so the live query is always
 * the committed one — which also means that turning the lock on freezes
 * exactly what is on screen. With the lock on, the committed query only moves
 * when something calls `commit()`: an edit in the sidebar changes the live
 * query without committing it, and the search stays where it was.
 *
 * Derived during render rather than in an effect. An effect would leave one
 * render gating the search on a stale answer, and that render is visible: it
 * is either a query that fires when it shouldn't or a results pane that
 * blanks when it shouldn't.
 */
function useCommittedQueryKey(
  liveKey: string,
  instantSearch: boolean,
  commitToken: number
): string {
  const committed = useRef(liveKey)
  const seenToken = useRef(commitToken)
  if (instantSearch || seenToken.current !== commitToken) {
    committed.current = liveKey
  }
  seenToken.current = commitToken
  return committed.current
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
  const serverDBs = initialQuery.params.query
  const dbs = isClient
    ? useSelectedDBs()[0]
    : {
        index_db: serverDBs.index_db,
        user_data_db: serverDBs.user_data_db,
      }
  const [page, setPage] = useSearchPage()
  const searchEnabled = useQueryOptions()[0].s_enable
  const instantSearch = useInstantSearch((state) => state.enabled)
  const commitToken = useInstantSearch((state) => state.commitToken)
  // A maximized board hides every consumer of these results, so running the
  // search buys nothing — and for an embedding query it costs a model load.
  // keepPreviousData below means whatever was fetched before maximizing
  // stays in hand, so restoring the board size shows it immediately while
  // the now-stale query refetches. See lib/state/pinboardView.ts.
  const pinboardMaximized = usePinboardMaximized()
  const [partitionBy] = usePartitionBy()
  // The request is throttled as a single unit — filters, page, partitioning
  // and database selection together — so a partially-updated "hybrid" query
  // (e.g. new page + stale filters) can never reach the backend. The throttle
  // fires on the leading edge, so an isolated change (a click, a toggle, a
  // page turn) still queries instantly; only rapid successions (typing,
  // slider drags) are coalesced.
  const bookmarkNs = useBookmarkNs((state) => state.namespace)
  const liveRequest = {
    searchQuery,
    dbs,
    bookmarkNs,
    partitionBy: partitionBy.partition_by,
    page,
  }
  const throttledRequest = useThrottledValue(liveRequest, throttleMs)
  const request = throttleMs > 0 ? throttledRequest : liveRequest
  // page_size is optional in the spec (server default 10); the query
  // builders always set it, but the type can't promise that.
  const pageSize = request.searchQuery.page_size ?? 10
  // Gated on the *live* request, not the throttled one: the throttle trails
  // by a render, and during that render the query key is still the previously
  // committed one — already in cache, so leaving it enabled costs nothing.
  const liveKey = hashKey([liveRequest])
  const committedKey = useCommittedQueryKey(liveKey, instantSearch, commitToken)
  const queryEnabled =
    searchEnabled &&
    (instantSearch || committedKey === liveKey) &&
    !pinboardMaximized
  // Spread, not passed straight through: openapi-react-query's init type wants
  // an index signature, which a named interface doesn't carry. The spread is
  // shallow and the key is hashed by value, so it changes nothing at runtime.
  const { data, error, isError, refetch, isFetching, isPlaceholderData } = $api.useQuery(
    "post",
    "/api/search/pql",
    { ...buildResultsRequest(request, { page: request.page }) },
    {
      enabled: queryEnabled,
      placeholderData: keepPreviousData,
    }
  )
  const countQuery = $api.useQuery(
    "post",
    "/api/search/pql",
    { ...buildCountRequest(request) },
    {
      enabled: queryEnabled,
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

  const prefetchPageState = usePrefetchPageState()
  const setPagePrefetch = async (newPage: number) => {
    // Warm the cache for the page being turned to before the URL says we are
    // on it, so the flip and the results swap land in the same render
    await prefetchPageState({ page: newPage })
    setPage(newPage)
  }

  // Do the results in hand belong to the page the URL currently names?
  //
  // Two ways they can't. react-query's keepPreviousData keeps the last page
  // rendered while a new key loads (isPlaceholderData). And the throttle
  // propagates in an effect, so even a fully cached page arrives one render
  // after the URL moved — a warm cache shortens that window but cannot remove
  // it. Anything that positions itself *within* the results (the grid's scroll
  // anchor, the gallery's index) must sit still until this is false, or it
  // resolves a position against rows that don't correspond to it.
  //
  // `isPlaceholderData` needs the fetching guard: a disabled query (instant
  // search off, invalid input, maximized board) still swaps to placeholder
  // data when its key changes, and with nothing in flight it stays there
  // forever. Left ungated, editing the query with instant search off would
  // freeze the gallery and the grid anchor until the user pressed Enter.
  const livePageSize = liveRequest.searchQuery.page_size ?? 10
  const resultsAreStale =
    (isPlaceholderData && (queryEnabled || isFetching)) ||
    request.page !== liveRequest.page ||
    pageSize !== livePageSize

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
    resultsAreStale,
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

/** A page of results to move to: a page number, optionally at a new size. */
interface PageState {
  page: number
  /** Omitted means "whatever the URL currently says". */
  pageSize?: number
}

/**
 * Builds the results request for a page state, from the same URL state
 * `useSearch` derives its live query from — so the key this produces is the
 * key that query will use once the URL catches up. That identity is the whole
 * point of prefetching: build it anywhere else and the warmed entry is dead
 * weight under a key nothing reads.
 */
function useSearchRequestFor(): (target: PageState) => SearchQueryArgs {
  const searchQuery = useSearchQuery()
  const dbs = useSelectedDBs()[0]
  const bookmarkNs = useBookmarkNs((state) => state.namespace)
  const [partitionBy] = usePartitionBy()
  return ({ page, pageSize }) =>
    buildResultsRequest(
      { searchQuery, dbs, bookmarkNs, partitionBy: partitionBy.partition_by },
      { page, pageSize }
    )
}

/**
 * Warm the react-query cache for a page state before the URL moves to it.
 * Standalone (not a `useSearch` return value) because the page-size control
 * lives in the sidebar, outside the component that runs the search.
 */
export function usePrefetchPageState() {
  const queryClient = useQueryClient()
  const buildRequest = useSearchRequestFor()
  const setLoading = useSearchLoading((state) => state.setLoading)
  return async (target: PageState) => {
    const searchRequest = buildRequest(target)
    const timer = setTimeout(() => setLoading(true), 400)
    try {
      await queryClient.prefetchQuery({
        queryKey: ["post", "/api/search/pql", searchRequest],
        queryFn: () => fetchSearch(searchRequest),
      })
    } finally {
      clearTimeout(timer)
      setLoading(false)
    }
  }
}

/**
 * An in-page index, brought inside a page of `pageSize` rows. A page size
 * below 1 is a single unbounded page, so nothing to clamp against.
 */
function clampToPage(index: number, pageSize: number): number {
  const floored = Math.max(index, 0)
  return pageSize >= 1 ? Math.min(floored, pageSize - 1) : floored
}

/**
 * Where the item at `anchor` on the current page lands once the page size
 * becomes `nextPageSize`. The global index of a result is
 * `(page - 1) * page_size + index_in_page` and that mapping is page-size
 * independent on this backend (pagination is appended to pagination-free SQL,
 * never compiled into it), so the item is simply re-expressed in the new
 * geometry — see docs/page-size-remap-design.md.
 *
 * A page size below 1 means "no pagination", which is treated as a single
 * unbounded page rather than special-cased: both directions then fall out of
 * the same arithmetic.
 */
export function remapPageAnchor({
  page,
  pageSize,
  nextPageSize,
  anchor,
}: {
  page: number
  pageSize: number
  nextPageSize: number
  anchor: number
}): { page: number; index: number } {
  const oldSize = pageSize >= 1 ? pageSize : Infinity
  const newSize = nextPageSize >= 1 ? nextPageSize : Infinity
  const oldPage = oldSize === Infinity ? 1 : Math.max(page, 1)
  const index = Math.max(anchor, 0)
  // Guarded rather than written as `(oldPage - 1) * oldSize`: that is
  // `0 * Infinity` — NaN — on the unpaginated page.
  const global = oldPage > 1 ? (oldPage - 1) * oldSize + index : index
  if (newSize === Infinity) return { page: 1, index: global }
  return { page: Math.floor(global / newSize) + 1, index: global % newSize }
}

/**
 * Change the page size while keeping the user on the same item.
 *
 * Prefetch first, then write: the results should be in hand by the time the
 * URL names them. It still isn't atomic — the request throttle propagates in
 * an effect, so the query key trails the URL by a commit either way — which is
 * what `resultsAreStale` is for.
 *
 * Every write is `history: "replace"`, and explicitly so on each one — nuqs
 * escalates the whole batch to `push` if any member asks for it. None of
 * these are navigation: they are one position re-expressed at a new page
 * size, the same reasoning that already makes the grid anchor replace-mode.
 * The cost is that Back no longer undoes a page-size change.
 */
export function useCommitPageSize() {
  const prefetch = usePrefetchPageState()
  const [page, setPage] = useSearchPageRaw()
  const [pageSize, setPageSize] = usePageSizeRaw()
  const [galleryIndex, setGalleryIndex] = useGalleryIndex()
  const [scrollAnchor, setScrollAnchor] = useGridScrollAnchor()
  // The target of a commit that has been computed but not yet written, so a
  // second click during the first one's prefetch composes onto it instead of
  // remapping from the same base twice. The +/- buttons commit per click, so
  // two clicks inside one round trip is ordinary use, not an edge case.
  const inFlight = useRef<{
    page: number
    pageSize: number
    index: number
  } | null>(null)
  return async (nextPageSize: number) => {
    const base = inFlight.current ?? {
      page,
      pageSize,
      // The position to preserve: the open gallery's item, or the grid's
      // scroll anchor (absent while the top row is still visible, hence the
      // 0). Clamped into the current page, so a hand-written or stale URL
      // whose index points past the end remaps from the item actually on
      // screen — both surfaces clamp for display — rather than from a global
      // index pages away from it.
      index: clampToPage(
        galleryIndex !== null ? galleryIndex : scrollAnchor ?? 0,
        pageSize
      ),
    }
    if (nextPageSize === base.pageSize) return
    const target = remapPageAnchor({
      page: base.page,
      pageSize: base.pageSize,
      nextPageSize,
      anchor: base.index,
    })
    const token = { page: target.page, pageSize: nextPageSize, index: target.index }
    inFlight.current = token
    await prefetch({ page: target.page, pageSize: nextPageSize })
    // A later click superseded this one while its prefetch was in the air:
    // that call owns the write, and it already composed onto this target.
    if (inFlight.current !== token) return
    inFlight.current = null
    const replace = { history: "replace" as const }
    // Written in one tick so nuqs coalesces them into a single URL update —
    // one history entry, one render, one query. Unchanged values are skipped:
    // a setter called with what it already holds can still produce a history
    // entry for an identical URL.
    // Compared against the live params, not `base`: when this commit composed
    // onto an in-flight one, that one's writes never happened, so `base` names
    // a page the URL was never on. Skipping on it drops a write that is not a
    // no-op and strands the URL on the old page.
    const writes: Promise<unknown>[] = []
    if (target.page !== page) writes.push(setPage(target.page, replace))
    if (galleryIndex !== null && target.index !== galleryIndex) {
      writes.push(setGalleryIndex(target.index, replace))
    }
    // Set even with the gallery open: the grid is unmounted then, and this is
    // what puts it back in the right place on close.
    const nextAnchor = target.index > 0 ? target.index : null
    if (nextAnchor !== scrollAnchor) writes.push(setScrollAnchor(nextAnchor, replace))
    writes.push(setPageSize(nextPageSize, replace))
    await Promise.all(writes)
  }
}
