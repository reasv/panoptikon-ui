// Where a newly pinned item lands on the board.
//
// Both insert paths used to hardcode (0, 0) and let vertical compaction
// shove the whole board down. That is annoying with gravity on and outright
// broken with gravity off, where the new pin would simply land on top of
// existing content and nothing would ever separate them.
//
// placeNewPin does a first-fit row-major scan starting at the TOP of the
// bottom-most existing pin, so sequential pins continue the bottom row
// left-to-right before wrapping onto fresh rows below ("continue the bottom
// row", not a tower). It only ever picks free space, so no existing pin is
// moved: an already-compacted layout is a fixed point of the compactor, so
// with gravity on the only item compaction can still move is the new one.

// Type-only imports are spelled out: node's --experimental-strip-types (how
// scripts/gridcells.test.mjs exercises togglePinRecords below) cannot erase a
// type hiding in a value import list.
import { PIN_SHA_PREFIX_LENGTH, parseHField } from "./pinboardCrop"
import { v1ScaleFactors, type GridParams } from "./pinboardGrid"
import { newPinHField, type GalleryTrimSlot } from "./galleryTrim"

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// A board taller than this below the bottom-most pin means something is
// badly wrong with the records; bail to the bottom of the content rather
// than scanning forever.
const MAX_SCAN_ROWS = 10000

// Occupied rects from the flat 5-string records [sha256, x, y, w, hField].
// The real h lives in hField alongside the crop/trim/lock extras.
function occupiedRects(records: string[]): Rect[] {
  const rects: Rect[] = []
  for (let i = 0; i + 4 < records.length; i += 5) {
    if (records[i] === "__preview") continue
    const x = parseInt(records[i + 1])
    const y = parseInt(records[i + 2])
    const w = parseInt(records[i + 3])
    const { h } = parseHField(records[i + 4])
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    if (!Number.isFinite(w) || !Number.isFinite(h)) continue
    rects.push({ x, y, w: Math.max(1, w), h: Math.max(1, h) })
  }
  return rects
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  )
}

// Records and grid are exactly what an updateRecords updater receives.
// w/h are the new pin's size in the board's own grid units.
export function placeNewPin(
  records: string[],
  grid: GridParams,
  w: number,
  h: number
): { x: number; y: number } {
  const rects = occupiedRects(records)
  if (rects.length === 0) return { x: 0, y: 0 }
  const pinW = Math.max(1, Math.round(w))
  const pinH = Math.max(1, Math.round(h))
  const y0 = Math.max(...rects.map((r) => r.y))
  const maxX = Math.max(0, grid.columns - pinW)
  for (let y = y0; y <= y0 + MAX_SCAN_ROWS; y++) {
    for (let x = 0; x <= maxX; x++) {
      const slot = { x, y, w: pinW, h: pinH }
      if (!rects.some((r) => overlaps(slot, r))) return { x, y }
    }
  }
  return { x: 0, y: Math.max(...rects.map((r) => r.y + r.h)) }
}

// Where a duplicate lands. With gravity on, the copy is appended at the
// original's own position and compaction nudges it off; with gravity off
// nothing separates them, so the copy has to be placed explicitly at the
// free cell NEAREST the original — the same brute-force nearest-slot scan
// the size-locked travellers of the pack verbs use, ties breaking top to
// bottom then left to right. The scan runs from row 0 down to the deepest
// occupied BOTTOM edge — a row no existing pin can reach into, so it is
// always free and the scan always has an answer.
export function placeNearest(
  records: string[],
  grid: GridParams,
  w: number,
  h: number,
  aim: { x: number; y: number }
): { x: number; y: number } {
  const rects = occupiedRects(records)
  if (rects.length === 0) return { x: 0, y: 0 }
  const pinW = Math.max(1, Math.round(w))
  const pinH = Math.max(1, Math.round(h))
  const maxX = Math.max(0, grid.columns - pinW)
  const maxY = Math.max(0, ...rects.map((r) => r.y + r.h))
  // Seeded with the last row of the scan, which no rect can overlap (every
  // rect ends at or above it): the worst-case slot is a real free slot, so
  // the scan can only improve on it and there is no null case to handle.
  let best = { x: 0, y: maxY, d: Infinity }
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= maxX; x++) {
      const d = (x - aim.x) ** 2 + (y - aim.y) ** 2
      if (d >= best.d) continue
      const slot = { x, y, w: pinW, h: pinH }
      if (rects.some((r) => overlaps(slot, r))) continue
      best = { x, y, d }
    }
  }
  return { x: best.x, y: best.y }
}

