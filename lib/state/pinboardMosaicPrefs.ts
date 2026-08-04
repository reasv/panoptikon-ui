// Mosaic-export preferences: how THIS browser saves a board as an image.
//
// localStorage only, exactly like pinboardLibraryPrefs and for the same
// reason: board state is shareable and these are not. A mosaic's extent
// and seams are a property of what the user wants OUT of the app, not of
// the arrangement — so they are deliberately not in the URL, not in the
// board's flags (which save to the server and reload with the board), and
// not in saved versions.

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { useEffect, useState } from "react"
import { persistLocalStorage } from "./store"

/**
 * How much of the board a mosaic captures: "visible" is the fill target —
 * max(current fold rows, the layout ratchet), the rows the board is meant
 * to show, with straddling items clipped at the line — and "full" is the
 * entire content bounding box.
 */
export type PinboardMosaicExtent = "visible" | "full"

interface PinboardMosaicPrefsState {
  /** Tile on the step lattice: no gutters, no padding, square corners. */
  seamless: boolean
  setSeamless: (seamless: boolean) => void
  extent: PinboardMosaicExtent
  setExtent: (extent: PinboardMosaicExtent) => void
  /**
   * Save exports as PNG instead of JPEG. For a single item that means no
   * re-encoding loss on top of a lossless source; for a mosaic it also
   * means the background is never painted, so gutters, letterboxing,
   * rounded corners and the holes a selection leaves come out transparent
   * instead of filled with the page's own black.
   */
  lossless: boolean
  setLossless: (lossless: boolean) => void
}

const pinboardMosaicPrefsStorage = {
  name: "pinboardMosaicPrefs",
  storage: createJSONStorage<PinboardMosaicPrefsState>(
    () => persistLocalStorage
  ),
}

export const usePinboardMosaicPrefs = create(
  persist<PinboardMosaicPrefsState>(
    (set) => ({
      seamless: false,
      setSeamless: (seamless: boolean) => set({ seamless }),
      extent: "visible",
      setExtent: (extent: PinboardMosaicExtent) => set({ extent }),
      lossless: false,
      setLossless: (lossless: boolean) => set({ lossless }),
    }),
    pinboardMosaicPrefsStorage
  )
)

// Persist rehydrates synchronously as the module loads, so rendering the
// stored value directly would differ from the SSR HTML; mirror it after
// mount instead (the same dance pinboardLibraryPrefs documents).
function useMirroredPreference<T>(stored: T, fallback: T): T {
  const [value, setValue] = useState<T>(fallback)
  useEffect(() => setValue(stored), [stored])
  return value
}

export const usePinboardMosaicSeamless = (): [
  boolean,
  (next: boolean) => void,
] => {
  const stored = usePinboardMosaicPrefs((state) => state.seamless)
  const setSeamless = usePinboardMosaicPrefs((state) => state.setSeamless)
  return [useMirroredPreference(stored, false), setSeamless]
}

export const usePinboardExportLossless = (): [
  boolean,
  (next: boolean) => void,
] => {
  const stored = usePinboardMosaicPrefs((state) => state.lossless)
  const setLossless = usePinboardMosaicPrefs((state) => state.setLossless)
  return [useMirroredPreference(stored, false), setLossless]
}

export const usePinboardMosaicExtent = (): [
  PinboardMosaicExtent,
  (next: PinboardMosaicExtent) => void,
] => {
  const stored = usePinboardMosaicPrefs((state) => state.extent)
  const setExtent = usePinboardMosaicPrefs((state) => state.setExtent)
  return [useMirroredPreference(stored, "visible"), setExtent]
}
