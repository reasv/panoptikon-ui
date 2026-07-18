import { useMemo } from "react"
import { useGalleryPinBoardLayout } from "./gallery"
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
