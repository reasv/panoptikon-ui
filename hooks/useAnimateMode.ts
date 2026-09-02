"use client"

import { useSyncExternalStore } from "react"
import {
  cellRange,
  getAnimateSettings,
  getServerAnimateSettings,
  resolveAnimateMode,
  subscribeAnimateSettings,
  type CellRange,
} from "@/lib/state/animatePref"
import type { AnimateMode } from "@/lib/thumbnailTier"

/**
 * The React side of the animate preference (lib/state/animatePref.ts), which
 * is where every rule about it lives — this is one `useSyncExternalStore` call
 * and a pure resolution over what it returns.
 *
 * READ ONCE PER HOST, next to the tier and the animated floor, and passed down
 * as a stable string: it is the same answer for every card on the page, and a
 * subscription in each of them is exactly what F1 removed
 * (docs/grid-scroll-performance-implementation.md §2).
 *
 * @param cellWidth the laid-out cell width in CSS pixels, which decides which
 * range's slot applies. 0 (unmeasured) reads as the ABOVE range, i.e. today's
 * always-animate default — the conservative direction, and the grid renders no
 * cells before it has measured anyway.
 */
export function useAnimateMode(cellWidth: number): AnimateMode {
  return useAnimateModeForRange(cellRange(cellWidth))
}

/** The same answer for a range the caller has already decided. */
export function useAnimateModeForRange(range: CellRange): AnimateMode {
  const settings = useSyncExternalStore(
    subscribeAnimateSettings,
    getAnimateSettings,
    getServerAnimateSettings
  )
  return resolveAnimateMode(settings, range)
}
