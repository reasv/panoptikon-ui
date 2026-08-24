import { create } from "zustand"

// The maximized workspace's EPHEMERAL OPEN state — one boolean per dock.
// "Open" is what a click on a dock's edge handle produces
// (docs/maximized-pinboard-search-overlay-design.md §5.1, §9): a stable
// state that survives pointer moves and focus changes, dismissed by Esc, a
// click outside the panel, or the panel's own close button. It is NOT a
// hover peek — the hot bands and the hover/focus show-state machinery they
// fed were deleted, because the bands ate every click in the outermost 16px
// of the viewport and a bottom-edge hover fought auto-hide taskbars.
//
// Deliberately NOT in the URL (§2): opening a dock for one search must not
// rewrite history, and the SSR prefetch consults the PINNED flags (`gso`,
// `gsb`) alone — a cold load is either pinned-open or closed. Each dock's
// shown state is `open || pinned`.
//
// Two separate flags rather than one, and they are not symmetric:
//
// - `revealed` — the BOTTOM search dock (app/search/SearchOverlay.tsx).
//   Read by useSearchSuppressed (lib/state/gallery.ts): an open bottom dock
//   is a search consumer on screen and enables the query exactly like a
//   pinned one.
// - `sidebarRevealed` — the LEFT sidebar dock (app/search/SidebarOverlay.tsx).
//   Written by the dock itself AND, cross-component, by the overlay
//   search-bar row's settings toggle, which is what makes a second flag
//   necessary rather than local state (§9: that toggle is the "show me the
//   filters" gesture, so it drives OPEN, not the `gsb` pin). Deliberately
//   NOT read by useSearchSuppressed: the sidebar EDITS the query, it does
//   not consume results, so opening it enables nothing.
//
// Both flags are cleared by their dock's unmount effect, so restoring a
// maximized board and re-maximizing starts closed unless pinned.
interface SearchOverlayRevealState {
  revealed: boolean
  setRevealed: (revealed: boolean) => void
  sidebarRevealed: boolean
  setSidebarRevealed: (revealed: boolean) => void
}

export const useSearchOverlayReveal = create<SearchOverlayRevealState>(
  (set) => ({
    revealed: false,
    setRevealed: (revealed: boolean) => set({ revealed }),
    sidebarRevealed: false,
    setSidebarRevealed: (sidebarRevealed: boolean) => set({ sidebarRevealed }),
  })
)
