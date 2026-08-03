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
  useGridLibraryTab,
  useGridPinboardTab,
} from "@/lib/state/gallery"
import { useSelectedDBs } from "@/lib/state/database"
import {
  usePinboardFlagValues,
  useStampBoardFlags,
} from "@/lib/state/pinboard"
import { useToast } from "@/components/ui/use-toast"
import { parseBoard } from "@/lib/pinboardGrid"
import {
  blobToBase64,
  composeBoardPreview,
  findBoardElement,
} from "@/lib/pinboardPreview"
import { clearStash } from "@/lib/pinboardStash"
import { markPinboardNavigation } from "@/lib/pinboardNavigation"

type Dbs = { index_db: string | null; user_data_db: string | null }

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

// The preview half of a save body: composited from the live board's
// measured width, at PREVIEW_WIDTH. Shared with the preview refresh, which
// is exactly this composite PUT onto an existing version — the two must
// produce the same picture from the same board or a refresh would change
// what the version looks like beyond its resolution.
//
// A failed composite is not an error here: it yields null fields, which a
// save stores as "version without a picture". Callers that exist only to
// produce an image (the refresh) check for that themselves.
async function composePreviewFields(
  savedLayout: string[],
  dbs: Dbs,
  flags: Record<string, boolean>
) {
  const boardWidth = findBoardElement()?.clientWidth ?? window.innerWidth
  const background =
    getComputedStyle(document.body).backgroundColor || "#09090b"
  let preview = null
  try {
    // flags.pbp is "Scale With Window": the compositor needs it to lay the
    // board out on the same effective grid the screen is using
    preview = await composeBoardPreview(
      savedLayout, dbs, boardWidth, background, !!flags.pbp)
  } catch (err) {
    // A failed composite must never block the save itself; the version
    // just has no preview image.
    console.error("pinboard preview composition failed", err)
  }
  return {
    preview_b64: preview ? await blobToBase64(preview.blob) : null,
    preview_w: preview?.width ?? null,
    preview_h: preview?.height ?? null,
    screenful_h: preview?.screenfulH ?? null,
  }
}

async function buildSaveBody(
  savedLayout: string[],
  dbs: Dbs,
  flags: Record<string, boolean>
) {
  const items = await resolveItems(distinctPrefixes(savedLayout), dbs)
  return {
    layout: savedLayout,
    items,
    ...(await composePreviewFields(savedLayout, dbs, flags)),
    // Board-level editing-behavior flags ride every save; the gateway
    // stores them on the board (never a version), so a flags-only save
    // updates them under a layout no-op.
    flags,
  }
}

export function layoutsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

