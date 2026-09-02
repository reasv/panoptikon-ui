// Versioned grid parameters for the pinboard.
//
// The `pinboard` URL param is a flat array of 5-string records
// [sha256, x, y, w, hField]. A v2 board prepends a version token as the
// array's first element: "v2" for the default v2 grid, or
// "v2.<columns>.<rowHeight>.<margin>.<padding>" when the board uses custom
// grid parameters. A token can never collide with a record's sha256 prefix
// (10 hex chars) or the "__preview" sentinel. No token means v1: the
// original 36-column / 50px-row / 10px-margin grid, which existing boards
// must keep rendering pixel-identically, indefinitely.
//
// v1 boards migrate lazily: they render with v1 parameters until the first
// real mutation (drag, resize, crop, pin, layout action...), which rewrites
// the whole board on the v2 grid. The scale factors are exact on the
// lattice — columns triple, and the vertical step (rowHeight + margin) goes
// 60px -> 10px so h scales x6 — but the margin change means a migrated
// board renders ~5px tighter: each 10px gap becomes 5px and the adjacent
// items absorb the difference. Pixel-exact migration is impossible once the
// margin changes, and the margin must shrink for the finer grid to fit the
// app's 630px minimum width: react-grid-layout spends one margin per
// lattice column, so 10px margins cap the grid at 61 columns there.

import { packHField, parseHField } from "./pinboardCrop"

export interface GridParams {
  columns: number
  rowHeight: number
  margin: number
  padding: number
}

export const V1_GRID: GridParams = {
  columns: 36,
  rowHeight: 50,
  margin: 10,
  padding: 10,
}

export const V2_GRID: GridParams = {
  columns: 108,
  rowHeight: 5,
  margin: 5,
  padding: 5,
}

// Height in px of one vertical lattice step: advancing y by 1 moves down by
// rowHeight + margin (an item's own pixel height is h*step - margin)
export function rowStep(grid: GridParams): number {
  return grid.rowHeight + grid.margin
}

// Minimum useful pin size. Below ~60px even the floor-scaled overlay
// controls (see .pinboard-pin in globals.css) stop fitting, so a smaller
// pin is effectively non-interactable. Enforced at mutation time only —
// resize gestures and layout actions — never against records being loaded:
// clamping on load would rewrite a board just by viewing it.
export const MIN_PIN_PX = 60

// The minimum in grid units at the current column width. Width depends on
// the measured container (columns are container-relative); height only on
// the grid's fixed vertical step. An item spanning n cells measures
// n*(cell+margin) - margin px, hence the +margin in the rounding.
export function minPinUnits(
  grid: GridParams,
  columnWidth: number
): { minW: number; minH: number } {
  return {
    minW: Math.min(grid.columns, Math.max(1,
      Math.ceil((MIN_PIN_PX + grid.margin) / (columnWidth + grid.margin)))),
    minH: Math.max(1, Math.ceil((MIN_PIN_PX + grid.margin) / rowStep(grid))),
  }
}

// The proportional grid ("Scale With Window", the pbp board flag): with a
// reference width stored in the token, the board's cell ASPECT is frozen at
// the shape it had at that width and the whole vertical axis scales with the
// container instead of letterboxing. Freezing the aspect while keeping
// multi-cell items letterbox-free requires margin and padding to scale too
// (an item's height is h*rowHeight + (h-1)*margin), so it is one uniform
// zoom factor, not a rowHeight tweak. Columns never scale: they are
// container-relative already.
//
// Scale 1 (feature off, no reference width, unmeasured container) returns
// the base grid OBJECT — identity, so every memo keyed on the grid is
// unchanged for boards that never touch the feature.
export function gridScale(
  proportional: boolean,
  refWidth: number,
  boardWidth: number
): number {
  return proportional && refWidth > 0 && boardWidth > 0
    ? boardWidth / refWidth
    : 1
}

// The grid every RENDER consumer must use. Floats are fine: RGL computes
// item pixel rects from these values and rounds per item, absolutely (never
// cumulatively), so fractional steps can't drift.
export function effectiveGrid(grid: GridParams, scale: number): GridParams {
  if (scale === 1) return grid
  return {
    columns: grid.columns,
    rowHeight: grid.rowHeight * scale,
    margin: grid.margin * scale,
    padding: grid.padding * scale,
  }
}

