"use client"
import { create } from "zustand"

// Sticky-carry state: a gallery image "picked up" via shift+click on its
// pin button rides the cursor until dropped on the pinboard (click), or
// cancelled (Esc, right-click, or a click outside the board). Module-level
// store because the picker-uppers (pin buttons in the search grid and
// thumbnail strip) and the consumer (the mounted board) live in distant
// subtrees. Also carries the context menu's "enter Move-to-Hole targeting"
// request for the same reason — the menu lives per-pin, the targeting
// state lives on the board.
interface PinboardCarryState {
  // Full sha256 of the carried image, or null when nothing is carried
  sha256: string | null
  // Whether a board is mounted — with no board there is nowhere to land,
  // so shift+click falls back to a plain pin toggle
  boardMounted: boolean
  // Bumped to ask the mounted board to enter Move-to-Hole targeting for
  // the current selection (the board does the anchored check + toast)
  holeRequest: number
  start: (sha256: string) => void
  cancel: () => void
  setBoardMounted: (mounted: boolean) => void
  requestHoleTarget: () => void
}

export const usePinboardCarry = create<PinboardCarryState>()((set) => ({
  sha256: null,
  boardMounted: false,
  holeRequest: 0,
  start: (sha256) => set({ sha256 }),
  cancel: () => set({ sha256: null }),
  setBoardMounted: (boardMounted) => set({ boardMounted }),
  requestHoleTarget: () => set((s) => ({ holeRequest: s.holeRequest + 1 })),
}))