/**
 * The default size of a new pin, in v1 grid units, before it is scaled onto
 * the board's own lattice.
 */
const NEW_PIN_V1_SIZE = 10

/**
 * Pin or unpin `sha256`, as a function from one record array to the next.
 *
 * THE WHOLE OF THE RECORD ALGEBRA behind the pin button, in the shape
 * `updateRecords` wants: `(prev, grid) => next`. It was inline in
 * CellActionsHost, which owns URL subscriptions rather than the record format,
 * and where the splice arithmetic — a flat array of FIVE-string records, so
 * every offset is an index times five — sat unreachable by any test.
 *
 * Three cases, in the order they are decided:
 *
 *   - `layoutKey` given: the button lives on a SPECIFIC pinboard copy, so
 *     unpin removes exactly that record by its own offset. Duplicates of one
 *     image are ordinary, and matching by sha256 prefix here would remove the
 *     wrong copy. The key's leading field is the record offset (see the board's
 *     layout keys); `grid` is not consulted at all.
 *   - the item is already pinned somewhere: remove its FIRST copy, found by
 *     prefix.
 *   - otherwise: append a new record at the first free slot (placeNewPin),
 *     sized 10×10 v1 units scaled onto this board's lattice, with the gallery's
 *     trim baked into the h field when the slot belongs to this item.
 *
 * Near-pure, and the only reason it is not literally pure is `placeNewPin`'s
 * scan — which is itself a function of `prev` and `grid`.
 */
export function togglePinRecords(
  prev: string[],
  grid: GridParams,
  sha256: string,
  options: { layoutKey?: string; galleryTrim: GalleryTrimSlot | null }
): string[] {
  const { layoutKey, galleryTrim } = options
  if (layoutKey !== undefined) {
    const offset = parseInt(layoutKey.split("-")[0])
    const next = [...prev]
    next.splice(offset, 5)
    return next
  }
  const pins: [string, number][] = prev
    .filter((_, i) => i % 5 === 0)
    .map((id, index) => [id, index])
  const isPinnedIndex = pins.findIndex(([id]) =>
    id.slice(0, PIN_SHA_PREFIX_LENGTH) === sha256.slice(0, PIN_SHA_PREFIX_LENGTH))
  if (isPinnedIndex !== -1) {
    // `pins` is one entry per record, so its index IS the record's index —
    // times five to reach the flat array's offset.
    const index = pins[isPinnedIndex][1]
    const next = [...prev]
    next.splice(index * 5, 5)
    return next
  }
  // Default new-pin size is 10x10 in v1 units, scaled to the board's grid; the
  // pin lands in the first free slot found scanning starting at the bottom row
  // (placeNewPin above), never on top of anything.
  const { sx, sy } = v1ScaleFactors(grid)
  const w = Math.round(NEW_PIN_V1_SIZE * sx)
  const h = Math.round(NEW_PIN_V1_SIZE * sy)
  const { x, y } = placeNewPin(prev, grid, w, h)
  return [
    ...prev,
    sha256.slice(0, PIN_SHA_PREFIX_LENGTH),
    x.toString(),
    y.toString(),
    w.toString(),
    newPinHField(h, sha256, galleryTrim),
  ]
}