// The same values baked back to the integers a token can carry — what
// turning the feature OFF stores, so the board keeps the size it had on
// screen. Exact at scale 1 (identity), approximate everywhere else, and
// the approximation is worth stating honestly: each value rounds by under
// half a pixel, but what item positions accumulate is the ROW STEP
// (rowHeight + margin), whose error is therefore up to a full pixel per
// row — and every item's top offset is its row index times that step, so
// the whole board stretches or shrinks by up to one pixel per row step it
// spans. In relative terms the error is bounded by 1/(step*scale), which
// is invisible near scale 1 and large when the scale is small: a v2 board
// (step 10px) authored at 3440px and switched off in a ~1030px window has
// an exact step of 2.99px, which bakes to 1 + 1 = 2px — the board comes
// out a third shorter. Small scales cannot do better; integers are all the
// token can carry.
export function bakeGrid(grid: GridParams, scale: number): GridParams {
  if (scale === 1) return grid
  return {
    columns: grid.columns,
    rowHeight: Math.max(1, Math.round(grid.rowHeight * scale)),
    margin: Math.max(0, Math.round(grid.margin * scale)),
    padding: Math.max(0, Math.round(grid.padding * scale)),
  }
}

// The optional "!<rows>" suffix is the board's layout-height ratchet: the
// largest grid-row count any fill action has ever targeted. Fill actions
// target max(current fold, ratchet), so adding items while the board is
// shown in a smaller view never recompacts a layout made for a bigger one;
// an explicit "refit to current view" resets it.
//
// The optional "~<ext>" suffix carries the board's remaining version-scoped
// switches as one compact lowercase string in a fixed order:
//
//   f        free-float: gravity/compaction OFF (absent = ON, the original
//            behavior)
//   u        uniform auto-layout: the fill verbs and auto-layout tile
//            identical cells instead of composing a mosaic (absent =
//            mosaic, the original behavior)
//   w<int>   reference width in px for the proportional grid (absent = none)
//
// e.g. "v2~f", "v2!40~w1503", "v2.108.5.5.5!40~fuw1503". The segment is
// append-only and parsed leniently: an unknown letter must never make the
// whole token unparseable, since falling back to the v1 branch would
// reinterpret the token as a record and wreck the board. Hence the ext
// capture accepts any run of characters that cannot be confused with the
// earlier sections (anything but "!" and "~"), and unrecognized content
// simply reads as switches at their defaults.
export interface GridExt {
  // Gravity off: items stay exactly where they were put
  float: boolean
  // Uniform auto-layout: the fill verbs tile identical cells (absent =
  // mosaic)
  uniform: boolean
  // Board width the layout's cell aspects were authored at (0 = unset)
  refWidth: number
}

// Frozen: this is the shared module default handed out by parseExt and
// spread into ParsedBoard, so a stray mutation on any value that aliased it
// would poison every later parse.
export const NO_EXT: GridExt = Object.freeze({
  float: false,
  uniform: false,
  refWidth: 0,
})

const TOKEN_RE =
  /^v(\d+)(?:\.(\d+)\.(\d+)\.(\d+)\.(\d+))?(?:!(\d+))?(?:~([^!~]*))?$/

function parseExt(ext: string | undefined): GridExt {
  if (!ext) return NO_EXT
  const w = /w(\d+)/.exec(ext)
  return {
    float: ext.startsWith("f"),
    // "u" can't be confused with the other switches: "f" is positional and
    // "w" carries only digits — and clients from before the switch existed
    // simply read past it (the ext charset was tolerant from the start)
    uniform: ext.includes("u"),
    refWidth: w ? parseInt(w[1]) : 0,
  }
}

// Emits nothing at all when every switch is at its default, so boards
// that never touch them keep their exact historical token.
function formatExt(ext?: Partial<GridExt>): string {
  if (!ext) return ""
  const refWidth =
    ext.refWidth && ext.refWidth > 0 ? Math.round(ext.refWidth) : 0
  const body = `${ext.float ? "f" : ""}${ext.uniform ? "u" : ""}${
    refWidth > 0 ? `w${refWidth}` : ""}`
  return body ? `~${body}` : ""
}

