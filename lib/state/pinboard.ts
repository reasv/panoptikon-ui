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
  const updateRecords = (
    mutate: (records: string[], grid: GridParams) => string[]
  ) => {
    setSavedLayout((prev) => {
      const { grid, records, isV1 } = parseBoard(prev)
      const next = mutate(records, grid)
      if (
        next.length === records.length &&
        next.every((v, i) => v === records[i])
      ) {
        return prev
      }
      return isV1
        ? serializeBoard(V2_GRID, migrateRecords(next, V2_GRID))
        : serializeBoard(grid, next)
    })
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
