import type { QueryClient } from "@tanstack/react-query"
import { fetchClient } from "./api"
import type { operations } from "./panoptikon"

type DBs = { index_db: string | null, user_data_db: string | null }

type ItemRecord = operations["item_meta"]["responses"][200]["content"]["application/json"]

// GET /api/items/item stats every file row server-side, which on the SMB-NAS
// deployment is a network round trip per call. The file actions call it on
// every click (path, filename, size, full hash), so the answer rides the
// TanStack cache under the SAME key openapi-react-query would build
// ([method, path, init]) — repeat clicks, the share button and the open/reveal
// actions all share one entry. Short-lived: a path that moved on disk must not
// stay wrong for long.
const ITEM_STALE_MS = 30_000

/**
 * The item record for a sha256 (full hash or prefix), from cache when fresh.
 *
 * Returns null for a miss instead of throwing — an item whose files are all
 * gone from disk comes back with an empty `files[]`, and the callers treat
 * that as "no native path", falling back to Download. Only a transport
 * failure rejects.
 */
export async function fetchItemRecord(
  queryClient: QueryClient,
  dbs: DBs,
  sha256: string,
): Promise<ItemRecord | null> {
  const params = { query: { ...dbs, id_type: "sha256" as const, id: sha256 } }
  return queryClient.fetchQuery({
    queryKey: ["get", "/api/items/item", { params }],
    queryFn: async () => {
      const result = await fetchClient.GET("/api/items/item", { params })
      return result.data ?? null
    },
    staleTime: ITEM_STALE_MS,
  })
}