export function parseVersionToken(
  token: string | undefined
): ({ grid: GridParams; highWater: number } & GridExt) | null {
  if (!token) return null
  const m = TOKEN_RE.exec(token)
  if (!m || parseInt(m[1]) < 2) return null
  const highWater = m[6] ? parseInt(m[6]) : 0
  const ext = parseExt(m[7])
  if (!m[2]) return { grid: V2_GRID, highWater, ...ext }
  return {
    grid: {
      columns: parseInt(m[2]),
      rowHeight: parseInt(m[3]),
      margin: parseInt(m[4]),
      padding: parseInt(m[5]),
    },
    highWater,
    ...ext,
  }
}

export function formatVersionToken(
  grid: GridParams,
  highWater = 0,
  ext?: Partial<GridExt>
): string {
  const suffix = `${highWater > 0 ? `!${highWater}` : ""}${formatExt(ext)}`
  if (
    grid.columns === V2_GRID.columns &&
    grid.rowHeight === V2_GRID.rowHeight &&
    grid.margin === V2_GRID.margin &&
    grid.padding === V2_GRID.padding
  ) {
    return `v2${suffix}`
  }
  return `v2.${grid.columns}.${grid.rowHeight}.${grid.margin}.${grid.padding}${suffix}`
}

// ParsedBoard carries the ext switches too, so every write path can hand
// them straight back to serializeBoard: whatever a board's token says must
// survive every verb, drag, save and migration untouched.
export interface ParsedBoard extends GridExt {
  grid: GridParams
  // The 5-string records, with the version token stripped. All layout keys
  // (`${offset}-${sha256}`) use offsets into THIS array, so they are stable
  // across the v1 -> v2 migration.
  records: string[]
  isV1: boolean
  // Layout-height ratchet in grid rows (0 = never filled / v1 board)
  highWater: number
}

export function parseBoard(param: string[]): ParsedBoard {
  const parsed = parseVersionToken(param[0])
  if (parsed) {
    return {
      grid: parsed.grid,
      records: param.slice(1),
      isV1: false,
      highWater: parsed.highWater,
      float: parsed.float,
      uniform: parsed.uniform,
      refWidth: parsed.refWidth,
    }
  }
  return { grid: V1_GRID, records: param, isV1: true, highWater: 0, ...NO_EXT }
}

// An empty board serializes to [] so nuqs clears the param entirely and the
// next board starts fresh (on the v2 grid)
export function serializeBoard(
  grid: GridParams,
  records: string[],
  highWater = 0,
  ext?: Partial<GridExt>
): string[] {
  if (records.length === 0) return []
  return [formatVersionToken(grid, highWater, ext), ...records]
}

// Integer factors mapping v1 lattice coordinates onto another grid: x and w
// scale by the column ratio, y and h by the vertical step ratio. For the
// default v2 grid these are exactly 3 and 6.
export function v1ScaleFactors(to: GridParams): { sx: number; sy: number } {
  return {
    sx: to.columns / V1_GRID.columns,
    sy: rowStep(V1_GRID) / rowStep(to),
  }
}

// Rewrite v1 records on the target grid. Geometry scales by the lattice
// factors; every h-field extra (crops, trim, lock, orientation) is either a
// normalized value or a flag, all independent of the grid, so they pass
// through unchanged.
export function migrateRecords(records: string[], to: GridParams): string[] {
  const { sx, sy } = v1ScaleFactors(to)
  const next: string[] = []
  for (let i = 0; i < records.length; i += 5) {
    const [sha256, x, y, w, hField] = records.slice(i, i + 5)
    if (hField === undefined) break
    const { h, ...extras } = parseHField(hField)
    next.push(
      sha256,
      Math.round(parseInt(x) * sx).toString(),
      Math.round(parseInt(y) * sy).toString(),
      Math.max(1, Math.round(parseInt(w) * sx)).toString(),
      packHField(Math.max(1, Math.round(h * sy)), extras)
    )
  }
  return next
}
