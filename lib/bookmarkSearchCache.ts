import type { QueryClient } from "@tanstack/react-query"

// Bookmark status for result cards lives *inside* cached PQL search
// responses (the include_bookmarks enrichment) — there is no separate
// per-item status cache for enriched surfaces. After a bookmark mutation,
// this is the single write path that keeps those cached responses truthful
// until their next natural refetch: it patches the `bookmarked` field on
// every cached search response the mutation could have affected (grid,
// filmstrip, similarity sidebar, prefetched pages — they are all the same
// cache entries).
//
// Scoping rules:
// - Only queries enriched against the same user_data_db are touched; a
//   different bookmark DB is a different bookmark universe.
// - A query enriched under the exact mutated namespace is flipped directly.
// - A query enriched under the wildcard namespace ("*") is flipped too, but
//   a removal can't be answered client-side (the item may remain bookmarked
//   in another namespace), so those responses are additionally marked stale
//   — without an immediate refetch — and self-correct on the next natural
//   one. Bounded staleness in exchange for instant feedback.
// - A query enriched under a *different* exact namespace is untouched:
//   mutations in one namespace cannot change status in another.
export function updateBookmarkStatusInSearchCache(
  queryClient: QueryClient,
  userDataDb: string | null | undefined,
  sha256: string,
  namespace: string,
  bookmarked: boolean
) {
  const cached = queryClient.getQueriesData<{
    results?: SearchResult[] | null
  }>({
    queryKey: ["post", "/api/search/pql"],
    exact: false,
  })
  for (const [queryKey] of cached) {
    const init = queryKey[2] as
      | {
          params?: {
            query?: {
              user_data_db?: string | null
              include_bookmarks?: boolean
              bookmarks_namespace?: string
            }
          }
        }
      | undefined
    const params = init?.params?.query
    if (!params?.include_bookmarks) continue
    if ((params.user_data_db ?? null) !== (userDataDb ?? null)) continue
    const enrichedNs = params.bookmarks_namespace ?? "*"
    const wildcard = enrichedNs === "*"
    if (!wildcard && enrichedNs !== namespace) continue

    queryClient.setQueryData(
      queryKey,
      (old: { results?: SearchResult[] | null } | undefined) => {
        if (!old?.results) return undefined
        let changed = false
        const results = old.results.map((result) => {
          if (
            result.sha256 === sha256 &&
            result.bookmarked != null &&
            result.bookmarked !== bookmarked
          ) {
            changed = true
            return { ...result, bookmarked }
          }
          return result
        })
        // Returning undefined tells tanstack to leave the entry untouched,
        // so untouched pages keep their object identity (and memoized cards
        // their bail-out).
        return changed ? { ...old, results } : undefined
      }
    )

    if (wildcard && !bookmarked) {
      queryClient.invalidateQueries({
        queryKey,
        exact: true,
        refetchType: "none",
      })
    }
  }
}
