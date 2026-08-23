import { create } from "zustand"

// The maximized search overlay's EPHEMERAL reveal state: true while the
// dock is showing its panel for any transient reason — pointer over the
// bottom hot band or the panel, focus inside the panel. Deliberately NOT in
// the URL (docs/maximized-pinboard-search-overlay-design.md §2): a hover
// peek must never rewrite history, and the SSR prefetch consults the
// pinned flag (`gso`) alone — a cold load is either pinned-open or closed.
//
// Written ONLY by the overlay dock (app/search/SearchOverlay.tsx), from an
// effect that mirrors its show-state and clears on unmount. Read by
// useSearchSuppressed (lib/state/gallery.ts): a hover-revealed overlay is
// a search consumer on screen and enables the query exactly like a pinned
// one.
interface SearchOverlayRevealState {
  revealed: boolean
  setRevealed: (revealed: boolean) => void
}

export const useSearchOverlayReveal = create<SearchOverlayRevealState>(
  (set) => ({
    revealed: false,
    setRevealed: (revealed: boolean) => set({ revealed }),
  })
)
