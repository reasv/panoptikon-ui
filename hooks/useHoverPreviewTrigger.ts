"use client"

import { useSyncExternalStore } from "react"
import {
  getHoverPreviewTrigger,
  getServerHoverPreviewTrigger,
  subscribeHoverPreviewTrigger,
  type HoverPreviewTrigger,
} from "@/lib/state/hoverPreviewTrigger"

/**
 * The React side of the trigger preference (lib/state/hoverPreviewTrigger.ts),
 * which is where every rule about it lives — this is one
 * `useSyncExternalStore` call.
 *
 * READ ONCE PER HOST (the result grid, the gallery filmstrip) and passed down
 * as a stable string, next to the animate mode and the hover-preview
 * capability, and NEVER per card: it is the same answer for every cell on the
 * page, and a subscription in each of them is exactly what F1 removed
 * (docs/grid-scroll-performance-implementation.md §2).
 *
 * The server snapshot is the default, and the box only reads localStorage from
 * inside its first `subscribe` — which React calls after the commit — so the
 * first client render is the markup the server produced and a stored `"card"`
 * lands as an ordinary update in the commit after hydration.
 */
export function useHoverPreviewTrigger(): HoverPreviewTrigger {
  return useSyncExternalStore(
    subscribeHoverPreviewTrigger,
    getHoverPreviewTrigger,
    getServerHoverPreviewTrigger
  )
}
