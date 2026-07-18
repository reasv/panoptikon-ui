"use client"
import { create } from "zustand"

// Transient multi-selection of pinboard items, keyed by layout key
// (`${recordOffset}-${sha256Prefix}`). Deliberately session-only and NOT
// persisted: selection exists to scope the next layout operation (arrange,
// swap, lock...), not to describe the board. Offsets shift when records are
// added/removed, so the board prunes stale keys against the live layout.
//
// The model follows file-manager (Explorer) conventions: plain click
// replaces the selection with the clicked item, ctrl+click toggles items
// individually, and shift+click selects the reading-order range from the
// ANCHOR to the clicked item. The anchor is rebased by plain clicks and
// ctrl+clicks but NOT by shift+clicks, so successive shift+clicks grow or
// shrink the same range instead of accumulating. The board computes the
// actual ranges — only it knows the item order.
interface PinSelectionState {
  selected: string[]
  // Shift+click range base; null after a clear (the next shift+click then
  // just selects its own item and becomes the base)
  anchor: string | null
  // Set the whole selection at once (plain click, shift+click ranges,
  // marquee drag results)
  replace: (selected: string[], anchor: string | null) => void
  // Ctrl+click: toggle one item and rebase the anchor onto it
  toggle: (key: string) => void
  // Drop keys that no longer exist on the board
  prune: (validKeys: Set<string>) => void
  clear: () => void
}

export const usePinSelection = create<PinSelectionState>()((set) => ({
  selected: [],
  anchor: null,
  replace: (selected, anchor) => set({ selected, anchor }),
  toggle: (key) =>
    set((s) => ({
      selected: s.selected.includes(key)
        ? s.selected.filter((k) => k !== key)
        : [...s.selected, key],
      anchor: key,
    })),
  prune: (validKeys) =>
    set((s) => {
      const kept = s.selected.filter((k) => validKeys.has(k))
      const anchor = s.anchor && validKeys.has(s.anchor) ? s.anchor : null
      return kept.length === s.selected.length && anchor === s.anchor
        ? s
        : { selected: kept, anchor }
    }),
  clear: () => set({ selected: [], anchor: null }),
}))
