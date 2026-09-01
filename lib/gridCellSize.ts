// The arithmetic behind the result grid's cell-size slider
// (docs/search-scroll-mode-design.md §9).
//
// Cell size is ONE variable whose default value is "auto" — the breakpoint
// behaviour, parameter absent from the URL — and whose explicit values are
// fixed target cell WIDTHS in CSS pixels, from which the column count and the
// row height both follow. There is no blended mode: moving the slider off
// "auto" replaces the auto policy with an explicit one, because
// breakpoint-relative scaling and clamping explicit sizes into breakpoint
// bands is where incoherence lives.
//
// IMPORT-FREE, like lib/scrollMode.ts: scripts/gridcells.test.mjs runs these
// under plain node.

/** The slider's ends, in CSS pixels of cell WIDTH. */
export const MIN_CELL_WIDTH = 140
export const MAX_CELL_WIDTH = 1200
/** The slider's granularity. Finer than this is thumb noise, not a choice. */
export const CELL_WIDTH_STEP = 10

// `gap-4` between cells and, in explicit mode, spelled out as an inline style
// so this number and the laid-out gap cannot drift. (Tailwind's gap-4 is
// 1rem, which a raised root font size would move — harmless for the CSS
// classes the auto mode uses, but the column count derived below has to
// measure the gap that is actually there.)
export const GRID_GAP_PX = 16

/**
 * The card chrome around the picture box: border, padding, the path line, the
 * metadata line and the row's own bottom padding. Constant across every
 * breakpoint by construction — the shipped `rowEstimate` constants are
 * 470/566/694 against picture boxes of 384/480/608, i.e. exactly 86 in all
 * three — which is what lets an explicit cell width produce a row height as
 * deterministically as a breakpoint does (design §6).
 */
export const CELL_CHROME_PX = 86

export function clampCellWidth(value: number): number {
  if (!Number.isFinite(value)) return MIN_CELL_WIDTH
  return Math.min(MAX_CELL_WIDTH, Math.max(MIN_CELL_WIDTH, Math.round(value)))
}

/**
 * Columns for a target cell width: as many as fit, never fewer than one.
 *
 * `floor((container + gap) / (target + gap))` rather than
 * `floor(container / target)` because N columns carry only N−1 gaps — the
 * naive form loses a column whenever the gaps add up to one.
 */
export function columnsForCellWidth(
  containerWidth: number,
  cellWidth: number,
  gap: number = GRID_GAP_PX
): number {
  if (!(containerWidth > 0) || !(cellWidth > 0)) return 0
  return Math.max(1, Math.floor((containerWidth + gap) / (cellWidth + gap)))
}

/** The width a cell actually gets once the columns are laid out. */
export function cellWidthForColumns(
  containerWidth: number,
  columns: number,
  gap: number = GRID_GAP_PX
): number {
  if (!(containerWidth > 0) || !(columns > 0)) return 0
  return (containerWidth - gap * (columns - 1)) / columns
}

/**
 * The picture box's height for a given cell width: SQUARE.
 *
 * The auto mode's own boxes are near-square at every breakpoint the constants
 * were tuned at (384px tall in a ~370px cell at 1080p, 608 in a ~590 cell at
 * 3000px), so a square box is the shape the grid already has rather than a new
 * one, and it makes the slider's number mean the whole cell instead of one of
 * its two dimensions.
 */
export function imageBoxHeightForCellWidth(cellWidth: number): number {
  return Math.round(cellWidth)
}

/** The fixed row height an explicit cell width implies (design §6). */
export function rowHeightForCellWidth(cellWidth: number): number {
  return imageBoxHeightForCellWidth(cellWidth) + CELL_CHROME_PX
}

// The page-size bounds the sidebar's own control enforces, restated rather
// than imported for the same reason lib/searchDefaults.ts restates them: this
// module is deliberately import-free, and these are the bounds of what may be
// WRITTEN to the URL.
const MIN_PAGE_SIZE = 1
const MAX_PAGE_SIZE = 10000

/**
 * The page size that preserves the screen-to-items ratio across a cell-size
 * change — the slider's default co-write (design §9), which the lock toggle
 * turns off.
 *
 * Items per screenful is `columns × rows`, and BOTH scale inversely with the
 * cell width (the width sets the columns, and the row height derives from the
 * width), so the ratio is preserved by scaling the page size with the SQUARE
 * of the width ratio. In scroll mode that is free relabelling and keeps "a
 * virtual page is one screenful" true through the change; in pages mode it
 * rides useCommitPageSize, which remaps the position onto the new size.
 *
 * Returns null when there is nothing to write: an unchanged result, an
 * unusable input, or a `page_size` below 1 — which means "no LIMIT" rather
 * than a small page, and scaling it would silently impose one.
 */
export function coWrittenPageSize(
  pageSize: number,
  prevCellWidth: number,
  nextCellWidth: number
): number | null {
  if (!Number.isFinite(pageSize) || pageSize < MIN_PAGE_SIZE) return null
  if (!(prevCellWidth > 0) || !(nextCellWidth > 0)) return null
  const ratio = prevCellWidth / nextCellWidth
  const scaled = Math.round(pageSize * ratio * ratio)
  const next = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, scaled))
  return next === pageSize ? null : next
}
