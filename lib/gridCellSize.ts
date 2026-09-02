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
// IMPORT-FREE apart from lib/searchLimits.ts, which is itself nothing but
// constants: scripts/gridcells.test.mjs runs these under plain node, and a
// module with no imports and no runtime behaviour strips just as cleanly.

import {
  MAX_CELL_WIDTH,
  MAX_PAGE_SIZE,
  MIN_CELL_WIDTH,
  MIN_PAGE_SIZE,
} from "./searchLimits"

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

/**
 * THE AUTO LAYOUT'S PICTURE-BOX HEIGHTS, in CSS pixels, one per breakpoint
 * band. Named here because they were three magic numbers in two places that
 * had to agree and could not check each other: a Tailwind class list on the
 * card's anchor (`h-96 4xl:h-120 5xl:h-152`, in
 * components/SearchResultImage.tsx) and the `rowEstimate` ladder in
 * app/search/ResultGrid.tsx, which is these plus `CELL_CHROME_PX`.
 *
 * Tailwind needs the class LITERAL, so the class list cannot be generated from
 * these — the anchor carries a pointer back here instead, and the equalities
 * `h-96 = 96 * 4 = 384`, `h-120 = 480`, `h-152 = 608` are what tie the two
 * together. Everything that reasons about the box in JavaScript reads these.
 *
 * They matter beyond the row height because the auto layout's box is NOT
 * SQUARE: it is `cellWidth × <one of these>`. See `cellBoxBindingEdge`.
 */
export const AUTO_IMAGE_BOX_HEIGHT_PX = 384
export const AUTO_IMAGE_BOX_HEIGHT_4XL_PX = 480
export const AUTO_IMAGE_BOX_HEIGHT_5XL_PX = 608

/**
 * THE EDGE THAT BINDS a cell's rendition choice: the LARGER of the picture
 * box's two edges.
 *
 * The box paints `object-cover`, which scales the rendition until it covers
 * BOTH edges, so crispness is bound by whichever edge asks more of the image —
 * the filmstrip's `STRIP_CARD_CSS_BINDING_EDGE` spells the same reasoning out
 * for its own `w-[240px] h-80` card. The result grid's EXPLICIT mode has a
 * square box, so its two edges agree and the width is the binding edge; its
 * AUTO mode does not, and passing the width alone is a real defect there — a
 * 266px-wide auto cell is 384px tall, and asking for `grid-xs` (256) for it
 * upscales the short side by 1.5x, past the ladder's 1.125 slack.
 *
 * A non-positive or non-finite WIDTH is passed straight through, because that
 * is the grid's "not measured yet" value and `tierForCellWidth` answers
 * `display` for it — the conservative direction, which a `max()` against a
 * known box height would silently destroy. An unusable HEIGHT falls back to
 * the width, which is the answer this call site gave before it existed.
 */
export function cellBoxBindingEdge(
  cellWidth: number,
  boxHeightPx: number | undefined
): number {
  if (!Number.isFinite(cellWidth) || cellWidth <= 0) return cellWidth
  if (boxHeightPx === undefined) return cellWidth
  if (!Number.isFinite(boxHeightPx) || boxHeightPx <= 0) return cellWidth
  return Math.max(cellWidth, boxHeightPx)
}

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

/**
 * The row height a picture box of this height implies: the box plus the card
 * chrome, which is constant across every mode and breakpoint (see
 * `CELL_CHROME_PX`). The auto layout's `rowEstimate` ladder IS this function
 * over `AUTO_IMAGE_BOX_HEIGHT_*`, so the two can no longer drift.
 */
export function rowHeightForImageBox(boxHeightPx: number): number {
  return boxHeightPx + CELL_CHROME_PX
}

/** The fixed row height an explicit cell width implies (design §6). */
export function rowHeightForCellWidth(cellWidth: number): number {
  return rowHeightForImageBox(imageBoxHeightForCellWidth(cellWidth))
}

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
 * ROUNDED TO A WHOLE NUMBER OF ROWS at the column count the new cell size lays
 * out, and that rounding is load-bearing rather than cosmetic. The pagination
 * bar highlights the virtual page of the top row's LAST item while the URL
 * anchor records its FIRST (design §4, `topRowHighlightItem`), and the two
 * name the same page only while no row straddles a k-boundary — i.e. while
 * `k % columns === 0`. The shipped default (k = 10 over 5 columns) is such a
 * multiple, which is why the mismatch has never been visible; an arbitrary
 * co-written k is not, and would leave the bar disagreeing with the URL it had
 * just written on most rows. Snapping k to the nearest whole row keeps the
 * `(prev / next)²` intent to within half a row and restores the invariant.
 *
 * THE ALIGNMENT HOLDS AT COMMIT TIME ONLY, and that residual is accepted
 * deliberately. `columns` is a property of the window, not of the page size:
 * a later resize, a sidebar toggle or a breakpoint crossing changes it while
 * `page_size` stays where this put it, and k stops being a multiple again. The
 * symptom is the one this rounding removes at the moment of the commit — the
 * pagination bar and the URL anchor disagreeing by one page on rows that
 * straddle a k-boundary — and it returns until the next slider commit
 * re-derives k.
 *
 * The alternative is worse and was rejected: re-writing `page_size` on every
 * resize would mean a window drag silently renumbering the user's pagination,
 * changing what a shared link means, and re-keying the search request mid-drag.
 * A page size is a value the user set; a resize is not permission to change it.
 *
 * Returns null when there is nothing to write: an unchanged result, an
 * unusable input, or a `page_size` below 1 — which means "no LIMIT" rather
 * than a small page, and scaling it would silently impose one.
 */
export function coWrittenPageSize(
  pageSize: number,
  prevCellWidth: number,
  nextCellWidth: number,
  /**
   * The column count the NEW cell size lays out — the one the written page
   * size has to divide by. 0 (nothing measured) falls back to the unrounded
   * clamp, which is a coarser answer rather than a wrong one.
   */
  columns: number = 0
): number | null {
  if (!Number.isFinite(pageSize) || pageSize < MIN_PAGE_SIZE) return null
  if (!(prevCellWidth > 0) || !(nextCellWidth > 0)) return null
  const ratio = prevCellWidth / nextCellWidth
  const scaled = pageSize * ratio * ratio
  const usable =
    Number.isFinite(columns) && columns >= 1 && columns <= MAX_PAGE_SIZE
  let next: number
  if (usable) {
    const perRow = Math.floor(columns)
    // The ROW count is what gets clamped, not the item count: clamping the
    // items would hand back a ceiling that is not a multiple of anything, and
    // the whole point is that the result divides evenly by the columns. At
    // least one row, and never more rows than the page-size ceiling holds.
    const maxRows = Math.max(1, Math.floor(MAX_PAGE_SIZE / perRow))
    const rows = Math.min(Math.max(1, Math.round(scaled / perRow)), maxRows)
    next = rows * perRow
  } else {
    next = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.round(scaled)))
  }
  return next === pageSize ? null : next
}
