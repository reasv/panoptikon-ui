import { useMemo } from "react"
import {
  useGalleryHidePinBoard,
  useGalleryPinBoardLayout,
  useGridPinboardTab,
} from "./gallery"
import {
  GridParams,
  V2_GRID,
  migrateRecords,
  parseBoard,
  serializeBoard,
} from "@/lib/pinboardGrid"

// Access to the pinboard's records with the version token handled. Reads
// expose the token-stripped records plus the board's grid parameters.
// Writes go through updateRecords, whose mutate callback works in the
// CURRENT grid's coordinate space; if the board is still v1, the mutated
// result is migrated onto the v2 grid before serializing (lazy migration:
// v1 boards render untouched forever and convert on their first real
// mutation). A mutate that changes nothing leaves the URL alone, so
// rendering a v1 board never migrates it by accident.
export function usePinBoard() {
  const [savedLayout, setSavedLayout] = useGalleryPinBoardLayout()
  const setHidePinBoard = useGalleryHidePinBoard()[1]
  const setGridPinboardTab = useGridPinboardTab()[1]
  const board = useMemo(() => parseBoard(savedLayout), [savedLayout])
  // opts.highWater, when given, is the ABSOLUTE ratchet value to store
  // (callers compute the max themselves — the refit action deliberately
  // lowers it). A write that changes neither the records nor the ratchet
  // leaves the URL alone.
  // opts.history overrides the hook's default "push" for this one write.
  // "replace" is for normalization writes the user didn't ask for (RGL
  // re-compacting a restored or freshly loaded layout): pushing those
  // would park a new entry in FRONT of the one just navigated to, so the
  // back button could never get past an un-compacted entry — every visit
  // re-pushes its normalized form (the back-button trap).
  const updateRecords = (
    mutate: (records: string[], grid: GridParams) => string[],
    opts?: { highWater?: number; history?: "push" | "replace" }
  ) => {
    // Losing the last pin DESTROYS the board, and the view flags that would
    // re-open it must not outlive it: gpb (the grid view's pinboard tab)
    // would otherwise context-switch the whole grid to a future board the
    // moment its first pin lands, and ghp decides the gallery's tab — the
    // next board's creation must set it fresh from its own origin (see
    // PinButton). Centralized here because every unpin path — pin buttons,
    // board verbs, selection removal — is an updateRecords write, while
    // navigation writes (loading a saved board or version) bypass this
    // function by design. Detected against the hook's current records:
    // unpin writes are one-per-tick (same-tick updateRecords calls don't
    // compose anyway, see the crop-commit note in GalleryPinBoard), so the
    // functional write below can't diverge from this precomputation. nuqs
    // merges same-tick writes to different keys into one history entry, so
    // the back button restores the board together with its flags.
    if (
      board.records.length > 0 &&
      mutate(board.records, board.grid).length === 0
    ) {
      void setGridPinboardTab(null)
      void setHidePinBoard(null)
    }
    setSavedLayout((prev) => {
      const { grid, records, isV1, highWater } = parseBoard(prev)
      const next = mutate(records, grid)
      const nextHighWater = opts?.highWater ?? highWater
      if (
        next.length === records.length &&
        next.every((v, i) => v === records[i]) &&
        nextHighWater === highWater
      ) {
        return prev
      }
      return isV1
        ? serializeBoard(V2_GRID, migrateRecords(next, V2_GRID), nextHighWater)
        : serializeBoard(grid, next, nextHighWater)
    }, opts?.history ? { history: opts.history } : undefined)
  }
  // Convert a v1 board to the v2 grid in place, without touching the
  // arrangement — the explicit opt-in alternative to mutating the board
  const upgradeGrid = () => {
    setSavedLayout((prev) => {
      const { records, isV1 } = parseBoard(prev)
      if (!isV1 || records.length === 0) return prev
      return serializeBoard(V2_GRID, migrateRecords(records, V2_GRID))
    })
  }
  return { ...board, updateRecords, upgradeGrid }
}
