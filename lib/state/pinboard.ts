import { useMemo } from "react"
import {
  useGalleryHidePinBoard,
  useGalleryPinAutoCrop,
  useGalleryPinAutoLayout,
  useGalleryPinBoardLayout,
  useGalleryPinGrid,
  useGalleryPinSelectionCrop,
  useGridPinboardTab,
} from "./gallery"
import {
  GridParams,
  V2_GRID,
  migrateRecords,
  parseBoard,
  serializeBoard,
} from "@/lib/pinboardGrid"
import {
  PINBOARD_DEFAULTABLE_FLAGS,
  PINBOARD_DEFAULTABLE_KEYS,
  PinboardDefaultableKey,
  effectiveCreationDefaults,
  sanitizeBoardFlags,
} from "@/lib/pinboardDefaults"

type FlagWriteOpts = { history?: "push" | "replace" }

/** The four board-scoped flags' current resolved values, keyed like the
 * defaults registry — the shape a save sends to the gateway. */
export function usePinboardFlagValues(): Record<
  PinboardDefaultableKey,
  boolean
> {
  return {
    pba: useGalleryPinAutoLayout()[0],
    pbc: useGalleryPinAutoCrop()[0],
    psc: useGalleryPinSelectionCrop()[0],
    pg: useGalleryPinGrid()[0],
  }
}

/** The board-scoped flag setters, keyed like the defaults registry. */
export function usePinboardFlagSetters(): Record<
  PinboardDefaultableKey,
  (value: boolean | null, opts?: FlagWriteOpts) => unknown
> {
  return {
    pba: useGalleryPinAutoLayout()[1],
    pbc: useGalleryPinAutoCrop()[1],
    psc: useGalleryPinSelectionCrop()[1],
    pg: useGalleryPinGrid()[1],
  }
}

/**
 * Stamps a loaded board's stored flags into the URL, clear-then-set: every
 * flag is written, so nothing from the previous board's URL survives a
 * load. Values equal to the codec default clear the parameter instead
 * (absent already means that), keeping loaded URLs canonical. A legacy
 * board (flags null/absent) resolves every flag to its codec default —
 * pre-flags boards keep their pre-flags behavior. Callers write this in
 * the same tick as the layout so nuqs folds board + flags into one history
 * entry.
 */
export function useStampBoardFlags() {
  const setters = usePinboardFlagSetters()
  return (flags: unknown, opts?: FlagWriteOpts) => {
    const stored = sanitizeBoardFlags(flags) ?? {}
    for (const key of PINBOARD_DEFAULTABLE_KEYS) {
      const codecDefault = PINBOARD_DEFAULTABLE_FLAGS[key].codecDefault
      const value = stored[key] ?? codecDefault
      void setters[key](value === codecDefault ? null : value, opts)
    }
  }
}

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
  // Creation stamps the board-scoped flags, destruction clears them (see
  // updateRecords)
  const flagSetters = usePinboardFlagSetters()
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
    // The board's LIFECYCLE edges are both detected here, against the
    // hook's current records: every edit path — pin buttons, drops, board
    // verbs, selection removal — is an updateRecords write, while
    // navigation writes (loading a saved board or version) bypass this
    // function by design, so neither edge can fire on a loaded board.
    // Edit writes are one-per-tick (same-tick updateRecords calls don't
    // compose anyway, see the crop-commit note in GalleryPinBoard), so the
    // functional write below can't diverge from this precomputation. nuqs
    // merges same-tick writes to different keys into one history entry, so
    // the back button restores the board together with its flags.
    const mutated = mutate(board.records, board.grid)
    // Losing the last pin DESTROYS the board, and its board-scoped flags
    // must not outlive it: gpb (the grid view's pinboard tab) would
    // otherwise context-switch the whole grid to a future board the moment
    // its first pin lands, ghp decides the gallery's tab — the next
    // board's creation must set it fresh from its own origin (see
    // PinButton) — and the defaultable flags (auto-layout & co.) belong to
    // the destroyed board: the next creation decides them fresh from the
    // defaults layer, not from what this board left behind.
    if (board.records.length > 0 && mutated.length === 0) {
      void setGridPinboardTab(null)
      void setHidePinBoard(null)
      for (const key of PINBOARD_DEFAULTABLE_KEYS) {
        void flagSetters[key](null)
      }
    }
    // The first pin CREATES the board: stamp the creation defaults (dev
    // layer + user overrides, see lib/pinboardDefaults.ts) into the URL as
    // explicit parameters — but only where they differ from the frozen
    // codec defaults, since an absent parameter already means those. Same
    // tick as the record write, so the board appears in history complete
    // with its flags; same history mode, so a replace-write creation
    // (none exist today) couldn't split into two entries.
    if (board.records.length === 0 && mutated.length > 0) {
      const defaults = effectiveCreationDefaults()
      for (const key of PINBOARD_DEFAULTABLE_KEYS) {
        if (defaults[key] !== PINBOARD_DEFAULTABLE_FLAGS[key].codecDefault) {
          void flagSetters[key](
            defaults[key],
            opts?.history ? { history: opts.history } : undefined
          )
        }
      }
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
