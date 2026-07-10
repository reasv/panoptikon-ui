// Save/fork/rename/load actions for saved pinboards.
//
// Save semantics are uniform and never depend on how the current layout was
// reached: with a `pbid` in the URL, Save appends a new head version of
// that board (the gateway no-ops when the layout is byte-identical to the
// head); without one — or with "Save as new copy" — it creates a new board
// and points `pbid` at it. "Which version am I on" is never tracked state:
// it is derived by layout equality wherever needed (rename's relabel_head,
// the version browser's highlight).

import { useQueryClient } from "@tanstack/react-query"
import { fetchClient } from "@/lib/api"
import {
  useGalleryHidePinBoard,
  useGalleryPinBoardId,
  useGalleryPinBoardLayout,
} from "@/lib/state/gallery"
import { useSelectedDBs } from "@/lib/state/database"
import { useToast } from "@/components/ui/use-toast"
import { parseBoard } from "@/lib/pinboardGrid"
import {
  blobToBase64,
  composeBoardPreview,
  findBoardElement,
} from "@/lib/pinboardPreview"
import { clearStash } from "@/lib/pinboardStash"

type Dbs = { index_db: string | null; user_data_db: string | null }

// The grafted Rust-gateway types declare db params as optional strings,
// while useSelectedDBs yields nulls (matching the Python-era types).
export function dbQuery(dbs: Dbs): {
  index_db?: string
  user_data_db?: string
} {
  return {
    index_db: dbs.index_db ?? undefined,
    user_data_db: dbs.user_data_db ?? undefined,
  }
}

function distinctPrefixes(savedLayout: string[]): string[] {
  const { records } = parseBoard(savedLayout)
  const prefixes = new Set<string>()
  for (let i = 0; i + 4 < records.length; i += 5) {
    const sha256 = records[i]
    if (sha256 !== "__preview") prefixes.add(sha256)
  }
  return [...prefixes]
}

// Resolves the layout's sha256 prefixes to full hashes for the gateway's
// search-index rows. Prefixes whose items are missing from the index are
// skipped: they can't be searched anyway, and the layout (the source of
// truth) keeps them regardless.
async function resolveItems(
  prefixes: string[],
  dbs: Dbs
): Promise<string[]> {
  const results = await Promise.allSettled(
    prefixes.map((prefix) =>
      fetchClient.GET("/api/items/item", {
        params: { query: { ...dbs, id: prefix, id_type: "sha256" } },
      })
    )
  )
  const items = new Set<string>()
  for (const result of results) {
    if (result.status === "fulfilled") {
      const sha256 = result.value.data?.item?.sha256
      if (sha256) items.add(sha256)
    }
  }
  return [...items]
}

async function buildSaveBody(savedLayout: string[], dbs: Dbs) {
  const items = await resolveItems(distinctPrefixes(savedLayout), dbs)
  const boardWidth = findBoardElement()?.clientWidth ?? window.innerWidth
  const background =
    getComputedStyle(document.body).backgroundColor || "#09090b"
  let preview = null
  try {
    preview = await composeBoardPreview(savedLayout, dbs, boardWidth, background)
  } catch (err) {
    // A failed composite must never block the save itself; the version
    // just has no preview image.
    console.error("pinboard preview composition failed", err)
  }
  return {
    layout: savedLayout,
    items,
    preview_b64: preview ? await blobToBase64(preview.blob) : null,
    preview_w: preview?.width ?? null,
    preview_h: preview?.height ?? null,
    screenful_h: preview?.screenfulH ?? null,
  }
}

export function layoutsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

export function usePinboardActions() {
  const [savedLayout, setSavedLayout] = useGalleryPinBoardLayout()
  const [pbid, setPbid] = useGalleryPinBoardId()
  const setHidePinBoard = useGalleryHidePinBoard()[1]
  const dbs = useSelectedDBs()[0]
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["get", "/api/pinboards"] })
    queryClient.invalidateQueries({
      queryKey: ["get", "/api/pinboards/{pinboard_id}"],
    })
    queryClient.invalidateQueries({
      queryKey: ["get", "/api/pinboards/{pinboard_id}/versions"],
    })
  }

  const createBoard = async (body: Awaited<ReturnType<typeof buildSaveBody>>) => {
    const { data, error } = await fetchClient.POST("/api/pinboards", {
      params: { query: { ...dbQuery(dbs) } },
      body: { name: null, ...body },
    })
    if (error || !data) throw new Error("create failed")
    return data
  }

  /**
   * Saves the current board. `forkNew` forces a new board (Save as new
   * copy) regardless of `pbid`, leaving the original untouched.
   */
  const save = async (forkNew: boolean) => {
    if (savedLayout.length === 0) return
    try {
      const body = await buildSaveBody(savedLayout, dbs)
      if (!forkNew && pbid != null) {
        const { data, error, response } = await fetchClient.POST(
          "/api/pinboards/{pinboard_id}/versions",
          {
            params: {
              path: { pinboard_id: pbid },
              query: { ...dbQuery(dbs) },
            },
            body,
          }
        )
        if (data) {
          clearStash(pbid)
          invalidate()
          toast({
            title: data.no_op ? "No changes to save" : "Pinboard updated",
            duration: 2000,
          })
          return
        }
        // The board was deleted since it was loaded: fall through and
        // recreate it rather than failing the save.
        if (!error || response.status !== 404) throw new Error("save failed")
      }
      const created = await createBoard(body)
      setPbid(created.pinboard_id)
      if (pbid != null) clearStash(pbid)
      invalidate()
      toast({ title: "Pinboard saved", duration: 2000 })
    } catch (err) {
      console.error("pinboard save failed", err)
      toast({
        title: "Error",
        description: "Failed to save pinboard",
        duration: 3000,
      })
    }
  }

  /**
   * Renames board `pbid`. relabel_head is derived, not tracked: when the
   * current layout equals the head version's, the rename labels the state
   * being looked at, so the head's name-at-save snapshot is rewritten too.
   */
  const rename = async (name: string | null) => {
    if (pbid == null) return
    try {
      const { data: board } = await fetchClient.GET(
        "/api/pinboards/{pinboard_id}",
        { params: { path: { pinboard_id: pbid }, query: { ...dbQuery(dbs) } } }
      )
      const relabelHead = board?.head
        ? layoutsEqual(board.head.layout, savedLayout)
        : false
      const { error } = await fetchClient.PATCH(
        "/api/pinboards/{pinboard_id}",
        {
          params: { path: { pinboard_id: pbid }, query: { ...dbQuery(dbs) } },
          body: { name, relabel_head: relabelHead },
        }
      )
      if (error) throw new Error("rename failed")
      invalidate()
      toast({ title: "Renamed pinboard", duration: 2000 })
    } catch (err) {
      console.error("pinboard rename failed", err)
      toast({
        title: "Error",
        description: "Failed to rename pinboard",
        duration: 3000,
      })
    }
  }

  /**
   * Loads a saved layout into the live board: a pure URL write, so
   * refresh, back/forward, and bookmarks keep working. nuqs batches the
   * same-tick setters into one history entry.
   */
  const loadBoard = (
    pinboardId: number,
    layout: string[],
    options?: { history?: "push" | "replace" }
  ) => {
    const history = options?.history ?? "push"
    setSavedLayout(layout, { history })
    setPbid(pinboardId, { history })
    setHidePinBoard(false, { history })
  }

  return { save, rename, loadBoard, savedLayout, pbid, dbs }
}
