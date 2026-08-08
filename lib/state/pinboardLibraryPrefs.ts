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
  /**
   * Whether board listings show only the boards associated with the selected
   * index database. One preference, three surfaces (library modal, the grid's
   * Library tab, the sidebar's board picker): a board list that hides foreign
   * boards in one place and not another reads as a bug, and the combobox has
   * no room for a toggle of its own.
   */
  associatedOnly: boolean
  setAssociatedOnly: (associatedOnly: boolean) => void
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
      // Default on: a board whose items the selected database doesn't have
      // renders broken images, and boards are the only surface that breaks
      // rather than emptying on a database switch. Users who want the whole
      // library turn it off; the preference then travels to all three
      // surfaces at once.
      associatedOnly: true,
      setAssociatedOnly: (associatedOnly: boolean) => set({ associatedOnly }),
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

/**
 * Whether board listings show only the boards associated with the selected
 * index database. Read by every listing surface; only the library modal
 * offers the checkbox that writes it.
 */
export const usePinboardAssociatedOnly = (): [
  boolean,
  (next: boolean) => void,
] => {
  const stored = usePinboardLibraryPrefs((state) => state.associatedOnly)
  const setAssociatedOnly = usePinboardLibraryPrefs(
    (state) => state.setAssociatedOnly
  )
  return [useMirroredPreference(stored, true), setAssociatedOnly]
}
