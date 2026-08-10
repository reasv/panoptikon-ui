import {
  hashKey,
  keepPreviousData,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query"
import { $api, fetchClient } from "./api"
import { useSelectedDBs } from "./state/database"
import { useBookmarkNs, useInstantSearch, useSearchLoading } from "./state/zust"
import { SearchQueryArgs } from "@/app/search/queryFns"
import {
  usePageSize,
  usePageSizeRaw,
  useQueryOptions,
  useSearchPage,
  useSearchPageRaw,
  useSearchQuery,
} from "./state/searchQuery/clientHooks"
import type { components } from "./panoptikon"
import { getSearchPageURL } from "./state/searchQuery/serializers"
import { usePartitionBy } from "./state/partitionBy"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useThrottledValue } from "./useThrottledValue"
import {
  useGalleryIndex,
  usePinboardMaximized,
  useViewMode,
} from "./state/gallery"
import type { ViewMode } from "./state/gallery"
import { useGridScrollAnchor } from "./state/gridScroll"
import { useClientConfig } from "./useClientConfig"
import {
  buildChunkRequest,
  buildCountRequest,
  buildResultsRequest,
  SCROLL_CHUNK_SIZE,
  type SearchRequestParts,
} from "./searchRequest"
import {
  chunkIndexOf,
  chunkOffsetOf,
  chunkRangeFor,
  clampToPage,
  pageStateFromScrollAnchor,
  remapPageAnchor,
  scrollAnchorFromPage,
} from "./scrollMode"

// The request builders live in lib/searchRequest.ts so the server-side
// prefetch (app/search/prefetch.ts, which cannot call hooks) can build the
// exact same requests. Re-exported here for the callers that already import
// them from this module.
export {
  COUNT_QUERY_PAGE_SIZE,
  hasVectorFilter,
  prefetchRowsFor,
} from "./searchRequest"

// The page/anchor arithmetic moved to lib/scrollMode.ts, which imports
// nothing: the mode switch and the page-size remap are the same computation
// seen from two sides, and both have to be executable outside a bundler for
// scripts/scrollmode.test.mjs to assert the invariant they share. Re-exported
// so the hooks' callers keep one import site.
export { remapPageAnchor } from "./scrollMode"

/**
 * The query the update lock considers *committed*: its request hash, plus
 * whatever request value the caller wants frozen to the same moment.
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
 *
 * The always-mounted caller (`useSearch`) gates on the *key*: its query keeps
 * the previous answer in cache, so withholding is enough. A consumer that
 * mounts on demand cannot do that — a ref seeded at mount time is trivially
 * equal to the live key, which is precisely the uncommitted query it must not
 * run — so it needs the committed *value* instead, and must be handed it from
 * here rather than re-deriving it. Hence one hook returning both.
 */
