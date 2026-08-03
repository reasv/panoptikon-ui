// Pinboard cell geometry: the grid-unit -> pixel mapping the compositors
// draw with, plus the mosaic export's capture-box math.
//
// Split out of pinboardPreview.ts so the two compositors (the saved-board
// preview and the mosaic export) share ONE cell mapping — a preview whose
// rects drifted from a mosaic's would be two different pictures of the same
// board — and so the pure math can be exercised from a plain node script
// (this module imports nothing but its two sibling pure modules; the
// drawing side pulls in React components and canvas).
//
// Two lattices live here:
//
//   PADDED (what the board renders, what previews composite): container
//   padding on all sides, margins as visible gutters between cells. An
//   item's box is w*colWidth + (w-1)*margin wide.
//
//   SEAMLESS (mosaic only): rects on the STEP lattice — every cell absorbs
//   its own margins, so adjacent items share edges exactly and there is no
//   container padding. Same grid, same arrangement, no gaps; each item's
//   fit/crop is then recomputed for the bigger rect by the caller, so
//   nothing is stretched.
//
// Seamless width, by design: a full-width seamless row spans
// `layoutWidth - 2*padding + margin`, not `layoutWidth` — the columns are
// solved on the padded lattice (that is what keeps the two compositors
// showing the SAME board) and the step lattice then reclaims the padding
// but not the gutter RGL never spends past the last column. So a "3840 px
// Wide" seamless mosaic comes out a handful of pixels narrower than 3840.
// Accepted: matching the nominal preset exactly would mean re-solving the
// column width for seamless mode, i.e. a different arrangement from the
// board on screen.

// Type-only imports are spelled out: node's --experimental-strip-types
// (how scripts/mosaic.test.mjs exercises this module) cannot erase a type
// hiding in a value import list.
import type { PinOrientation } from "./pinboardCrop"
import { composeCrops, parseHField } from "./pinboardCrop"
import type { GridParams } from "./pinboardGrid"
import { rowStep } from "./pinboardGrid"

export interface PinPlacement {
  sha256: string
  // Cell rect in board pixels
  left: number
  top: number
  width: number
  height: number
  crop: ReturnType<typeof composeCrops>
  orient: PinOrientation | null
}

/** Width of one grid column at a given board width (padded lattice). */
export function columnWidth(grid: GridParams, boardWidth: number): number {
  return (
    (boardWidth - 2 * grid.padding - (grid.columns - 1) * grid.margin) /
    grid.columns
  )
}

/** Horizontal lattice step: advancing x by 1 moves right by this much. */
export function colStep(grid: GridParams, boardWidth: number): number {
  return columnWidth(grid, boardWidth) + grid.margin
}

// react-grid-layout's cell-to-pixel mapping, as used by GalleryPinBoard.
// `seamless` switches to the step lattice (see the header).
export function cellRect(
  grid: GridParams,
  boardWidth: number,
  x: number,
  y: number,
  w: number,
  h: number,
  seamless = false
): { left: number; top: number; width: number; height: number } {
  const colW = columnWidth(grid, boardWidth)
  const step = colW + grid.margin
  if (seamless) {
    return {
      left: x * step,
      top: y * rowStep(grid),
      width: w * step,
      height: h * rowStep(grid),
    }
  }
  return {
    left: grid.padding + x * step,
    top: grid.padding + y * rowStep(grid),
    width: w * colW + (w - 1) * grid.margin,
    height: h * grid.rowHeight + (h - 1) * grid.margin,
  }
}

export function parsePlacements(
  records: string[],
  grid: GridParams,
  boardWidth: number,
  seamless = false
): PinPlacement[] {
  const placements: PinPlacement[] = []
  for (let i = 0; i + 4 < records.length; i += 5) {
    const [sha256, x, y, w, hField] = records.slice(i, i + 5)
    if (sha256 === "__preview") continue
    const { h, crop, autoCrop, orient } = parseHField(hField)
    placements.push({
      sha256,
      ...cellRect(
        grid,
        boardWidth,
        parseInt(x),
        parseInt(y),
        parseInt(w),
        h,
        seamless
      ),
      crop: composeCrops(crop, autoCrop),
      orient,
    })
  }
  return placements
}

// Grid rows above the fold — the same line the fill verbs target (see
// usePinboardLayoutActions.foldRows). Duplicated rather than imported: this
// module must stay free of React ("use client" hooks) so it can be loaded
// by a plain node script, and the formula is the inverse of cellRect's
// vertical mapping, which lives here.
export function foldRows(grid: GridParams, containerHeight: number): number {
  return Math.max(
    1,
    Math.floor(
      (containerHeight - 2 * grid.padding + grid.margin) / rowStep(grid)
    )
  )
}

/** How much of the board a mosaic captures. */
export type MosaicExtent = "visible" | "full"

export interface MosaicGeometryInput {
  /** The board's records (version token already stripped). */
  records: string[]
  /** The EFFECTIVE grid at layoutWidth. */
  grid: GridParams
  /** Board width the mosaic is laid out at (the target width). */
  layoutWidth: number
  seamless: boolean
  extent: MosaicExtent
  /** Rows the "visible" extent captures: max(fold, ratchet). */
  visibleRows: number
}

export interface MosaicGeometry {
  placements: PinPlacement[]
  /** Canvas origin in board-layout pixels. */
  cropLeft: number
  cropTop: number
  /** Canvas size in pixels (integers). */
  width: number
  height: number
}

/**
 * Why a board has no capture box. Distinguished rather than collapsed into
 * null because "empty-visible" is not a failure at all — it is a board whose
 * content all sits below the fill line, and the only thing wrong with it is
 * the extent the user picked, which the caller can say out loud.
 */
