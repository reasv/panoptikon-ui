import type { SearchQueryArgs } from "@/app/search/queryFns"
import { components } from "./panoptikon"

// Server-side prefetching is worth it exactly when the query cost does not
// scale down with LIMIT — vector searches scan every candidate embedding
// regardless of page size, so the marginal cost of fetching extra rows in the
// same execution is noise. For cheap indexed queries it is a real tax, hence 0
// there.
//
// The budget is a plain row count and goes to the server as one: the result
// cache stores rows as page-size-agnostic spans, so ~320 cached rows serve any
// window inside them whatever page size asks. This used to be back-computed
// into a page count (`floor(320 / size) - 1`), which lost rows to rounding —
// at page size 100 it asked for 300, not 320.
const VECTOR_PREFETCH_ROW_BUDGET = 320
// Any value would do — see the count request below. Exported because the
// sidebar's similarity count query has to pin the same one: a count that
// differs only in page size is a cache miss for a value already in hand.
export const COUNT_QUERY_PAGE_SIZE = 10
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
export function prefetchRowsFor(
  query: components["schemas"]["PqlQuery"]["query"]
): number {
  return hasVectorFilter(query) ? VECTOR_PREFETCH_ROW_BUDGET : 0
}

/**
 * Everything the main search request is made of, gathered from wherever the
 * caller happens to live — nuqs hooks and zustand on the client, parsed search
 * params on the server.
 */
export interface SearchRequestParts {
  searchQuery: components["schemas"]["PqlQuery"]
  dbs: { index_db: string | null; user_data_db: string | null }
  /** Unknowable during SSR (it lives in localStorage); pass the default there. */
  bookmarkNs: string
  partitionBy: components["schemas"]["PqlQuery"]["partition_by"]
}

/** A page to build the request for; each field falls back to the URL's value. */
export interface PageOverrides {
  page?: number
  pageSize?: number
}

/**
 * The results request, built once for every caller that needs it.
 *
 * react-query keys this query by the whole request object, so a field that one
 * builder sets and another omits is not a detail — absent and `0` hash
 * differently, and the two callers then fetch the same rows under two keys.
 * That has happened three times now (a missing `seed`, a missing
 * `prefetch_rows`, and the SSR prefetch missing `prefetch_rows` outright,
 * which made every page load fetch its results twice), always because the
 * request was assembled in two places and only one of them was updated. Hence
 * one builder: identity by construction rather than by parallel maintenance.
 */
export function buildResultsRequest(
  { searchQuery, dbs, bookmarkNs, partitionBy }: SearchRequestParts,
  { page, pageSize }: PageOverrides = {}
): SearchQueryArgs {
  return {
    params: {
      query: {
        ...dbs,
        // Bookmark status rides along with the results (backend post-query
        // enrichment) so the grid's bookmark buttons never fire per-item GETs.
        include_bookmarks: true,
        bookmarks_namespace: bookmarkNs,
      },
    },
    body: {
      ...searchQuery,
      ...(pageSize !== undefined ? { page_size: pageSize } : {}),
      ...(page !== undefined ? { page } : {}),
      partition_by: partitionBy,
      results: true,
      count: false,
      prefetch_rows: prefetchRowsFor(searchQuery.query),
    },
  }
}

/**
 * The count request. Compiled without pagination and cached under a
 * pagination-free key server-side, so neither the page nor the page size can
 * change the answer: both are pinned to constants so that turning a page or
 * resizing one doesn't re-key this query and cost a round trip for a value
 * already in hand.
 */
export function buildCountRequest({
  searchQuery,
  dbs,
  partitionBy,
}: SearchRequestParts): SearchQueryArgs {
  // Dropped rather than left to the spread: on the SSR-hydrated render
  // `searchQuery` is the results request's own body (see useSearch's server
  // branch), and inheriting its `prefetch_rows` would key this count query
  // apart from the one the server prefetched — the same absent-vs-set split
  // this builder exists to close. A count fetches no rows to prefetch.
  const { prefetch_rows, ...query } = searchQuery
  return {
    params: {
      query: { ...dbs },
    },
    body: {
      ...query,
      page: 1,
      page_size: COUNT_QUERY_PAGE_SIZE,
      partition_by: partitionBy,
      results: false,
      count: true,
    },
  }
}
