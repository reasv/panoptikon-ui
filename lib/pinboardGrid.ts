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

const TOKEN_RE = /^v(\d+)(?:\.(\d+)\.(\d+)\.(\d+)\.(\d+))?$/

export function parseVersionToken(token: string | undefined): GridParams | null {
  if (!token) return null
  const m = TOKEN_RE.exec(token)
  if (!m || parseInt(m[1]) < 2) return null
  if (!m[2]) return V2_GRID
  return {
    columns: parseInt(m[2]),
    rowHeight: parseInt(m[3]),
    margin: parseInt(m[4]),
    padding: parseInt(m[5]),
  }
}

export function formatVersionToken(grid: GridParams): string {
  if (
    grid.columns === V2_GRID.columns &&
    grid.rowHeight === V2_GRID.rowHeight &&
    grid.margin === V2_GRID.margin &&
    grid.padding === V2_GRID.padding
  ) {
    return "v2"
  }
  return `v2.${grid.columns}.${grid.rowHeight}.${grid.margin}.${grid.padding}`
}

export interface ParsedBoard {
  grid: GridParams
  // The 5-string records, with the version token stripped. All layout keys
  // (`${offset}-${sha256}`) use offsets into THIS array, so they are stable
  // across the v1 -> v2 migration.
  records: string[]
  isV1: boolean
}

export function parseBoard(param: string[]): ParsedBoard {
  const grid = parseVersionToken(param[0])
  if (grid) return { grid, records: param.slice(1), isV1: false }
  return { grid: V1_GRID, records: param, isV1: true }
}

// An empty board serializes to [] so nuqs clears the param entirely and the
// next board starts fresh (on the v2 grid)
export function serializeBoard(grid: GridParams, records: string[]): string[] {
  if (records.length === 0) return []
  return [formatVersionToken(grid), ...records]
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
// factors; crop and trim suffixes are normalized values independent of the
// grid, so they pass through unchanged.
export function migrateRecords(records: string[], to: GridParams): string[] {
  const { sx, sy } = v1ScaleFactors(to)
  const next: string[] = []
  for (let i = 0; i < records.length; i += 5) {
    const [sha256, x, y, w, hField] = records.slice(i, i + 5)
    if (hField === undefined) break
    const { h, crop, trim } = parseHField(hField)
    next.push(
      sha256,
      Math.round(parseInt(x) * sx).toString(),
      Math.round(parseInt(y) * sy).toString(),
      Math.max(1, Math.round(parseInt(w) * sx)).toString(),
      packHField(Math.max(1, Math.round(h * sy)), crop, trim)
    )
  }
  return next
}
