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

import { parseHField } from "./pinboardCrop"
import { GridParams } from "./pinboardGrid"

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
// bottom then left to right. The scan window reaches one item-height past
// the deepest occupied row, so a free slot always exists.
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
  const maxY = Math.max(...rects.map((r) => r.y + r.h))
  let best: { x: number; y: number; d: number } | null = null
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= maxX; x++) {
      const d = (x - aim.x) ** 2 + (y - aim.y) ** 2
      if (best && d >= best.d) continue
      const slot = { x, y, w: pinW, h: pinH }
      if (rects.some((r) => overlaps(slot, r))) continue
      best = { x, y, d }
    }
  }
  return best ? { x: best.x, y: best.y } : { x: aim.x, y: maxY }
}
