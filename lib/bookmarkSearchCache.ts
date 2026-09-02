import type { QueryClient } from "@tanstack/react-query"
import { toast } from "@/components/ui/use-toast"

/** The per-namespace bookmark endpoint, PUT to add and DELETE to remove. */
export const BOOKMARK_PATH = "/api/bookmarks/ns/{namespace}/{sha256}"

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

/** The two databases every bookmark request is scoped to. */
export interface BookmarkDbs {
  index_db: string | null
  user_data_db: string | null
}

/**
 * The add/remove pair, as the minimum this needs of them. Structural on
 * purpose: the caller holds real `$api.useMutation` results, and naming their
 * full generic type here would drag openapi-react-query's inference into a
 * module whose only interest is `mutate`.
 */
export interface BookmarkMutations {
  add: {
    mutate(
      variables: {
        params: { path: { namespace: string; sha256: string }; query: BookmarkDbs }
      },
      options: { onSuccess: () => void; onError: (error: any) => void }
    ): void
  }
  remove: BookmarkMutations["add"]
}

/**
 * Add or remove a bookmark, and make every surface showing that item agree
 * about it immediately.
 *
 * Extracted from CellActionsHost, which is a subscription owner rather than a
 * place for the bookmark protocol: the cache patch, the two invalidations and
 * the toasts are one procedure, and it belongs next to
 * updateBookmarkStatusInSearchCache — the only interesting thing it does.
 *
 * The HOST still owns the mutation objects (it holds one pair for the whole
 * page, which is the point of the host) and still reads the current DBs and
 * namespace out of its render-assigned box at invocation time; it hands both
 * in here rather than this module reaching for a hook of its own.
 *
 * `isBookmarked` is the card's CURRENT state — what the user is toggling away
 * from — not the state being written. The mutation result is authoritative for
 * everything after it: the cache patch flips every cached search response so
 * this card, and any other card showing the same item, changes without a
 * refetch, and the two invalidations cover the per-item queries the detail
 * surfaces read.
 */
export function toggleBookmark(
  queryClient: QueryClient,
  mutations: BookmarkMutations,
  query: BookmarkDbs,
  namespace: string,
  sha256: string,
  isBookmarked: boolean
) {
  const params = { path: { namespace, sha256 }, query }
  const onSuccess = (deleted: boolean) => {
    updateBookmarkStatusInSearchCache(
      queryClient,
      query.user_data_db,
      sha256,
      namespace,
      !deleted
    )
    queryClient.invalidateQueries({
      queryKey: ["get", BOOKMARK_PATH, { params }],
    })
    queryClient.invalidateQueries({
      queryKey: ["get", "/api/bookmarks/item/{sha256}", {
        params: { path: { sha256 }, query },
      }],
    })
    toast({
      title: `Bookmark ${deleted ? "removed" : "added"}`,
      description: `File has been ${deleted ? "removed from" : "added to"} the ${namespace} group`,
      duration: 2000,
    })
  }
  const onError = (error: any) => {
    toast({
      title: "Failed to update bookmark",
      description: error.message,
      variant: "destructive",
      duration: 2000,
    })
  }
  const mutation = isBookmarked ? mutations.remove : mutations.add
  mutation.mutate({ params }, {
    onSuccess: () => onSuccess(isBookmarked),
    onError,
  })
}
