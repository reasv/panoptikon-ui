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
import { PINBOARD_DEFAULTABLE_KEYS } from "@/lib/pinboardDefaults"
import { useStampBoardFlags } from "@/lib/state/pinboard"
import { useToast } from "@/components/ui/use-toast"

/**
 * Href opening pinboard `pinboardId` at its head (target: "head") or at a
 * specific version id. Built on top of the current search params so the
 * rest of the view (database selection, gallery index) carries over.
 */
export function pinboardOpenHref(
  pathname: string,
  search: { toString(): string },
  pinboardId: number,
  target: "head" | number
): string {
  const params = new URLSearchParams(search.toString())
  params.set("pbid", String(pinboardId))
  params.set("pbl", String(target))
  params.delete("pinboard")
  // The source tab's board-scoped flags must not ride along: the loader
  // stamps the target board's stored flags when it resolves `pbl`.
  for (const key of PINBOARD_DEFAULTABLE_KEYS) params.delete(key)
  params.set("ghp", "false")
  // Land on the pinboard tab either way: ghp covers an open gallery, gpb
  // the grid view (a link opened in a fresh tab has no gallery index)
  params.set("gpb", "true")
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