function useCommittedQuery<T>(
  liveKey: string,
  liveValue: T,
  instantSearch: boolean,
  commitToken: number
): { key: string; value: T } {
  const committed = useRef({ key: liveKey, value: liveValue })
  const seenToken = useRef(commitToken)
  if (instantSearch || seenToken.current !== commitToken) {
    committed.current = { key: liveKey, value: liveValue }
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
  // The frozen value is taken from the *live* request, not the throttled one:
  // a commit lands on the render that bumps the token, and the throttle is
  // still a render behind then — freezing the trailing value would leave the
  // library running the previous query until the next commit. Consumers
  // throttle what they get from here, which reproduces this query's own
  // "throttled, once live == committed" behaviour.
  const { key: committedKey, value: committedQuery } = useCommittedQuery(
    liveKey,
    { searchQuery: liveRequest.searchQuery, dbs: liveRequest.dbs },
    instantSearch,
    commitToken
  )
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
    // For on-demand consumers of the same search (the grid's Library tab):
    // the query this hook would run, gated by the update lock exactly as this
    // hook gates its own. See useCommittedQuery.
    committedQuery,
    resultsAreStale,
    nResults,
    page,
    pageSize,
    setPage: setPagePrefetch,
    getPageURL: getSearchPageURL,
    searchEnabled,
    // Whether the LIVE query is actually being served — false while the
    // update lock withholds uncommitted edits, while input is invalid, or
    // while a maximized board suspends searching. Distinct from
    // `resultsAreStale` (rows lagging the URL): here the rows on screen are
    // deliberately NOT the live query's, so anything that acts on the search
    // unattended (the gallery's auto-advance page turn, its ahead-of-turn
    // prefetch — docs/video-end-action-design.md §3) must stand down, or it
    // would fetch and land on a search the user explicitly withheld.
    queryEnabled,
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
  // `gcTime`: an unobserved prefetched entry is garbage-collected after
  // react-query's default 5 minutes. The manual page turn consumes its entry
  // immediately, so it never cares; the gallery's ahead-of-turn prefetch
  // (docs/video-end-action-design.md §3) fires when a video STARTS and is
  // consumed when it ENDS, so a video longer than the default would evict
  // the very entry it warmed — that caller passes a horizon that outlives
  // any plausible video.
  return async (
    target: PageState,
    opts?: { gcTime?: number; silent?: boolean }
  ) => {
    const searchRequest = buildRequest(target)
    const warm = () =>
      queryClient.prefetchQuery({
        queryKey: ["post", "/api/search/pql", searchRequest],
        queryFn: () => fetchSearch(searchRequest),
        gcTime: opts?.gcTime,
      })
    // `silent`: no spinner at all, neither armed nor cleared. A background
    // warm with no gesture behind it must be invisible — the gallery's
    // ahead-of-turn prefetch fires while a video is playing, and the spinner
    // it would arm is the full-panel overlay painted OVER that video (and
    // over the clicks aimed at it) until the fetch resolves. The unattended
    // `finally` is just as wrong in the other direction: it would clear a
    // spinner the live search armed. The spinner path stays for the manual
    // page turn and the page-size commit, where the user just clicked and a
    // slow fetch has to say so.
    if (opts?.silent) {
      await warm()
      return
    }
    const timer = setTimeout(() => setLoading(true), 400)
    try {
      await warm()
    } finally {
      clearTimeout(timer)
      setLoading(false)
    }
  }
}

/**
 * Read a page state's rows, cache first — the same warmed entry
 * `usePrefetchPageState` writes, under the same key the live query will use
 * once the URL catches up.
 *
 * For the gallery's auto-advance page turn (docs/video-end-action-design.md
 * §3): when a video ends on the last playable item of a page, the chain has
 * to pick the landing index *before* the URL moves, because flipping first
 * would resolve the old (or held) index against rows that only arrive later
 * and show a wrong item for the whole fetch. So the turn fetches, scans the
 * rows for the first playable one, and only then writes `page` and `gi` in
 * one tick. That is the difference from `usePrefetchPageState`: `fetchQuery`
 * instead of `prefetchQuery`, so the rows come back to the caller.
 *
 * Cache first even when the entry is stale, with no revalidation: serving
 * possibly-stale cached rows is exactly as safe as every cached page-turn
 * already is — the live query background-refetches once the URL lands, and
 * the selection→index remap repositions if a row moved. Going through
 * `fetchQuery` for a stale-but-present entry would instead put a network
 * round trip (and its spinner) between the last frame and the next video,
 * which is the hiccup the ahead-of-turn prefetch exists to avoid.
 *
 * **Throws on failure.** An empty array is the legitimate "that page exists
 * and has no rows" answer, so failure cannot be signalled by one; the caller
 * must let a rejection end the advance chain with nothing written.
 *
 * The delayed-spinner flag is the same last-writer-wins boolean every search
 * path shares (`useSearchLoading`); a miss-path settle here can clear a
 * spinner another in-flight search armed. Pre-existing wart, inherited
 * knowingly — this is just the first writer that can fire with no user
 * gesture in sight.
 */
export function useFetchPageRows() {
  const queryClient = useQueryClient()
  const buildRequest = useSearchRequestFor()
  const setLoading = useSearchLoading((state) => state.setLoading)
  return async (
    target: PageState,
    opts?: { gcTime?: number }
  ): Promise<SearchResult[]> => {
    const searchRequest = buildRequest(target)
    const queryKey = ["post", "/api/search/pql", searchRequest]
    const cached = queryClient.getQueryData<{
      results?: SearchResult[] | null
    }>(queryKey)
    if (cached) return cached.results ?? []
    // Same delayed spinner as the prefetch path: a fast fetch (the common
    // case once the page is warm) must not flash the loading state.
    const timer = setTimeout(() => setLoading(true), 400)
    try {
      const data = await queryClient.fetchQuery({
        queryKey,
        queryFn: () => fetchSearch(searchRequest),
        // Same eviction horizon as the prefetch that should have made this a
        // cache hit (see usePrefetchPageState) — the entry becomes the live
        // one a tick later, but that tick must not be a GC race.
        gcTime: opts?.gcTime,
      })
      return (data?.results as SearchResult[]) || []
    } finally {
      clearTimeout(timer)
      setLoading(false)
    }
  }
}

/**
 * The rows a navigation surface reads, with where they came from hidden: a
 * plain array in pages mode, a sparse window over the whole result set in
 * scroll mode (docs/search-scroll-mode-design.md §3). One implementation of
 * the grid and one of the gallery serve both.
 *
 * Indices are GLOBAL — they are the same coordinates `top` and `gi` carry in
 * scroll mode, and in pages mode they are page-local because the array is the
 * page. The source never translates; whoever owns the URL does.
 *
 * DEPENDENCY RULE: `rowsIdentity` is the change signal. Put it — never the
 * source object — in effect deps, memo deps and supersession comparisons. The
 * source object's identity is not promised to be stable (`arrayResultsSource`
 * mints one per render), while `rowsIdentity` changes when, and essentially
 * only when, some underlying row array moved.
 */
export interface ResultsSource {
  /**
   * How far the user can navigate: the count query's answer once it lands,
   * the loaded extent while it is still in flight (the design's pre-count
   * fallback — size to what is known and grow once).
   */
  count: number
  /**
   * The row at a global index, or `undefined` when it is not loaded. NOT an
   * end-of-results signal: `undefined` below `count` means "render a
   * skeleton", and the chunk holding it is either in flight or has never been
   * asked for.
   */
  get(index: number): SearchResult | undefined
  /** Fire-and-forget warm of an item range. Cheap to call per scroll frame. */
  ensureRange(start: number, end: number): void
  /**
   * One item, awaited, fetching its chunk if that is what it takes.
   * **Rejects on failure** — `undefined` means "past the end of the result
   * set", never "the request failed", so an advance chain can tell the two
   * apart (same discipline as `useFetchPageRows`).
   */
  fetchItem(index: number): Promise<SearchResult | undefined>
  /** Changes when any underlying row array changes. See the rule above. */
  rowsIdentity: object
}

/**
 * How many chunks stay *observed*. The cap keeps the active query set small
 * (each one is a live subscription that refetches on invalidation); eviction
 * is not forgetting — an evicted chunk stays in the react-query cache for its
 * gcTime and `get` still reads it from there, so pushing out a chunk that is
 * still on screen costs nothing visible.
 */
const MAX_WANTED_CHUNKS = 8

/** Stable empty rows, so an absent main query doesn't churn `rowsIdentity`. */
const NO_FALLBACK_ROWS: SearchResult[] = []

/** Likewise for the wanted set a committed-query change invalidates. */
const NO_WANTED_CHUNKS: number[] = []

/**
 * The sparse chunk store behind scroll mode: fixed-size, offset-aligned
 * windows of the committed search, fetched on demand and read by global item
 * index.
 *
 * Keyed on `committedQuery` rather than live URL state, so chunk fetching
 * inherits the update lock and the throttle by construction — scrolling can
 * never fetch a search the user is still editing or has deliberately withheld
 * (see `useCommittedQuery`). The two request fields the committed value does
 * not carry, `bookmarkNs` and `partitionBy`, are read from LIVE state here.
 * That is safe rather than a hybrid-request hole: `useSearch` hashes all four
 * fields into its live key, so with the lock on an edit to either makes
 * `committedKey !== liveKey` and disables the queries before a chunk can be
 * requested, and with instant search on committed and live are the same
 * value.
 */
export function useChunkedResults({
  committedQuery,
  enabled,
  fallbackResults,
  count,
}: {
  committedQuery: Pick<SearchRequestParts, "searchQuery" | "dbs">
  /** `useSearch`'s `queryEnabled`: the same gate the main query runs behind. */
  enabled: boolean
  /**
   * The main results query's rows, read for indices below its length when no
   * chunk covers them (docs/search-scroll-mode-implementation.md §0.3) — it
   * is what the SSR prefetch hydrates, so the top of the grid paints without
   * a skeleton flash. Sound only in scroll mode, where there is no `page` and
   * the main query is therefore always page 1: `results[i]` IS global item i.
   */
  fallbackResults: SearchResult[]
  /** `nResults` from the count query; 0 while it is in flight. */
  count: number
}): ResultsSource {
  const queryClient = useQueryClient()
  const bookmarkNs = useBookmarkNs((state) => state.namespace)
  const [partitionBy] = usePartitionBy()
  const parts: SearchRequestParts = {
    ...committedQuery,
    bookmarkNs,
    partitionBy: partitionBy.partition_by,
  }
  const fallbackRows =
    fallbackResults.length > 0 ? fallbackResults : NO_FALLBACK_ROWS
  // The content hash of the request everything below keys on. Used in place
  // of `parts` in the callback deps: `parts` is rebuilt every render, this
  // moves only when the committed search does.
  const partsKey = hashKey([parts])
  // The observed chunk set, oldest request first — a plain array rather than
  // a Set because the order IS the eviction order — tagged with the query it
  // was collected for. Reading it back through that tag is what stops a query
  // change from refetching a whole stale window: the chunks the user was
  // scrolled through name nothing under the new query, and firing eight
  // requests for them per committed edit is exactly the tax scroll mode
  // exists to avoid. The consumer re-warms what is actually visible on the
  // next commit — see `ensureRange`'s identity below.
  const [wanted, setWanted] = useState<{ key: string; chunks: number[] }>({
    key: partsKey,
    chunks: NO_WANTED_CHUNKS,
  })
  const wantedChunks = wanted.key === partsKey ? wanted.chunks : NO_WANTED_CHUNKS
  // No `placeholderData: keepPreviousData` on purpose: a chunk that keeps the
  // previous search's rows under a new key would paint rows from a query the
  // user has left. Undefined — a skeleton — is the honest answer for the one
  // render the new chunk takes to arrive.
  const chunkQueries = useQueries({
    queries: wantedChunks.map((chunkIndex) => {
      const request = buildChunkRequest(parts, chunkIndex)
      return {
        queryKey: ["post", "/api/search/pql", request],
        queryFn: () => fetchSearch(request),
        enabled,
      }
    }),
  })

  // The content key of everything derived below: the committed request, plus
  // when react-query last delivered each LOADED chunk's rows. `useQueries`
  // rebuilds its result array every render, so keying the derivation on that
  // array would rebuild the source on every scroll frame; keying it here
  // rebuilds only when rows actually moved. Chunks with no data yet are left
  // out deliberately — merely wanting a chunk must not read as "the rows
  // changed" to a gallery that cancels a pending advance when they do.
  const loadedKey =
    partsKey +
    "|" +
    wantedChunks
      .map((chunkIndex, i) =>
        chunkQueries[i]?.data ? `${chunkIndex}:${chunkQueries[i].dataUpdatedAt}` : ""
      )
      .filter(Boolean)
      .join(",")
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rowsIdentity = useMemo(() => ({}), [loadedKey, fallbackRows])

  // Stable across renders, but NOT across a committed-query change: the
  // identity moves with `partsKey` on purpose, so a range effect that lists
  // it re-warms the visible range for the new query — which is what refills
  // the wanted set the tag above just invalidated. Never per frame.
  const ensureRange = useCallback(
    (start: number, end: number) => {
      const range = chunkRangeFor(start, end, SCROLL_CHUNK_SIZE)
      if (range.length === 0) return
      setWanted((prev) => {
        const base = prev.key === partsKey ? prev.chunks : NO_WANTED_CHUNKS
        const missing = range.filter((chunkIndex) => !base.includes(chunkIndex))
        // Same set, same query: return the previous state, so a caller driving
        // this from a scroll handler doesn't re-render the tree once a frame.
        if (missing.length === 0 && prev.key === partsKey) return prev
        const next = [...base, ...missing]
        return {
          key: partsKey,
          chunks:
            next.length > MAX_WANTED_CHUNKS
              ? next.slice(next.length - MAX_WANTED_CHUNKS)
              : next,
        }
      })
    },
    [partsKey]
  )

  const fetchItem = useCallback(
    async (index: number): Promise<SearchResult | undefined> => {
      if (index < 0) return undefined
      const chunkIndex = chunkIndexOf(index, SCROLL_CHUNK_SIZE)
      const offset = chunkOffsetOf(index, SCROLL_CHUNK_SIZE)
      const request = buildChunkRequest(parts, chunkIndex)
      const queryKey = ["post", "/api/search/pql", request]
      // Cache first even when stale, with no revalidation — the identical
      // trade `useFetchPageRows` documents: a round trip between the last
      // frame and the next item is the hiccup this path exists to avoid.
      const cached = queryClient.getQueryData<{
        results?: SearchResult[] | null
      }>(queryKey)
      if (cached) return (cached.results ?? [])[offset]
      // No catch: a failed fetch must REJECT. An empty chunk is a legitimate
      // answer ("that offset is past the end"), so failure cannot be
      // signalled by returning undefined.
      const data = await queryClient.fetchQuery({
        queryKey,
        queryFn: () => fetchSearch(request),
      })
      return ((data?.results as SearchResult[]) || [])[offset]
    },
    // `parts` is captured from the render that built this callback, and
    // `partsKey` is its content hash — so the capture is always the committed
    // query and there is no ref to read at call time. Same stability as
    // `ensureRange`: fixed except when the search itself moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [partsKey, queryClient]
  )

  return useMemo<ResultsSource>(() => {
    const loaded = new Map<number, SearchResult[]>()
    wantedChunks.forEach((chunkIndex, i) => {
      const rows = chunkQueries[i]?.data?.results
      if (rows) loaded.set(chunkIndex, rows as SearchResult[])
    })
    const chunkParts = parts
    let extent = fallbackRows.length
    for (const [chunkIndex, rows] of loaded) {
      extent = Math.max(extent, chunkIndex * SCROLL_CHUNK_SIZE + rows.length)
    }
    return {
      // Grow-only until the count lands: sizing the scroll space to the
      // loaded extent means one resize when the real count arrives instead of
      // a scrollbar that thrashes as chunks come in.
      count: count > 0 ? count : extent,
      get(index: number): SearchResult | undefined {
        if (index < 0) return undefined
        const chunkIndex = chunkIndexOf(index, SCROLL_CHUNK_SIZE)
        const offset = chunkOffsetOf(index, SCROLL_CHUNK_SIZE)
        const rows = loaded.get(chunkIndex)
        if (rows) return rows[offset]
        // A chunk pushed out of the observed set is still in the react-query
        // cache. Without this read, LRU eviction of a chunk the user is
        // looking at would flash skeletons over rows that are in memory.
        const cached = queryClient.getQueryData<{
          results?: SearchResult[] | null
        }>(["post", "/api/search/pql", buildChunkRequest(chunkParts, chunkIndex)])
        if (cached?.results) return (cached.results as SearchResult[])[offset]
        if (index < fallbackRows.length) return fallbackRows[index]
        return undefined
      },
      ensureRange,
      fetchItem,
      rowsIdentity,
    }
    // Deps name `rowsIdentity` instead of the values the body reads
    // (`wantedChunks`, `chunkQueries`, `parts`): the `loadedKey` behind it is
    // precisely their content, and listing the result array `useQueries`
    // rebuilds every render would defeat the memo this hook exists to keep
    // cheap — the whole point is that scrolling does not rebuild the source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsIdentity, count, fallbackRows, ensureRange, fetchItem, queryClient])
}

/**
 * The pages-mode twin: the page's rows, already in hand, behind the same
 * interface — which is what leaves ONE gallery and ONE grid code path.
 *
 * A plain function, so a caller gets a new object per render. That is
 * deliberate and harmless under the dependency rule on `ResultsSource`:
 * consumers compare `rowsIdentity` (here the array itself, exactly the
 * identity they compared before this abstraction existed), never the source.
 */
export function arrayResultsSource(results: SearchResult[]): ResultsSource {
  return {
    count: results.length,
    get: (index: number) => results[index],
    ensureRange: () => {},
    fetchItem: async (index: number) => results[index],
    rowsIdentity: results,
  }
}

/**
 * Switch between paginated and scroll mode, carrying the position across.
 *
 * The two modes are two presentations of one set of coordinates, so the
 * switch is pure re-expression: `floor(top / k) === page - 1` with the same
 * k — the page number the bar highlights does not move (design §4). Both
 * directions go through the same arithmetic as the page-size remap
 * (lib/scrollMode.ts), which is where the `page_size < 1` "no pagination"
 * case and its `0 * Infinity` guard already live.
 *
 * `vm` writes "push" and the position params write "replace", all in one
 * tick: nuqs coalesces the batch into a single URL update and escalates the
 * whole thing to a pushed history entry because one member asked for push.
 * That escalation is the point here — the same rule that forces
 * `useCommitPageSize` to spell "replace" out on every write gives the mode
 * switch exactly one Back-able entry, with the position it belongs to.
 *
 * Entering pages mode prefetches the target page first (the
 * `setPagePrefetch` discipline): the flip and the results swap should land in
 * the same render. Entering scroll mode needs no prefetch — the rows on
 * screen already cover the viewport and chunk fetches take over from there.
 */
export function useCommitViewMode() {
  const prefetch = usePrefetchPageState()
  const [viewMode, setViewMode] = useViewMode()
  const [page, setPage] = useSearchPageRaw()
  const pageSize = usePageSize()
  const [galleryIndex, setGalleryIndex] = useGalleryIndex()
  const [scrollAnchor, setScrollAnchor] = useGridScrollAnchor()
  return async (nextMode: ViewMode) => {
    if (nextMode === viewMode) return
    const push = { history: "push" as const }
    const replace = { history: "replace" as const }
    // The position to carry: the open gallery's item, or the grid's scroll
    // anchor (absent while the top row is visible, hence the 0).
    const galleryOpen = galleryIndex !== null
    const anchor = galleryOpen ? galleryIndex : scrollAnchor ?? 0
    const writes: Promise<unknown>[] = []
    if (nextMode === "scroll") {
      const global = scrollAnchorFromPage({ page, pageSize, anchor })
      writes.push(setViewMode("scroll", push))
      // Cleared unconditionally: scroll mode is defined by having no `page`
      // at all (two live position params is the bug class this avoids), and
      // an explicit `page=1` reads as 1 through nuqs, so a skip on the value
      // would leave it in the URL. Idempotent, and it rides the same batch.
      writes.push(setPage(null, replace))
      const nextAnchor = global > 0 ? global : null
      if (nextAnchor !== scrollAnchor) {
        writes.push(setScrollAnchor(nextAnchor, replace))
      }
      // `gi` becomes global too, so the gallery and the grid keep naming
      // positions the same way in each mode.
      if (galleryOpen && global !== galleryIndex) {
        writes.push(setGalleryIndex(global, replace))
      }
    } else {
      const target = pageStateFromScrollAnchor({ anchor, pageSize })
      await prefetch({ page: target.page })
      writes.push(setViewMode("pages", push))
      // Unchanged values are skipped throughout: a setter called with what it
      // already holds can still produce a history entry for an identical URL
      // (see useCommitPageSize).
      if (target.page !== page) writes.push(setPage(target.page, replace))
      const nextAnchor = target.index > 0 ? target.index : null
      if (nextAnchor !== scrollAnchor) {
        writes.push(setScrollAnchor(nextAnchor, replace))
      }
      if (galleryOpen && target.index !== galleryIndex) {
        writes.push(setGalleryIndex(target.index, replace))
      }
    }
    await Promise.all(writes)
  }
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
 *
 * In SCROLL mode none of that applies: `page_size` is the virtual-page size
 * k, decoupled from the fetch granularity (`SCROLL_CHUNK_SIZE`), so changing
 * it relabels the pagination bar and rescales prev/next while the position,
 * the rows and every request stay exactly where they are — see the scroll
 * branch below.
 */
export function useCommitPageSize() {
  const prefetch = usePrefetchPageState()
  const [viewMode] = useViewMode()
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
    if (viewMode === "scroll") {
      // A pure relabel: `top` and `gi` are global indices that k does not
      // enter into, and no request keys on it either (the main query's does,
      // but it refetches page 1 at the new size and the grid reads chunks).
      // So there is nothing to prefetch and nothing to remap: one param to
      // write, skipped when unchanged, in "replace" like every other
      // non-navigation position write.
      if (nextPageSize === pageSize) return
      await setPageSize(nextPageSize, { history: "replace" })
      return
    }
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
