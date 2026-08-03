import { useMemo } from "react"
import {
  useGalleryHidePinBoard,
  useGalleryPinAutoCrop,
  useGalleryPinAutoLayout,
  useGalleryPinBoardLayout,
  useGalleryPinGrid,
  useGalleryPinProportional,
  useGalleryPinResizeHandles,
  useGalleryPinSelectionCrop,
  useGridPinboardTab,
} from "./gallery"
import {
  GridParams,
  V2_GRID,
  bakeGrid,
  gridScale,
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

/** The board-scoped flags' current resolved values, keyed like the
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
    pbp: useGalleryPinProportional()[0],
    prh: useGalleryPinResizeHandles()[0],
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
    pbp: useGalleryPinProportional()[1],
    prh: useGalleryPinResizeHandles()[1],
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
      const { grid, records, isV1, highWater, float, refWidth } =
        parseBoard(prev)
      const next = mutate(records, grid)
      const nextHighWater = opts?.highWater ?? highWater
      if (
        next.length === records.length &&
        next.every((v, i) => v === records[i]) &&
        nextHighWater === highWater
      ) {
        return prev
      }
      // The ext switches (gravity, reference width) are board state that no
      // record mutation may drop: read off the token, written straight back.
      // A v1 board has none by definition, and migration mints none — except
      // at the creation edge, where the FIRST pin's token carries the user's
      // gravity default (the token-backed member of the creation-defaults
      // set; the parameter-backed ones are stamped above). Same tick, same
      // write, so the new board enters history complete.
      const ext =
        records.length === 0 && next.length > 0
          ? { float: !effectiveCreationDefaults().gravity, refWidth: 0 }
          : { float, refWidth }
      return isV1
        ? serializeBoard(
            V2_GRID, migrateRecords(next, V2_GRID), nextHighWater, ext)
        : serializeBoard(grid, next, nextHighWater, ext)
    }, opts?.history ? { history: opts.history } : undefined)
  }
  // Gravity (RGL's upward compaction) on/off, stored as the token's float
  // switch — a plain push write like every other layout write, so the back
  // button undoes the whole-board settle that turning it back on produces.
  // No-op on an empty board: there is no token to carry the switch, and a
  // board that doesn't exist yet takes its gravity from the creation
  // defaults above. A v1 board migrates, like any other real mutation.
  const setFloat = (next: boolean) => {
    setSavedLayout((prev) => {
      const { grid, records, isV1, highWater, float, refWidth } =
        parseBoard(prev)
      if (records.length === 0 || float === next) return prev
      const ext = { float: next, refWidth }
      return isV1
        ? serializeBoard(
            V2_GRID, migrateRecords(records, V2_GRID), highWater, ext)
        : serializeBoard(grid, records, highWater, ext)
    })
  }
  // "Scale With Window" on/off. The switch itself is a board flag (pbp),
  // but both edges also write the layout token, and BOTH are inert by
  // construction — which is the whole point: the toggle freezes what is on
  // screen, it never re-shapes the board.
  //
  //   ON  — stamp the reference width := the board's current pixel width.
  //         At that instant the scale is exactly 1, so nothing moves; from
  //         then on the grid scales with the window.
  //   OFF — bake the effective (scaled) grid values back into the token as
  //         integers and DROP the reference width: it is dead state while
  //         the flag is off (only gridScale reads it, and it is always
  //         gated on the flag), and the ON edge always stamps a fresh one,
  //         so re-enabling is inert again regardless. Dropping it is also
  //         what makes an ON -> straight-OFF at the same width restore the
  //         token byte for byte, instead of leaving a `~w<int>` nothing
  //         consumes — enough of a difference for the next Save to mint a
  //         new version rather than the settings-only no_op.
  //         The bake is inert only up to rounding, and that rounding is
  //         NOT small: it lands on the row STEP, which item positions
  //         accumulate down the board, so the relative error is
  //         1/(step*scale) — negligible near scale 1, up to a third of the
  //         board's height at the small scales a wide reference width
  //         produces in a narrow window (see bakeGrid in pinboardGrid.ts).
  //
  // The flag write rides the same tick as the layout write, so nuqs folds
  // them into ONE history entry (the first-pin edge does the same) and Back
  // undoes the toggle whole. No-op on an empty board: there is no token to
  // carry the reference width, exactly like gravity.
  const setProportional = (next: boolean, boardWidth: number) => {
    if (board.records.length === 0) return
    const width = Math.round(boardWidth)
    setSavedLayout((prev) => {
      const { grid, records, isV1, highWater, float, refWidth } =
        parseBoard(prev)
      if (records.length === 0) return prev
      // Absent/unmeasurable width: the flag still flips, but there is no
      // honest reference to stamp, so the token keeps what it had (the
      // board renders unscaled until a real measurement stamps one — see
      // the stamping effect in GalleryPinBoard).
      if (width <= 0) return prev
      const scale = next ? 1 : gridScale(true, refWidth, width)
      // Turning OFF with nothing to bake and no reference to drop changes
      // NOTHING — so it must not touch the token at all, migration
      // included: a v1 board (no ext by definition, hence always this
      // case) would otherwise convert to the v2 lattice on a toggle that
      // cannot move a single pixel.
      if (!next && scale === 1 && refWidth === 0) return prev
      const ext = { float, refWidth: next ? width : 0 }
      const nextGrid = bakeGrid(grid, scale)
      const out = isV1
        ? serializeBoard(
            V2_GRID, migrateRecords(records, V2_GRID), highWater, ext)
        : serializeBoard(nextGrid, records, highWater, ext)
      // Backstop for every other inert edge (re-stamping the width a board
      // already carries): an unchanged token is handed back by identity, so
      // no history entry and no new version can come of it.
      return out.length === prev.length && out.every((v, i) => v === prev[i])
        ? prev
        : out
    })
    void flagSetters.pbp(next === PINBOARD_DEFAULTABLE_FLAGS.pbp.codecDefault
      ? null : next)
  }
  // Stamps a reference width onto a board that has the flag on but no
  // reference yet — a board created with the flag as its creation default,
  // or one whose token predates the feature. Never a user action, so it
  // REPLACES rather than pushing (the same rule RGL's normalization writes
  // follow), and it is inert: until it lands the scale is 1 anyway.
  //
  // A v1 board is never stamped. Serializing one migrates it to the v2
  // lattice, and this write is render-triggered and un-undoable (replace,
  // no Back entry), so stamping would convert a v1-era board to v2 merely
  // because someone LOOKED at a version whose flags carry pbp — exactly
  // the accident the lazy-migration rule at the top of this file forbids.
  // v1 boards therefore render unscaled (no refWidth => scale 1, which is
  // what they have always looked like) until a real mutation, or an
  // explicit toggle, migrates them. The caller skips v1 boards too; this
  // guard is the invariant's home.
  const stampRefWidth = (boardWidth: number) => {
    const width = Math.round(boardWidth)
    if (width <= 0) return
    setSavedLayout((prev) => {
      const { grid, records, isV1, highWater, float, refWidth } =
        parseBoard(prev)
      if (isV1 || records.length === 0 || refWidth > 0) return prev
      return serializeBoard(grid, records, highWater,
        { float, refWidth: width })
    }, { history: "replace" })
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
  return {
    ...board, updateRecords, upgradeGrid, setFloat, setProportional,
    stampRefWidth,
  }
}
