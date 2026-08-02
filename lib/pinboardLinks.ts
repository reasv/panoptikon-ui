// Saved-board links and the loader that consumes them.
//
// Library cards and history rows render as real <a> links so boards open
// in new tabs (middle-click, ctrl-click, right-click → open in new tab).
// Board state lives in the URL, but the layout itself is only known after
// a fetch, so links carry a deferred-load reference instead: `pbid` plus
// `pbl` ("head" or a version id). usePinboardURLLoader — mounted with the
// gallery — resolves the reference to a layout, writes it into the URL
// (history: replace, marked as navigation so the auto-layout trigger
// doesn't fire) and clears the marker.

import { useEffect } from "react"
import { fetchClient } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import {
  useGalleryPinBoardId,
  useGalleryPinBoardLayout,
  useGalleryPinBoardLoad,
} from "@/lib/state/gallery"
import { markPinboardNavigation } from "@/lib/pinboardNavigation"
import { useStampBoardFlags } from "@/lib/state/pinboard"
import { useToast } from "@/components/ui/use-toast"

/**
 * How much of the current tab's view a board link reproduces.
 * - `clean`: a maximized board over an otherwise-default view.
 * - `carry`: the current board-affecting view params, and nothing else.
 */
export type PinboardLinkMode = "clean" | "carry"

// Copied in both modes: boards are per-database objects, so without the DB
// selection the link resolves against whatever the opening tab defaults to.
const DB_KEYS = ["index_db", "user_data_db"]
// Carried in carry mode: exactly the params that decide how the board is
// presented — maximized, gallery tab choice, thumbnails. Sidebar (sb/sbt)
// and search state are never carried in either mode.
const CARRIED_VIEW_KEYS = ["gf", "ghp", "gt"]

/**
 * Href opening pinboard `pinboardId` at its head (target: "head") or at a
 * specific version id, for new-tab opens (middle-click, ctrl-click,
 * right-click → open in new tab).
 *
 * Built from scratch rather than on top of the current query string: the
 * source tab's sidebar, search and board-scoped flags must not ride along
 * (the loader stamps the target board's own stored flags when it resolves
 * `pbl`), and an allowlist is the only construction where a parameter
 * added later doesn't silently start leaking.
 */
export function pinboardOpenHref(
  pathname: string,
  search: { toString(): string },
  pinboardId: number,
  target: "head" | number,
  mode: PinboardLinkMode
): string {
  const current = new URLSearchParams(search.toString())
  const params = new URLSearchParams()
  const copy = (keys: string[]) => {
    for (const key of keys) {
      const value = current.get(key)
      if (value !== null) params.set(key, value)
    }
  }

  copy(DB_KEYS)
  params.set("pbid", String(pinboardId))
  params.set("pbl", String(target))
  // A fresh tab has no gallery index, so without the board tab fronted in
  // the grid host the user lands on an empty results grid.
  params.set("gpb", "true")
  if (mode === "clean") {
    // With a board present and gpb on, gf is what makes isPinboardMaximized
    // true: the tab opens as the board and nothing else.
    params.set("gf", "true")
  } else {
    copy(CARRIED_VIEW_KEYS)
  }
  return `${pathname}?${params.toString()}`
}

/** Resolves and consumes a `pbl` deferred-load reference from the URL. */
export function usePinboardURLLoader() {
  const [pbl, setPbl] = useGalleryPinBoardLoad()
  const [pbid] = useGalleryPinBoardId()
  const setSavedLayout = useGalleryPinBoardLayout()[1]
  const stampFlags = useStampBoardFlags()
  const dbs = useSelectedDBs()[0]
  const { toast } = useToast()

  useEffect(() => {
    if (pbl == null) return
    if (pbid == null) {
      void setPbl(null)
      return
    }
    let stale = false
    // Flags are board-level, so both targets stamp the board's stored
    // flags; only the layout depends on which version the link addressed.
    const resolve = async (): Promise<{
      layout: string[]
      flags: unknown
    } | null> => {
      const { data: board } = await fetchClient.GET(
        "/api/pinboards/{pinboard_id}",
        { params: { path: { pinboard_id: pbid }, query: { ...dbs } } }
      )
      if (!board) return null
      if (pbl === "head") {
        const layout = board.head?.layout
        return layout ? { layout, flags: board.flags } : null
      }
      const versionId = Number(pbl)
      if (!Number.isInteger(versionId)) return null
      const { data } = await fetchClient.GET(
        "/api/pinboards/{pinboard_id}/versions",
        { params: { path: { pinboard_id: pbid }, query: { ...dbs } } }
      )
      const layout = data?.versions.find((v) => v.id === versionId)?.layout
      return layout ? { layout, flags: board.flags } : null
    }
    void resolve().then((loaded) => {
      if (stale) return
      if (loaded) {
        markPinboardNavigation()
        setSavedLayout(loaded.layout, { history: "replace" })
        stampFlags(loaded.flags, { history: "replace" })
      } else {
        toast({
          title: "Error",
          description: "Couldn't load the linked pinboard",
          duration: 3000,
        })
      }
      void setPbl(null)
    })
    return () => {
      stale = true
    }
  }, [pbl, pbid])
}
