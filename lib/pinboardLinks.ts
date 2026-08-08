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
import { $api, fetchClient } from "@/lib/api"
import type { components } from "@/lib/panoptikon"
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
  mode: PinboardLinkMode,
  /**
   * Index database the link should open the board in, overriding the copied
   * `index_db`. Set for a board that belongs to some OTHER local database
   * (see `owningDatabase`): the switch is explicit in the URL rather than a
   * click-time side effect, so middle-click and new-tab behave identically
   * and the Back button undoes it.
   */
  indexDbOverride?: string | null
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
  if (indexDbOverride) params.set("index_db", indexDbOverride)
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

/** The stamped-database rows every board summary carries. */
export type PinboardDatabaseRow =
  components["schemas"]["PinboardDatabaseResponse"]

/**
 * The local index database a board belongs to when it does NOT belong to the
 * selected one — the name for the card's badge, and the `index_db` its link
 * switches to. Null whenever the card should stay as it is.
 *
 * Rows arrive newest-stamp-first, so the first one that still resolves to a
 * local database is the board's most recent home. A row is skipped when it
 * names the selected database: the board is not associated with it (the
 * server said so — a stamp another instance wrote, or one whose database was
 * rebuilt), so pointing the link back at the database the user is already in
 * would badge the card with its own name and switch nothing.
 *
 * `board.associated` false is the gate: a board the current database owns is
 * never re-pointed elsewhere, however many other databases also stamped it.
 */
export function owningDatabase(
  board: { associated: boolean; databases: PinboardDatabaseRow[] },
  /** Index database names that exist locally (`/api/db` → `index.all`). */
  localNames: string[],
  /** The selected index database's name, resolved through the default. */
  currentName: string | null
): string | null {
  if (board.associated) return null
  const current = currentName?.toLowerCase() ?? null
  for (const row of board.databases) {
    const folded = row.name.toLowerCase()
    if (folded === current) continue
    // Return the folder's own spelling, not the stamp's: the stamp is a
    // residual hint and the URL param has to address a real folder.
    const local = localNames.find((name) => name.toLowerCase() === folded)
    if (local) return local
  }
  return null
}

/**
 * The index databases that exist locally, plus which one is selected —
 * everything the foreign-board badge, its link override and the association
 * editor need in order to turn a stamped NAME into a real database.
 *
 * `index_db` is absent from the URL whenever the server's default is in use,
 * so the current name has to come from `/api/db` in that case; the same
 * fallback the sidebar's database switcher makes.
 *
 * The init argument is `undefined` rather than `{}` on purpose: openapi-react-
 * query keys a query by `[method, path, init]` and drops the third element
 * only when init is undefined, so `{}` would be a second key for the answer
 * the sidebar's database switcher already holds.
 *
 * `enabled` exists because the library dialog is mounted permanently and open
 * rarely — an ungated query there would cost every page load a request for a
 * list nobody is looking at.
 */
export function useIndexDatabaseNames(enabled: boolean = true): {
  localNames: string[]
  currentName: string | null
  /** False until the list has arrived — "not yet" is not "none". */
  ready: boolean
} {
  const { index_db } = useSelectedDBs()[0]
  const { data } = $api.useQuery("get", "/api/db", undefined, {
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
  return {
    localNames: data?.index.all ?? [],
    currentName: index_db ?? data?.index.current ?? null,
    ready: data != null,
  }
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
