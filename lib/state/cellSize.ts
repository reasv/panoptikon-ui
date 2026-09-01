import { parseAsInteger, useQueryState } from "nuqs"

// The result grid's explicit cell width, in CSS pixels
// (docs/search-scroll-mode-design.md §9). ABSENT means "auto" — the
// breakpoint-driven column counts the grid has always used — and that is the
// frozen wire meaning of a missing parameter, exactly like `vm`'s "pages":
// every search URL ever shared with no `cs` renders at the recipient's
// breakpoints, forever. A different product default is a CREATION default
// (lib/searchDefaults.ts), stamped as an explicit parameter, never a change
// here.
//
// Auto and explicit are a HARD SWITCH: there is no blended mode, so the
// parameter is either absent or a target width, and clearing it is a write of
// null rather than a write of "the current width".
//
// history "replace", like `top`: a slider drag is not navigation, and one
// history entry per commit would turn Back into a slider replay (design §9).
// The drag itself writes NOTHING — the control commits on release
// (Radix's onValueCommit), so a sweep across the track is one URL write and
// one re-layout, not one per pixel.
export const GRID_CELL_SIZE_KEY = "cs"

const gridCellSizeParser = parseAsInteger.withOptions({
  history: "replace",
})

export const useGridCellSize = () =>
  useQueryState(GRID_CELL_SIZE_KEY, gridCellSizeParser)