export function usePinboardActions() {
  const [savedLayout, setSavedLayout] = useGalleryPinBoardLayout()
  const [pbid, setPbid] = useGalleryPinBoardId()
  const setHidePinBoard = useGalleryHidePinBoard()[1]
  const setGridPinboardTab = useGridPinboardTab()[1]
  const setGridLibraryTab = useGridLibraryTab()[1]
  const flagValues = usePinboardFlagValues()
  const stampFlags = useStampBoardFlags()
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
    // A save changes which images a board contains, so the grid's Library
    // tab (boards matching the current search) is stale too.
    queryClient.invalidateQueries({
      queryKey: ["post", "/api/pinboards/search"],
    })
  }

  const createBoard = async (body: Awaited<ReturnType<typeof buildSaveBody>>) => {
    const { data, error } = await fetchClient.POST("/api/pinboards", {
      params: { query: { ...dbs } },
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
      const body = await buildSaveBody(savedLayout, dbs, flagValues)
      if (!forkNew && pbid != null) {
        const { data, error, response } = await fetchClient.POST(
          "/api/pinboards/{pinboard_id}/versions",
          {
            params: {
              path: { pinboard_id: pbid },
              query: { ...dbs },
            },
            body,
          }
        )
        if (data) {
          clearStash(pbid)
          invalidate()
          // Three-way outcome: a layout no-op can still have advanced the
          // board's flags (a settings-only save).
          toast({
            title: !data.no_op
              ? "Pinboard updated"
              : data.flags_updated
                ? "Settings updated"
                : "No changes to save",
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
        { params: { path: { pinboard_id: pbid }, query: { ...dbs } } }
      )
      const relabelHead = board?.head
        ? layoutsEqual(board.head.layout, savedLayout)
        : false
      const { error } = await fetchClient.PATCH(
        "/api/pinboards/{pinboard_id}",
        {
          params: { path: { pinboard_id: pbid }, query: { ...dbs } },
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
   * Re-composites the head version's preview at the board's CURRENT width
   * and today's master resolution, and replaces the stored image on that
   * version. No new version, no time_updated bump: the picture of a saved
   * arrangement is not part of what was saved.
   *
   * Only valid while the live layout equals the head version's — otherwise
   * the new picture would show something the version does not contain — so
   * this re-checks that against a freshly fetched head rather than trusting
   * the caller's cached copy. The menu's own enable/disable is UX; this is
   * the guard.
   *
   * Exact geometry comes from compositing at the width the board is
   * actually rendered at, which is why this lives on the mounted board and
   * there is no batch tool: the save-time width was never stored.
   */
  const refreshPreview = async () => {
    if (pbid == null || savedLayout.length === 0) return
    try {
      const { data: board } = await fetchClient.GET(
        "/api/pinboards/{pinboard_id}",
        { params: { path: { pinboard_id: pbid }, query: { ...dbs } } }
      )
      const head = board?.head
      if (!head) throw new Error("board has no head version")
      if (!layoutsEqual(head.layout, savedLayout)) {
        toast({
          title: "Save first",
          description:
            "The board has unsaved changes, so a new preview would not"
            + " match its latest saved version.",
          duration: 4000,
        })
        return
      }
      const preview = await composePreviewFields(savedLayout, dbs, flagValues)
      if (!preview.preview_b64) throw new Error("composite produced no image")
      const { error } = await fetchClient.PUT(
        "/api/pinboards/{pinboard_id}/versions/{version_id}/preview",
        {
          params: {
            path: { pinboard_id: pbid, version_id: head.id },
            query: { ...dbs },
          },
          body: { ...preview, preview_b64: preview.preview_b64 },
        }
      )
      if (error) throw new Error("preview refresh failed")
      invalidate()
      toast({
        title: "Preview refreshed",
        // Previews are served with immutable cache headers, so sizes this
        // browser already fetched keep showing the old picture.
        description: "Reload with Ctrl+Shift+R if you still see the old one.",
        duration: 4000,
      })
    } catch (err) {
      console.error("pinboard preview refresh failed", err)
      toast({
        title: "Error",
        description: "Failed to refresh the preview",
        duration: 3000,
      })
    }
  }

  /**
   * Loads a saved layout into the live board: a pure URL write, so
   * refresh, back/forward, and bookmarks keep working. nuqs batches the
   * same-tick setters into one history entry. `flags` is the board's
   * stored flags value from the gateway (unknown-typed and sanitized;
   * null/undefined for pre-flags boards) — stamped clear-then-set so the
   * previous board's flags never leak onto the loaded one.
   */
  const loadBoard = (
    pinboardId: number,
    layout: string[],
    flags: unknown,
    options?: { history?: "push" | "replace" }
  ) => {
    const history = options?.history ?? "push"
    markPinboardNavigation()
    setSavedLayout(layout, { history })
    setPbid(pinboardId, { history })
    // Land on the pinboard either way, matching pinboardOpenHref: ghp
    // covers an open gallery, gpb the grid view — without it a load from
    // the grid's Results tab succeeds invisibly.
    setHidePinBoard(false, { history })
    setGridPinboardTab(true, { history })
    // The board tab takes over, so the Library tab it may have been opened
    // from stands down (pins win the precedence either way, but leaving gpl
    // set would send the Results tab to the library instead).
    setGridLibraryTab(false, { history })
    stampFlags(flags, { history })
  }

  return { save, rename, refreshPreview, loadBoard, savedLayout, pbid, dbs }
}
