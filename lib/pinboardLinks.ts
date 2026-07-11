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
  params.set("ghp", "false")
  return `${pathname}?${params.toString()}`
}

/** Resolves and consumes a `pbl` deferred-load reference from the URL. */
export function usePinboardURLLoader() {
  const [pbl, setPbl] = useGalleryPinBoardLoad()
  const [pbid] = useGalleryPinBoardId()
  const setSavedLayout = useGalleryPinBoardLayout()[1]
  const dbs = useSelectedDBs()[0]
  const { toast } = useToast()

  useEffect(() => {
    if (pbl == null) return
    if (pbid == null) {
      void setPbl(null)
      return
    }
    let stale = false
    const resolve = async (): Promise<string[] | null> => {
      if (pbl === "head") {
        const { data } = await fetchClient.GET(
          "/api/pinboards/{pinboard_id}",
          { params: { path: { pinboard_id: pbid }, query: { ...dbs } } }
        )
        return data?.head?.layout ?? null
      }
      const versionId = Number(pbl)
      if (!Number.isInteger(versionId)) return null
      const { data } = await fetchClient.GET(
        "/api/pinboards/{pinboard_id}/versions",
        { params: { path: { pinboard_id: pbid }, query: { ...dbs } } }
      )
      return data?.versions.find((v) => v.id === versionId)?.layout ?? null
    }
    void resolve().then((layout) => {
      if (stale) return
      if (layout) {
        markPinboardNavigation()
        setSavedLayout(layout, { history: "replace" })
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