export type MosaicFailure =
  /** No drawable pins on the board. */
  | "no-pins"
  /** Pins exist, but every one of them starts below the visible cut. */
  | "empty-visible"
  /** Degenerate input (non-positive layout width, or a zero-size box). */
  | "degenerate"

export type MosaicGeometryResult =
  | { ok: true; geometry: MosaicGeometry }
  | { ok: false; failure: MosaicFailure }

// Browser canvas limits. Chrome/Firefox/Safari all cap a canvas at 16384px
// per side, and the area cap is lower still (Safari ~268M px, which is also
// roughly where a 4-byte-per-pixel backing store hits 1 GiB). Exceeding
// either yields a blank or zero-sized canvas with no exception, so the
// export scales itself down instead and says so.
export const MAX_CANVAS_SIDE = 16384
export const MAX_CANVAS_AREA = 268_000_000

/**
 * The factor a canvas of this size must shrink by to be drawable — 1 when
 * it already fits. Applied to the target WIDTH (the whole composite scales
 * with it), so the caller recomputes the geometry rather than downscaling
 * a canvas it could not have allocated in the first place.
 */
export function canvasClampFactor(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1
  return Math.min(
    1,
    MAX_CANVAS_SIDE / width,
    MAX_CANVAS_SIDE / height,
    Math.sqrt(MAX_CANVAS_AREA / (width * height))
  )
}

export type ClampedSolveResult =
  | {
      ok: true
      geometry: MosaicGeometry
      /** The width it was actually solved at. */
      layoutWidth: number
      /** Set when the guard had to shrink the request; null when honored. */
      clampedWidth: number | null
    }
  | { ok: false; failure: MosaicFailure | "too-large" }

/**
 * The mosaic solved at the largest drawable width at or below `targetWidth`.
 *
 * The geometry is pure math, so an oversized request is answered by
 * RE-SOLVING at a smaller width — never by allocating a canvas the browser
 * would hand back blank. One pass is exact up to rounding, so the remaining
 * passes are slack; the loop is only ever left by a solve that FIT, and a
 * run that exhausts its passes still oversized reports "too-large" rather
 * than handing back a geometry no canvas can hold.
 */
export function solveWithinCanvasLimits(
  targetWidth: number,
  solveAt: (width: number) => MosaicGeometryResult,
  passes = 4
): ClampedSolveResult {
  let width = Math.max(1, Math.round(targetWidth))
  let clampedWidth: number | null = null
  for (let i = 0; i < passes; i++) {
    const solved = solveAt(width)
    if (!solved.ok) return solved
    const { width: w, height: h } = solved.geometry
    const factor = canvasClampFactor(w, h)
    if (factor >= 1) {
      return { ok: true, geometry: solved.geometry, layoutWidth: width, clampedWidth }
    }
    width = Math.max(1, Math.floor(width * factor * 0.999))
    clampedWidth = width
  }
  return { ok: false, failure: "too-large" }
}

/**
 * Canvas box and cell rects for a mosaic. Pure math: no DOM, no images.
 *
 * The capture box is the content bounding box (padded by grid.padding in
 * padded mode, exact in seamless mode), cut at the bottom by the extent:
 * "full" keeps everything, "visible" cuts at the fill line — the bottom
 * edge of row `visibleRows`, i.e. what the board is meant to show. Items
 * straddling that line are clipped by the canvas edge, exactly as the
 * preview's screenful cap clips today.
 *
 * Returns a tagged failure (see MosaicFailure) instead of a box when there
 * is nothing to draw.
 */
export function mosaicGeometry(
  input: MosaicGeometryInput
): MosaicGeometryResult {
  const { records, grid, layoutWidth, seamless, extent, visibleRows } = input
  if (layoutWidth <= 0) return { ok: false, failure: "degenerate" }
  const placements = parsePlacements(records, grid, layoutWidth, seamless)
  if (placements.length === 0) return { ok: false, failure: "no-pins" }

  // Seamless cells absorb the padding and the margins, so the "gutter" the
  // bounding box keeps is zero there.
  const pad = seamless ? 0 : grid.padding
  const step = rowStep(grid)
  const contentBottom = Math.max(...placements.map((p) => p.top + p.height)) + pad
  // The fill line in the same coordinates: the bottom edge of the last
  // captured row (padded mode adds the container's top and bottom padding,
  // which is exactly what foldRows subtracts back out).
  const foldBottom = seamless
    ? visibleRows * step
    : 2 * grid.padding + visibleRows * step - grid.margin
  const captureBottom =
    extent === "full" ? contentBottom : Math.min(contentBottom, foldBottom)

  const boardRight = seamless
    ? grid.columns * colStep(grid, layoutWidth)
    : layoutWidth
  const cropLeft = Math.max(0, Math.min(...placements.map((p) => p.left)) - pad)
  const cropTop = Math.max(0, Math.min(...placements.map((p) => p.top)) - pad)
  const cropRight = Math.min(
    boardRight,
    Math.max(...placements.map((p) => p.left + p.width)) + pad
  )
  const width = Math.round(cropRight - cropLeft)
  const height = Math.round(captureBottom - cropTop)
  // A board whose content begins BELOW the fill line cuts to nothing: the
  // top of the box is already past its bottom. That is a real board and a
  // wrong extent, not a broken export, so it gets its own answer.
  if (height <= 0 && extent === "visible") {
    return { ok: false, failure: "empty-visible" }
  }
  if (width <= 0 || height <= 0) return { ok: false, failure: "degenerate" }
  return { ok: true, geometry: { placements, cropLeft, cropTop, width, height } }
}
