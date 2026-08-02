// Library-dialog preferences: how THIS browser browses saved boards and
// opens their links. Deliberately localStorage rather than the URL — board
// state is shareable, these are not: a link must not carry the sender's
// sort choice or new-tab behavior to whoever opens it.
//
// One shared store rather than per-component state: PinboardMenu mounts the
// library dialog and the history panel at the same time, and the history
// panel's hrefs are computed from `cleanLinks`. With per-component copies,
// toggling the checkbox in the library left the history panel's links stale
// until a full reload.

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { useEffect, useState } from "react"
import { persistLocalStorage } from "./store"

/** Matches the gateway's `order` query param on /api/pinboards. */
export type PinboardLibraryOrder = "activity" | "updated"

interface PinboardLibraryPrefsState {
  order: PinboardLibraryOrder
  setOrder: (order: PinboardLibraryOrder) => void
  /**
   * Whether board links opened in a new tab start as a clean maximized board
   * (default) or inherit the current tab's board-affecting view params.
   * Either way the sidebar and search state are never carried.
   */
  cleanLinks: boolean
  setCleanLinks: (cleanLinks: boolean) => void
}

const pinboardLibraryPrefsStorage = {
  name: "pinboardLibraryPrefs",
  storage: createJSONStorage<PinboardLibraryPrefsState>(
    () => persistLocalStorage
  ),
}

export const usePinboardLibraryPrefs = create(
  persist<PinboardLibraryPrefsState>(
    (set) => ({
      order: "activity",
      setOrder: (order: PinboardLibraryOrder) => set({ order }),
      cleanLinks: true,
      setCleanLinks: (cleanLinks: boolean) => set({ cleanLinks }),
    }),
    pinboardLibraryPrefsStorage
  )
)

// Persist rehydrates from storage synchronously as the module loads, so
// rendering the stored value directly would differ from the SSR HTML. Mirror
// it after mount instead: the first render keeps the fallback the server
// produced, and every later store change still lands — including one made by
// another component mounted at the same time.
function useMirroredPreference<T>(stored: T, fallback: T): T {
  const [value, setValue] = useState<T>(fallback)
  useEffect(() => setValue(stored), [stored])
  return value
}

export const usePinboardLibraryOrder = (): [
  PinboardLibraryOrder,
  (next: PinboardLibraryOrder) => void,
] => {
  const stored = usePinboardLibraryPrefs((state) => state.order)
  const setOrder = usePinboardLibraryPrefs((state) => state.setOrder)
  return [useMirroredPreference(stored, "activity"), setOrder]
}

/**
 * Whether board links opened in a new tab start as a clean maximized board
 * (default) or inherit the current tab's board-affecting view params.
 * Either way the sidebar and search state are never carried.
 */
export const usePinboardCleanLinks = (): [boolean, (next: boolean) => void] => {
  const stored = usePinboardLibraryPrefs((state) => state.cleanLinks)
  const setCleanLinks = usePinboardLibraryPrefs((state) => state.setCleanLinks)
  return [useMirroredPreference(stored, true), setCleanLinks]
}
