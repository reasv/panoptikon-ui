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
  useSearchSuppressed,
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
  // `committed.current.key !== liveKey` is not an optimization of the
  // instant-search branch, it IS the branch: `liveKey` is a content hash of a
  // SUPERSET of `liveValue`'s fields, so an unchanged key means the frozen
  // value's content is already the live one and replacing it would publish a
  // new object saying the same thing. Everything downstream keys on this
  // reference — the chunk store's throttle and its `parts`-keyed memos, the
  // Library tab's `committedQuery` prop — and with instant search on (the
  // default) this used to mint a fresh one on every single render, which is
  // what made all of them miss.
  if (
    (instantSearch && committed.current.key !== liveKey) ||
    seenToken.current !== commitToken
  ) {
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
  // A maximized board with the search overlay closed hides every consumer of
  // these results, so running the search buys nothing — and for an embedding
  // query it costs a model load. An open overlay IS a consumer on screen, so
  // the gate is isSearchSuppressed (maximized AND overlay closed), not
  // isPinboardMaximized (docs/maximized-pinboard-search-overlay-design.md
  // §4). keepPreviousData below means whatever was fetched before the
  // suppression stays in hand, so restoring the board size — or opening the
  // overlay — shows it immediately while the now-stale query refetches. See
  // lib/state/pinboardView.ts.
  const searchSuppressed = useSearchSuppressed()
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
  // Gated on the *live* request, not the throttled one: the throttle trails
  // by a render, and during that render the query key is still the previously
  // committed one — already in cache, so leaving it enabled costs nothing.
  //
  // Hoisted above the throttle so it can BE the throttle's content key: the
  // two were serializing the identical object every render (`hashKey` is a
  // key-sorted `JSON.stringify`), and one serialization of the search query
  // per render is enough.
  const liveKey = hashKey([liveRequest])
  const throttledRequest = useThrottledValue(liveRequest, throttleMs, liveKey)
  const request = throttleMs > 0 ? throttledRequest : liveRequest
  // page_size is optional in the spec (server default 10); the query
  // builders always set it, but the type can't promise that.
  const pageSize = request.searchQuery.page_size ?? 10
  // The frozen value is taken from the *live* request, not the throttled one:
  // a commit lands on the render that bumps the token, and the throttle is
  // still a render behind then — freezing the trailing value would leave the
  // library running the previous query until the next commit. Consumers
  // throttle what they get from here, which reproduces this query's own
  // "throttled, once live == committed" behaviour.
  // All four request fields freeze together, as one `SearchRequestParts`: a
  // consumer that mixed these with its own LIVE reads of `bookmarkNs` or
  // `partitionBy` could build a request that is half-committed and half-live,
  // which is exactly the hybrid the lock exists to prevent. Freezing the whole
  // parts object makes that request unbuildable rather than merely unlikely.
  const { key: committedKey, value: committedQuery } =
    useCommittedQuery<SearchRequestParts>(
      liveKey,
      {
        searchQuery: liveRequest.searchQuery,
        dbs: liveRequest.dbs,
        bookmarkNs: liveRequest.bookmarkNs,
        partitionBy: liveRequest.partitionBy,
      },
      instantSearch,
      commitToken
    )
  const queryEnabled =
    searchEnabled &&
    (instantSearch || committedKey === liveKey) &&
    !searchSuppressed
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

  // Does `nResults` belong to the query the URL currently names?
  //
  // The same question `resultsAreStale` asks about the rows, asked about the
  // count — and gated the same way, for the same reason: the count query runs
  // `keepPreviousData` too, so across a re-key `count` is the PREVIOUS search's
  // answer, and a non-zero count is therefore not proof that the count has
  // landed. Scroll mode's `countSettled` reads this: a deep anchor clamped
  // against the wrong extent is recorded as applied and can never be restored.
  //
  // Same `queryEnabled || isFetching` guard as above, and for the same reason:
  // a disabled query swaps to placeholder data on a key change and, with
  // nothing in flight, stays there forever.
  const countIsPlaceholder =
    countQuery.isPlaceholderData && (queryEnabled || countQuery.isFetching)

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
    // For on-demand consumers of the same search (the grid's Library tab, the
    // scroll-mode chunk store): the full `SearchRequestParts` this hook would
    // run, gated by the update lock exactly as this hook gates its own. A
    // consumer that needs only part of it takes a `Pick` and is unaffected.
    // See useCommittedQuery.
    committedQuery,
    // Its content hash — the same string this hook keys its own query gate
    // on. Handed out so a consumer that throttles `committedQuery` can pass
    // it as the throttle's content key instead of serializing the search a
    // second time per render (see useThrottledValue's `contentKey`).
    committedKey,
    resultsAreStale,
    nResults,
    countIsPlaceholder,
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
 * DEPENDENCY RULE: `rowsIdentity` is the ROWS change signal. Put it — never
 * the source object, never its methods — in effect deps, memo deps and
 * supersession comparisons. Neither implementation promises a stable source
 * object (both mint one per render), while `rowsIdentity` tracks the observed
 * row set (see its own doc below).
 *
 * `queryIdentity` is the OTHER half of that rule and answers a different
 * question: "did the search these indices index into change". It is the
 * SUPERSESSION-GATE comparand and belongs in nothing else — never in an effect
 * dep list, where it would silently stop that effect re-running on rows it is
 * there to react to. Both values are compared with `!==` and read for nothing
 * else (hence `unknown` on both).
 *
 * `errorAt` is a READ-THROUGH, tracked by neither: it reports live query state
 * (see its own doc), so it must be called during render and never cached,
 * memoized or folded into an identity token.
 *
 * `count` is NOT part of it. It is a plain value that changes on its own
 * schedule — the pre-count fallback growing into the real count is the normal
 * case — so anything whose sizing depends on it must list `count` as its own
 * dependency alongside `rowsIdentity`. Do not fold the two together: a count
 * arriving must not read as "the rows moved" to a consumer that cancels work
 * when they do.
 */
export interface ResultsSource {
  /**
   * How far the user can navigate: the count query's answer once it lands,
   * the loaded extent while it is still in flight (the design's pre-count
   * fallback — size to what is known and grow once).
   *
   * The count rides its query's `keepPreviousData` deliberately (design §3
   * pre-count fallback: the scroll space must not collapse and re-grow across
   * a re-search), so a stale count carried across a query change is the
   * intended behaviour, not a leak.
   */
  count: number
  /**
   * The row at a global index, or `undefined` when it is not loaded. NOT an
   * end-of-results signal: `undefined` below `count` means "render a
   * skeleton", and the chunk holding it is either in flight or has never been
   * asked for.
   */
  get(index: number): SearchResult | undefined
  /**
   * The loaded RUN of rows containing a global index — the array itself plus
   * the global index of its first element — or `undefined` when nothing
   * covering that index is loaded (same meaning as `get`'s undefined: "not
   * loaded", never "end of results").
   *
   * The block-scan door, for a caller that must look at many CONSECUTIVE rows
   * rather than at one. `get` resolves its chunk from scratch on every call,
   * and for a chunk that has been evicted from the observed set that means
   * rebuilding and re-hashing a whole request body per index — a few hundred
   * of them for one ensure-visible pass. Whoever scans a range asks for the
   * block once and reads the rows in memory.
   *
   * The block is an implementation's own unit (a chunk in scroll mode, the
   * whole page in pages mode), so the caller must treat `start` and
   * `rows.length` as the only truth about what it covers and never assume a
   * size. It is a READ of what is loaded now: nothing is fetched, and a block
   * may be shorter than the lattice it comes from (the last chunk of the set).
   */
  getBlock(index: number): { start: number; rows: SearchResult[] } | undefined
  /** Fire-and-forget warm of an item range. Cheap to call per scroll frame. */
  ensureRange(start: number, end: number): void
  /**
   * One item, awaited, fetching its chunk if that is what it takes.
   * **Rejects on failure** — `undefined` means "past the end of the result
   * set", never "the request failed", so an advance chain can tell the two
   * apart (same discipline as `useFetchPageRows`).
   */
  fetchItem(index: number): Promise<SearchResult | undefined>
  /**
   * Is the chunk covering a global index in TERMINAL failure — errored, not
   * fetching, no data? Distinguishes the two indistinguishable halves of
   * `get(index) === undefined`: "in flight or not asked for" (wait) and "this
   * request failed and nothing further is coming" (say so, and offer a way
   * out).
   *
   * The affordance is needed because the failure really is terminal.
   * react-query burns its three retries and then STOPS; nothing re-arms an
   * errored query except a window-focus or reconnect refetch, neither of which
   * a user staring at a stuck skeleton can be asked to produce. Without this a
   * failed chunk is a pulsing loading frame forever.
   *
   * READ-THROUGH, deliberately outside `rowsIdentity`: it reports the live
   * query state, which is not a row set and must not move a rows token. The
   * render path that makes it work is the ordinary one — the chunk queries are
   * observed by `useQueries` in MultiSearchView, so a query entering the error
   * state notifies that observer, MultiSearchView re-renders, mints a fresh
   * source, and passes it down as a prop. Consumers therefore get a new answer
   * by re-rendering, exactly as they do for `get`. Do not cache it.
   */
  errorAt(index: number): boolean
  /**
   * Restart every terminally-errored chunk covering an item range, and make
   * sure those chunks are wanted. The manual counterpart to `errorAt`: the
   * only thing in the app that can un-stick a failed chunk.
   *
   * Fine to call with `(i, i)` for a single index — the unit is the chunk
   * either way, so retrying one item retries the range that item's request
   * covers, which is exactly what the caller means by "load this again".
   */
  retryRange(start: number, end: number): void
  /**
   * A value-comparable token that changes when the OBSERVED row set changes —
   * either in MEMBERSHIP (a chunk joining or leaving the wanted window) or in
   * CONTENT (a row array reference actually replaced). Guaranteed stable
   * across a no-op refetch: react-query's structural sharing returns the same
   * array when nothing changed, so the token does not move either.
   *
   * Note what it does NOT track: `get` also serves chunks that have been
   * evicted from the observed set but are still in the react-query cache, and
   * those rows are outside this token's scope by construction.
   *
   * Membership churn is real churn to this token: once the observed set is at
   * its cap, every seam crossing evicts one chunk and admits another, moving
   * the token with no row anyone can see having changed. That is why this is
   * NOT the supersession comparand — `queryIdentity` below is — and why a
   * consumer that cancels work when the rows move must use that one instead.
   *
   * Compare with `!==` and nothing else: the two implementations return
   * different kinds of value — the array itself in pages mode, a derived
   * string in scroll mode — and `!==` is exactly right for both (references
   * compare by identity, strings by value). Hence `unknown`: reading it for
   * anything but a comparison is a bug.
   *
   * Deliberately NOT a timestamp or a fetch counter. Structural sharing is
   * what makes a reference the honest answer to "did the rows move?", while
   * `dataUpdatedAt` would say yes on every background refetch — and the pages
   * -mode twin would say no to the same event. What this feeds is every dep
   * list that must re-run when anything renderable changed, so the two modes
   * disagreeing is precisely the bug this abstraction exists to prevent.
   */
  rowsIdentity: unknown
  /**
   * The identity of the UNDERLYING QUERY — not of the observed window over it.
   * It moves when, and only when, the search these indices index into changes:
   * the committed request hash in scroll mode, the page's rows array in pages
   * mode.
   *
   * THE SUPERSESSION-GATE COMPARAND. `rowsIdentity` answers "did anything I
   * might render change" (the right question for effect and render deps);
   * this answers "did the coordinates I computed a target in stop meaning what
   * they meant" (the right question for a gate that cancels in-flight work).
   * Conflating them is what makes a scroll-mode advance chain cancellable by a
   * chunk landing three screens away, in a window the chain owns.
   *
   * In pages mode the two are the same value, byte for byte — the results
   * array — so a pages-mode gate written on this is the items-identity gate it
   * has always been, unchanged.
   *
   * Compare with `!==` and nothing else, same as `rowsIdentity` and for the
   * same reason: a string on one side, an array reference on the other.
   */
  queryIdentity: unknown
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
 * What the store throttles instead of the live committed query while it is
 * DISABLED — a pages-mode-only session, an invalid query, a maximized board.
 * `useThrottledValue` compares by JSON content, so parking it on a two-key
 * constant is what turns that per-render stringify of the whole search into
 * nothing.
 *
 * NEVER built into a request: `parts` below falls back to the committed query
 * for the window the throttle can still be holding this, so no request body,
 * cache key or hash is ever derived from it. It exists to be cheap to
 * serialize and to be recognized by reference, and for nothing else.
 */
const NO_CHUNK_QUERY: SearchRequestParts = {
  searchQuery: {},
  dbs: { index_db: null, user_data_db: null },
  bookmarkNs: "",
  partitionBy: null,
}

/**
 * The `partsKey` of a disabled store. A key nothing can be fetched under, and
 * distinct from every real hash by construction (hashes are JSON), so the
 * first ENABLED render sees `wanted.key !== partsKey` and rebuilds the whole
 * observed set from scratch rather than inheriting a window collected under
 * it.
 */
const NO_PARTS_KEY = "disabled"

/** The empty row/error sets a disabled store answers with, allocated once. */
const NO_LOADED_CHUNKS: Map<number, SearchResult[]> = new Map()
const NO_ERRORED_CHUNKS: Set<number> = new Set()

/**
 * A stable number per row-array *reference*, minted on first sight. The
 * building block of `rowsIdentity` in the chunk store: composing these ids
 * into a string turns "did any of these arrays move?" into a value
 * comparison, which is what lets the token itself be the string (see
 * `ResultsSource.rowsIdentity`).
 *
 * A WeakMap keyed on the array, so an id never keeps rows alive past their
 * cache entry, and a monotonic counter rather than a hash, so two arrays that
 * happen to hold equal rows still get distinct ids — reference identity is
 * the whole claim being encoded.
 */
let nextRowsId = 1
const rowsIds = new WeakMap<object, number>()
function idOf(rows: object): number {
  const seen = rowsIds.get(rows)
  if (seen !== undefined) return seen
  const id = nextRowsId++
  rowsIds.set(rows, id)
  return id
}

/**
 * The sparse chunk store behind scroll mode: fixed-size, offset-aligned
 * windows of the committed search, fetched on demand and read by global item
 * index.
 *
 * Keyed on `committedQuery` rather than live URL state, so chunk fetching
 * inherits the update lock by construction — scrolling can never fetch a
 * search the user is still editing or has deliberately withheld (see
 * `useCommittedQuery`). The throttle is NOT inherited with it and is applied
 * here instead: with instant search on, committed and live are the same
 * value.
 *
 * `committedQuery` is the WHOLE `SearchRequestParts`, and this hook reads no
 * live request state of its own. That is the invariant, and it is structural:
 * all four request fields (`searchQuery`, `dbs`, `bookmarkNs`, `partitionBy`)
 * freeze in the same commit, so a chunk request mixing committed filters with
 * an uncommitted live field cannot be BUILT — no `enabled` gating is load-
 * bearing for it, which matters because the gating this hook does take
 * (below) deliberately omits `committedKey === liveKey`.
 */
export function useChunkedResults({
  committedQuery,
  committedKey,
  enabled,
  fallbackResults,
  resultsAreStale,
  count,
}: {
  committedQuery: SearchRequestParts
  /**
   * `useSearch`'s hash of that same committed request, used as the throttle's
   * content key (see `useThrottledValue`'s `contentKey`) instead of
   * serializing the whole search a second time on every render of the search
   * page. It hashes a SUPERSET of `committedQuery` — the live `page` is in it
   * — which is sound in both directions: the content cannot move without the
   * key moving, and the one extra field that can move on its own is `page`,
   * which scroll mode does not have (and which every chunk request overrides
   * regardless, so a spurious propagation would re-mint `parts` without
   * moving `partsKey`, refetching nothing).
   */
  committedKey: string
  /**
   * `searchEnabled && !searchSuppressed` — NOT `useSearch`'s `queryEnabled`.
   *
   * Every chunk body is derived from the COMMITTED query, so fetching one is
   * always safe for what is on screen: there is no uncommitted edit it could
   * leak. `queryEnabled`'s other half (`committedKey === liveKey`) would
   * therefore withhold nothing while breaking scrolling outright — with
   * instant search off, a withheld sidebar edit, or a scroll-mode `page_size`
   * nudge (which changes the live key while the committed query stands still),
   * would disable chunk fetching and freeze the user on skeletons until they
   * pressed Enter. The two gates that DO belong here are the `s_enable` one
   * (invalid input has no request to make) and the suppression one — the
   * board maximized with the search overlay closed, so no consumer is on
   * screen and an embedding query would cost a model load for nothing; an
   * open overlay IS a consumer, which is exactly what `isSearchSuppressed`
   * scopes the old maximized-board gate down to.
   */
  enabled: boolean
  /**
   * The main results query's rows, read for indices below its length when no
   * chunk covers them (docs/search-scroll-mode-implementation.md §0.3) — it
   * is what the SSR prefetch hydrates, so the top of the grid paints without
   * a skeleton flash. Sound only in scroll mode, where there is no `page` and
   * the main query is therefore always page 1: `results[i]` IS global item i.
   */
  fallbackResults: SearchResult[]
  /**
   * `useSearch`'s `resultsAreStale`, which gates the fallback off entirely.
   *
   * The main query runs `placeholderData: keepPreviousData`, so across a
   * query change `fallbackResults` holds the PREVIOUS search's rows. This
   * store's own policy is "skeletons, never stale rows" — that is why the
   * chunk queries deliberately have no `keepPreviousData` — and the fallback
   * must not be the hole that reintroduces them, either as visible items or
   * as loaded extent the scroll space is sized from.
   */
  resultsAreStale: boolean
  /** `nResults` from the count query; 0 while it is in flight. */
  count: number
}): ResultsSource {
  const queryClient = useQueryClient()
  const { data: clientConfig } = useClientConfig()
  // ?? rather than ||: an explicit search_throttle_ms = 0 in the gateway
  // policy's [policies.client] table disables throttling.
  const throttleMs = clientConfig?.searchThrottleMs ?? 500
  // Throttled here, not upstream. `committedQuery` is frozen by the update
  // lock and by nothing else, so with instant search ON committed IS live and
  // moves on every keystroke — `useSearch` says as much where it freezes the
  // value (see `useCommittedQuery`): consumers throttle what they receive,
  // which is what reproduces the main query's own coalescing. Unthrottled,
  // every keystroke would re-key the whole chunk set and immediately fire up
  // to MAX_WANTED_CHUNKS requests for a search the user is still typing. The
  // whole parts object is throttled as one unit, so the four fields stay
  // frozen together on the way through here too.
  //
  // DISABLED means parked on a constant (see NO_CHUNK_QUERY): every hook below
  // still runs — they are hooks — but a pages-mode-only session must not pay a
  // JSON serialization of the whole search on every render of the search page
  // for a store it never reads. Everything else in this body that costs
  // anything is gated the same way, so that session pays ~nothing per render.
  const throttledQuery = useThrottledValue(
    enabled ? committedQuery : NO_CHUNK_QUERY,
    throttleMs,
    // The disabled key is the placeholder request's own identity and must
    // differ from every real hash the same way NO_PARTS_KEY does — a hash is
    // JSON, so a bare word cannot collide with one.
    enabled ? committedKey : NO_PARTS_KEY
  )
  // `throttledQuery` is state that only moves when its content does, so
  // `parts` (and everything keyed on it below) sits still between committed
  // searches without anyone having to lie about a dependency.
  //
  // The constant must never reach a request, and the throttle can still be
  // HOLDING it for one throttle window after `enabled` goes true (it
  // propagates from an effect, and a recent propagation delays that by up to
  // `throttleMs`). The committed query stands in for that window, which is
  // both safe and free of the throttle's purpose: building a chunk request
  // from the committed query is this hook's whole invariant, and the throttle
  // exists to coalesce keystrokes — not something a mode switch, an s_enable
  // toggle or a board restore can be. Keeping the real value here while
  // disabled is also what lets `get` keep answering from the react-query cache
  // (blockAt below): rows that are in memory must not blank out because
  // searching was momentarily switched off.
  const parts: SearchRequestParts =
    throttleMs > 0 && enabled && throttledQuery !== NO_CHUNK_QUERY
      ? throttledQuery
      : committedQuery
  const fallbackRows =
    fallbackResults.length > 0 ? fallbackResults : NO_FALLBACK_ROWS
  // Off entirely while the main query's rows belong to a search the user has
  // left; see the `resultsAreStale` param.
  const fallbackLive = !resultsAreStale && fallbackRows.length > 0
  // The content hash of the request everything below keys on. Hashed from
  // chunk 0's request rather than from `parts`, so it is byte-identical to
  // what actually keys a chunk query and is page/page_size-independent by
  // construction — a scroll-mode `page_size` relabel, which every chunk
  // request overrides anyway, therefore cannot tear down the wanted set, and
  // this key can never drift from the chunk keys it stands for.
  //
  // Gated on `enabled` for the same reason as the throttle above — building
  // and hashing a request body is the other per-render cost a store nobody
  // reads must not pay. The placeholder invalidates the whole observed set by
  // construction (see NO_PARTS_KEY), which is exactly right: the first enabled
  // render rebuilds the wanted window from the consumers' own `ensureRange`
  // rather than inheriting one.
  //
  // Memoized on `parts`, which is the throttle's state and therefore sits
  // still between committed searches: building a request body and hashing it
  // is the single most expensive expression in this hook's render path, and
  // it has no business re-running for a chunk that landed or a row that
  // moved. (`parts` falls back to `committedQuery` for the throttle's opening
  // window and when throttling is off — that reference is stable too, per
  // useCommittedQuery.)
  const partsKey = useMemo(
    () => (enabled ? hashKey([buildChunkRequest(parts, 0)]) : NO_PARTS_KEY),
    [enabled, parts]
  )
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

  // `rowsIdentity` itself — a plain string, not a token object, so it can be
  // compared by value and cannot be frozen by a memo (see
  // `ResultsSource.rowsIdentity`).
  //
  // It names the committed request plus the REFERENCE of every row array this
  // source can currently serve: each loaded chunk's rows, and the fallback's
  // when it is live. References, because react-query's structural sharing
  // returns the same array from a refetch that changed nothing — so this
  // moves when rows move and at no other time, which is also what lets every
  // dep list below be honest without churning.
  //
  // Chunks with no data yet are left out deliberately: merely *wanting* a
  // chunk must not read as "the rows changed" to a gallery that cancels a
  // pending advance when they do.
  //
  // Disabled, it is the placeholder key and nothing else: a store with no
  // observed chunks has no row set to describe, and composing one per render
  // is work a pages-mode-only session would do forever. It moves exactly once
  // when the store is enabled, which is the change consumers need to see.
  const rowsIdentity = !enabled
    ? partsKey
    : partsKey +
      "|" +
      wantedChunks
        .map((chunkIndex, i) => {
          const rows = chunkQueries[i]?.data?.results as
            | SearchResult[]
            | undefined
          return rows ? `${chunkIndex}:${idOf(rows)}` : ""
        })
        .filter(Boolean)
        .join(",") +
      "|" +
      (fallbackLive ? idOf(fallbackRows) : "")

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

  /**
   * CONTRACT: this reads and populates the react-query cache and NOTHING
   * else. It deliberately does not join the chunk to the observed set, so
   * `rowsIdentity` does not move as a consequence of the caller's own fetch.
   *
   * That is load-bearing for the gallery's advance chain (design step 3),
   * whose supersession gate cancels a pending advance when any row moves
   * under it: if `fetchItem` observed the chunk it just fetched, the advance
   * would be cancelled by its own lookahead and auto-advance could never
   * cross a chunk seam. Leaving the observed set alone keeps that gate quiet
   * under the chain's own fetch.
   *
   * The rows do not stay invisible: an advance that succeeds ends by writing
   * a position (`gi`), which re-renders the consumers, whose `ensureRange`
   * effects then adopt the chunk through the normal add/LRU path — that is
   * when `rowsIdentity` moves, after the chain has completed. An advance that
   * aborts leaves an unobserved but cached chunk behind, which is harmless:
   * `get` reads the cache too, and gcTime collects it.
   */
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
    // Honest and stable together: `parts` follows the throttled committed
    // query, so this callback is fixed except when the search itself moves —
    // the same lifetime as `ensureRange`. Consumers still compare
    // `rowsIdentity`, never this, per the rule on `ResultsSource`.
    [parts, queryClient]
  )

  // The two per-render allocations, skipped entirely while disabled: with no
  // observed chunks there is nothing to sort into them, and a store nobody
  // reads should not mint a Map and a Set per render of the search page.
  const loaded = enabled ? new Map<number, SearchResult[]>() : NO_LOADED_CHUNKS
  // Chunks whose query has given up: errored, nothing in flight, no data to
  // fall back on. react-query has already spent its retries by then, so this
  // set only grows again on an explicit `retryRange` (or a focus/reconnect
  // refetch) — see `ResultsSource.errorAt`.
  const erroredChunks = enabled ? new Set<number>() : NO_ERRORED_CHUNKS
  if (enabled) {
    wantedChunks.forEach((chunkIndex, i) => {
      const query = chunkQueries[i]
      const rows = query?.data?.results
      if (rows) loaded.set(chunkIndex, rows as SearchResult[])
      else if (query?.isError && !query.isFetching && query.data === undefined) {
        erroredChunks.add(chunkIndex)
      }
    })
  }
  // The chunk-request key for a MISS, memoized per chunk for the life of one
  // committed query. A screenful of skeletons is dozens of cells asking about
  // the SAME two or three chunks, and each miss otherwise rebuilt the chunk
  // request object and had react-query hash it again — per cell, per render, in
  // the hottest loop in the app.
  //
  // A REF, not a bare `new Map()` in the render body: under the React Compiler
  // such an allocation becomes a memoized slot with NO dependency of its own,
  // so the map is minted once per hook instance and survives a change of
  // `parts` — handing `getQueryData` keys built from the PREVIOUS search, and
  // growing without bound for the life of the page. A ref escapes that
  // memoization, so the invalidation can be written by hand: the box is reset
  // whenever `parts` moves, checked at USE so it holds for callers that run
  // outside a render pass too (`retryRange`). The reset is idempotent and
  // derived from nothing but `parts`, so a render React discards leaves behind
  // a valid — merely empty — map for those same parts.
  const missKeys = useRef<{
    parts: SearchRequestParts
    map: Map<number, unknown[]>
  }>({ parts, map: new Map() })
  const missKeyFor = (chunkIndex: number) => {
    if (missKeys.current.parts !== parts) {
      missKeys.current = { parts, map: new Map() }
    }
    const map = missKeys.current.map
    let key = map.get(chunkIndex)
    if (!key) {
      key = ["post", "/api/search/pql", buildChunkRequest(parts, chunkIndex)]
      map.set(chunkIndex, key)
    }
    return key
  }
  /**
   * Restart the failed chunks in a range. `resetQueries` rather than
   * `refetchQueries`, for one reason: reset returns the query to its initial
   * state — stored error cleared — before refetching for its active
   * observers, so even a refetch that gets SKIPPED (a query that meanwhile
   * lost its observers) leaves the chunk in a clean idle state a fresh
   * observer will fetch, never parked on a terminal error. (The visible
   * error→skeleton transition does not depend on this choice — `errorAt`'s
   * `!isFetching` clause already suppresses the error frame for any
   * in-flight attempt.)
   *
   * `ensureRange` is what covers the lost-observer case concretely: a chunk
   * evicted from the observed set has no observer for a reset to wake, so it
   * is re-wanted here and fetched by the `useQueries` entry that appears on
   * the next render. Idempotent for a chunk that is already wanted.
   *
   * Not memoized, deliberately: it is a click handler's verb, never an
   * effect's or a scroll frame's, and reading the live error set is worth more
   * than a stable identity nothing is allowed to depend on anyway.
   */
  const retryRange = (start: number, end: number) => {
    let reset = false
    for (const chunkIndex of chunkRangeFor(start, end, SCROLL_CHUNK_SIZE)) {
      if (!erroredChunks.has(chunkIndex)) continue
      reset = true
      void queryClient.resetQueries({
        queryKey: missKeyFor(chunkIndex),
        exact: true,
      })
    }
    if (reset) ensureRange(start, end)
  }
  let extent = fallbackLive ? fallbackRows.length : 0
  for (const [chunkIndex, rows] of loaded) {
    // Empty rows contribute NOTHING, not their chunk's start offset: a chunk
    // requested past the end of the set answers with an empty page, and
    // counting `chunkIndex * SCROLL_CHUNK_SIZE` for it would size the scroll
    // space to a position no result occupies. Only observable before the count
    // lands — which is exactly the window this extent is the answer for.
    if (rows.length === 0) continue
    extent = Math.max(extent, chunkIndex * SCROLL_CHUNK_SIZE + rows.length)
  }
  // ONE lookup behind both readers: `getBlock` is this, `get` is this plus an
  // offset. Written once so the three places rows can come from — the observed
  // set, the react-query cache (a chunk pushed out by LRU is still there;
  // without that read, evicting a chunk the user is looking at would flash
  // skeletons over rows that are in memory), and the main query's page-1
  // fallback — can never answer the two differently. The MISS path's key comes
  // from `missKeyFor` above, which caches it per chunk for the life of one
  // committed query.
  const blockAt = (
    index: number
  ): { start: number; rows: SearchResult[] } | undefined => {
    if (index < 0) return undefined
    const chunkIndex = chunkIndexOf(index, SCROLL_CHUNK_SIZE)
    const start = chunkIndex * SCROLL_CHUNK_SIZE
    const rows = loaded.get(chunkIndex)
    if (rows) return { start, rows }
    const cached = queryClient.getQueryData<{
      results?: SearchResult[] | null
    }>(missKeyFor(chunkIndex))
    if (cached?.results) return { start, rows: cached.results as SearchResult[] }
    // The fallback is page 1 of the main query, so its block starts at item 0
    // and covers only what it holds.
    if (fallbackLive && index < fallbackRows.length) {
      return { start: 0, rows: fallbackRows }
    }
    return undefined
  }

  // Built fresh every render rather than memoized. `useQueries` rebuilds its
  // result array each time, so any honest memo over this body would recompute
  // anyway — and a memo keyed on `rowsIdentity` alone is the lying-deps token
  // this hook used to carry, which under the React Compiler (which discards
  // written dep arrays and derives its own) would have frozen the source on
  // the first query's chunks forever. The cost is one Map of at most
  // MAX_WANTED_CHUNKS entries per render, and nothing depends on the object's
  // identity: consumers compare `rowsIdentity`, exactly as they do for the
  // pages-mode twin, which has always minted one source per render.
  return {
    // Grow-only until the count lands: sizing the scroll space to the loaded
    // extent means one resize when the real count arrives instead of a
    // scrollbar that thrashes as chunks come in.
    count: count > 0 ? count : extent,
    get(index: number): SearchResult | undefined {
      const block = blockAt(index)
      return block ? block.rows[index - block.start] : undefined
    },
    getBlock: blockAt,
    ensureRange,
    fetchItem,
    // Read straight off the live query state each render — never memoized,
    // never folded into an identity token (see ResultsSource.errorAt).
    errorAt: (index: number) =>
      index >= 0 && erroredChunks.has(chunkIndexOf(index, SCROLL_CHUNK_SIZE)),
    retryRange,
    rowsIdentity,
    // The committed request hash: it moves when the SEARCH moves and at no
    // other time — not when a chunk lands, not when the observed window slides
    // (see ResultsSource.queryIdentity). `partsKey` is hashed from chunk 0's
    // request, so it is page/page_size-independent by construction and a
    // scroll-mode `page_size` relabel does not move it either.
    queryIdentity: partsKey,
  }
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
    // One block, the whole page — the array a pages-mode scan has always
    // scanned. `undefined` outside it, so a caller's loop terminates the same
    // way it does in scroll mode.
    getBlock: (index: number) =>
      index >= 0 && index < results.length
        ? { start: 0, rows: results }
        : undefined,
    ensureRange: () => {},
    fetchItem: async (index: number) => results[index],
    // Constantly false, and there is nothing missing behind it: the page's
    // rows are either in hand (the array) or the main query failed, in which
    // case SearchPage's own SearchErrorToast is already saying so — a second,
    // in-panel error affordance for the same failure would be the one that is
    // wrong. Retrying is likewise the main query's business, hence the no-op.
    errorAt: () => false,
    retryRange: () => {},
    rowsIdentity: results,
    // The same value as `rowsIdentity` here, which is the point: a
    // supersession gate written on `queryIdentity` is byte-for-byte the
    // items-identity comparison pages mode has always made.
    queryIdentity: results,
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
  // A superseded call must not write. Unlike `useCommitPageSize` there is
  // nothing to compose — a mode switch is idempotent and the later call simply
  // wins — but the earlier one is still holding a target computed from a URL
  // the later one has already moved past.
  const inFlight = useRef<object | null>(null)
  return async (nextMode: ViewMode) => {
    if (nextMode === viewMode) return
    const push = { history: "push" as const }
    const replace = { history: "replace" as const }
    // The position to carry: the open gallery's item, or the grid's scroll
    // anchor (absent while the top row is visible, hence the 0).
    const galleryOpen = galleryIndex !== null
    const rawAnchor = galleryOpen ? galleryIndex : scrollAnchor ?? 0
    const writes: Promise<unknown>[] = []
    if (nextMode === "scroll") {
      // Nothing is awaited before the writes on this side (the rows on screen
      // already cover the viewport, so there is no prefetch), so there is no
      // window for a second call to interleave and no token to CHECK. The
      // token is still cleared, for the same reason `useCommitPageSize`'s
      // scroll branch clears its own: a pages-direction call still inside its
      // prefetch must not resume and write a `page` into the scroll-mode URL
      // this one is about to produce.
      inFlight.current = null
      // Clamped into the current page before it is globalized, exactly as
      // `useCommitPageSize` clamps and for the same reason: a stale or
      // hand-written index pointing past the page end must remap from the item
      // actually on screen — both display surfaces clamp — or the switch
      // breaks `floor(top / k) === page - 1` and lands the user pages away
      // from what they were looking at.
      const anchor = clampToPage(rawAnchor, pageSize)
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
      //
      // REACHED, and by two callers. The maximized search dock's own seat for
      // ViewModeToggle (design §5.5) is the ordinary one: `gi` IS that dock's
      // selection, so a switch made there routinely arrives with a gallery
      // position set — and the gallery host can be MOUNTED behind the
      // maximized board (showing the board rather than the large image) with
      // its selection push live. It was NOT unreachable before that seat
      // existed, contrary to what this comment used to assert as settled
      // history: the header toggle is rendered by the GRID panel, and the grid
      // panel is exactly what a URL with `gi` set and zero results renders
      // (`liveGalleryHost = qIndex !== null && itemCount > 0`, SearchPage), so
      // `galleryOpen` is true on that path too.
      //
      // Writing the URL is only half of the switch; the display surface's own
      // HELD index is the other, and that half is a real hazard rather than a
      // cosmetic lag: a held index is minted in one coordinate system and
      // names nothing in the other, so left alone it resolves to a DIFFERENT
      // item, gets published as the selection, and every surface that falls
      // back to the selection (the gallery's own picture, the maximized
      // viewer) shows that item for a whole chunk round trip before snapping
      // back. `resultsAreStale` cannot cover the window — it clears the moment
      // the main query settles, which in scroll mode says nothing about the
      // chunk under the new global index. That half now lives where the hold
      // does — ImageGallery drops its hold on a `vm` change, see the trap
      // comment there — rather than being seeded from here, because the hazard
      // belongs to the mode change itself and would otherwise have to be
      // re-solved by every future writer of `vm`.
      if (galleryOpen && global !== galleryIndex) {
        writes.push(setGalleryIndex(global, replace))
      }
    } else {
      // NOT clamped: in scroll mode the anchor already IS a global index, and
      // turning it into a (page, index) pair is exactly what
      // `pageStateFromScrollAnchor` does.
      const target = pageStateFromScrollAnchor({ anchor: rawAnchor, pageSize })
      const token = {}
      inFlight.current = token
      await prefetch({ page: target.page })
      // A later switch superseded this one while its prefetch was in the air.
      // That call owns the writes; this one's target was computed against a
      // URL that has since moved.
      if (inFlight.current !== token) return
      inFlight.current = null
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
 *
 * `alongside` is for a caller whose OWN parameter write has to land in the
 * same URL update as this one. The cell-size slider is that caller and the
 * reason the hook grew a second argument (design §9: cell size and page size
 * are written "in one tick"). Two ticks are observably wrong rather than
 * merely untidy: writing `cs` first re-lays the grid out at the OLD page size,
 * the grid's scroll-stop timer then records an anchor for that intermediate
 * geometry, and it lands after this commit's carefully remapped `top` —
 * clobbering it, and putting the user rows away from the item they were
 * looking at. Called exactly once, inside the write batch and after the
 * supersession check, on every path that reaches a decision; a superseded
 * commit runs nothing, because the call that superseded it carries its own.
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
  return async (
    nextPageSize: number,
    alongside?: () => Promise<unknown> | void
  ) => {
    if (viewMode === "scroll") {
      // Any pages-mode commit still inside its prefetch is abandoned here:
      // its target is a (page, index) pair for a mode the URL has left, and
      // resuming it would write `page` back into a scroll-mode URL — the two-
      // live-position-params bug the mode is defined to avoid. Clearing the
      // token is what makes its post-await check fail.
      inFlight.current = null
      // A pure relabel: `top` and `gi` are global indices that k does not
      // enter into, and no request keys on it either (the main query's does,
      // but it refetches page 1 at the new size and the grid reads chunks).
      // So there is nothing to prefetch and nothing to remap: one param to
      // write, skipped when unchanged, in "replace" like every other
      // non-navigation position write.
      //
      // The companion write is NOT skipped with it: "this page size is already
      // the one you asked for" says nothing about the caller's own parameter,
      // and dropping it here would silently lose a cell-size change whenever
      // the co-write happened to land on the current k.
      if (nextPageSize === pageSize) {
        await alongside?.()
        return
      }
      await Promise.all([
        setPageSize(nextPageSize, { history: "replace" }),
        alongside?.(),
      ])
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
    // Same rule as the scroll branch's: nothing to remap does not mean nothing
    // to write, and the caller's own parameter is not this hook's to drop.
    if (nextPageSize === base.pageSize) {
      await alongside?.()
      return
    }
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
    // FIRST into the batch, so the companion parameter and the remapped
    // position are one URL update and one re-layout. Order inside the tick
    // does not matter to nuqs; being inside it is the whole point.
    const companion = alongside?.()
    if (companion) writes.push(companion)
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
