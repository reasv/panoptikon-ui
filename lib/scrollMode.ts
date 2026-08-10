/**
 * The geometry the two navigation modes share: page-and-index coordinates,
 * the global item index scroll mode positions by, and the chunk lattice the
 * sparse fetcher works on (docs/search-scroll-mode-design.md §4, §5).
 *
 * Deliberately import-free. Every function here is arithmetic over URL
 * coordinates, and keeping React, nuqs and the API client out of the module
 * is what lets scripts/scrollmode.test.mjs execute it under plain node — the
 * hooks that consume it (lib/searchHooks.ts) drag in a module graph that only
 * a bundler can resolve.
 */

/**
 * An in-page index, brought inside a page of `pageSize` rows. A page size
 * below 1 is a single unbounded page, so nothing to clamp against.
 */
export function clampToPage(index: number, pageSize: number): number {
  const floored = Math.max(index, 0)
  return pageSize >= 1 ? Math.min(floored, pageSize - 1) : floored
}

/**
 * Where the item at `anchor` on the current page lands once the page size
 * becomes `nextPageSize`. The global index of a result is
 * `(page - 1) * page_size + index_in_page` and that mapping is page-size
 * independent on this backend (pagination is appended to pagination-free SQL,
 * never compiled into it), so the item is simply re-expressed in the new
 * geometry — see docs/page-size-remap-design.md.
 *
 * A page size below 1 means "no pagination", which is treated as a single
 * unbounded page rather than special-cased: both directions then fall out of
 * the same arithmetic — including the mode switch, which is this function
 * with an unbounded page on one side (see below).
 */
export function remapPageAnchor({
  page,
  pageSize,
  nextPageSize,
  anchor,
}: {
  page: number
  pageSize: number
  nextPageSize: number
  anchor: number
}): { page: number; index: number } {
  const oldSize = pageSize >= 1 ? pageSize : Infinity
  const newSize = nextPageSize >= 1 ? nextPageSize : Infinity
  const oldPage = oldSize === Infinity ? 1 : Math.max(page, 1)
  const index = Math.max(anchor, 0)
  // Guarded rather than written as `(oldPage - 1) * oldSize`: that is
  // `0 * Infinity` — NaN — on the unpaginated page.
  const global = oldPage > 1 ? (oldPage - 1) * oldSize + index : index
  if (newSize === Infinity) return { page: 1, index: global }
  return { page: Math.floor(global / newSize) + 1, index: global % newSize }
}

/**
 * pages → scroll. The global item index that names the position the user is
 * looking at: their gallery item if one is open, else the grid's scroll
 * anchor (absent while the top row is visible, hence the caller's `?? 0`).
 *
 * Scroll mode has no `page`, so the target coordinate is exactly "the same
 * item, expressed on a single unbounded page" — `remapPageAnchor` with no
 * pagination on the far side, which is why this is a wrapper and not a second
 * copy of the arithmetic. The invariant the whole feature rests on
 * (`floor(top / k) === page - 1`) is only true because both directions go
 * through the one function.
 */
export function scrollAnchorFromPage({
  page,
  pageSize,
  anchor,
}: {
  page: number
  pageSize: number
  anchor: number
}): number {
  return remapPageAnchor({ page, pageSize, nextPageSize: 0, anchor }).index
}

/**
 * scroll → pages. The containing page for a global index, plus the index
 * within it. `pageSize < 1` ("no pagination") lands everything on page 1 with
 * the global index intact, mirroring what paginated mode itself does at that
 * size.
 */
export function pageStateFromScrollAnchor({
  anchor,
  pageSize,
}: {
  anchor: number
  pageSize: number
}): { page: number; index: number } {
  return remapPageAnchor({ page: 1, pageSize: 0, nextPageSize: pageSize, anchor })
}

/**
 * The virtual page a global item index falls on — `floor(top / k) + 1`, the
 * invariant the whole feature rests on (design §4) read from the scroll side.
 * It is the same expression `pageStateFromScrollAnchor` computes, kept
 * separate because the two callers want different things from it: that one
 * needs the (page, index) pair a mode switch writes, this one needs only the
 * number the pagination bar highlights, on every scroll frame.
 *
 * `k < 1` is "no pagination" — one unbounded virtual page — so everything is
 * page 1, exactly as paginated mode behaves at that size.
 */
export function virtualPageOf(anchor: number, pageSize: number): number {
  if (pageSize < 1) return 1
  return Math.floor(Math.max(anchor, 0) / pageSize) + 1
}

/**
 * The inverse: the first item of virtual page N, which is what a scrubber
 * click and a virtual page's `<a href>` both write into `top`.
 *
 * Returns 0 for page 1 and for the unpaginated case, and the CALLER turns
 * that 0 into an absent `top` — the anchor codec's convention is "absent
 * while the top row is visible" (lib/state/gridScroll.ts), and there are two
 * writers of this value (the click and the link serializer) that must agree
 * about it.
 */
export function virtualPageAnchor(page: number, pageSize: number): number {
  if (pageSize < 1) return 0
  return Math.max(page - 1, 0) * pageSize
}

/**
 * Which ITEM the live page highlight speaks for, given the top visible ROW.
 *
 * The URL anchor and the highlight answer two different questions and must not
 * be computed the same way. `top` records a POSITION — the first item of the
 * top row, its documented contract (lib/state/gridScroll.ts). The highlight
 * answers "which virtual page am I looking at", and its input is a row, not an
 * item: a scrubber click writes an item anchor of exactly `(N-1)*k`, the grid
 * scrolls the ROW containing it to the top, and that row STARTS at or below
 * the clicked item. Read back as `startRow * columns` the highlight would
 * therefore flip to N-1 whenever `columns` does not divide `(N-1)*k`. Taking
 * the LAST item of the top row instead keeps the whole visible top row on the
 * page it was clicked from — the first row of page N contains an item of page
 * N by construction, and its last item is on page N unless the row straddles
 * a page boundary, in which case the later page is the honest answer anyway.
 *
 * `lastRowVisible` is the bottom of the set: scrolling clamps, so once the
 * final row is on screen no further scroll can move the top row, and the last
 * virtual pages would be permanently unhighlightable. There the highlight
 * speaks for the last ITEM instead — at maximum scroll the bar shows the final
 * page, which is what "I am at the end" has to look like.
 */
export function topRowHighlightItem(
  startRow: number,
  columns: number,
  itemCount: number,
  lastRowVisible: boolean
): number {
  const last = Math.max(itemCount - 1, 0)
  if (lastRowVisible) return last
  const cols = Math.max(columns, 1)
  return Math.min(Math.max(startRow, 0) * cols + cols - 1, last)
}

/**
 * How many items to warm on either side of the visible range: `overscanRows`
 * is the virtualizer's own row overscan, and the doubling is the deliberate
 * margin — the rows the virtualizer renders ahead must already have DATA when
 * they scroll in, so warming exactly the rendered overscan would start the
 * fetch at the moment it is needed rather than before.
 *
 * Item-space rather than chunk-space on purpose: the caller converts a pixel
 * range to items and hands the result to `ensureRange`, which owns the
 * conversion to the chunk lattice (`chunkRangeFor`). Nothing outside this
 * module's arithmetic ever needs to know the chunk size.
 */
export function overscanItemsFor(columns: number, overscanRows: number): number {
  return 2 * Math.max(columns, 1) * Math.max(overscanRows, 0)
}

/** The chunk holding a global item index. */
export function chunkIndexOf(index: number, chunkSize: number): number {
  if (chunkSize < 1) return 0
  return Math.floor(Math.max(index, 0) / chunkSize)
}

/** The offset of a global item index inside its own chunk. */
export function chunkOffsetOf(index: number, chunkSize: number): number {
  if (chunkSize < 1) return Math.max(index, 0)
  return Math.max(index, 0) - chunkIndexOf(index, chunkSize) * chunkSize
}

/**
 * Every chunk index covering the item range `[start, end]`, inclusive on both
 * ends — what a visible range plus overscan converts to before it is warmed.
 *
 * Negative bounds are the ordinary case at the top of the list (the caller
 * subtracts an overscan from the first visible item) and clamp to 0; a range
 * that ends before the first item exists at all warms nothing. No upper clamp
 * — the caller knows the result count, and a chunk request past the end costs
 * one request that answers with an empty page.
 */
export function chunkRangeFor(
  start: number,
  end: number,
  chunkSize: number
): number[] {
  if (end < 0 || end < start) return []
  const from = chunkIndexOf(start, chunkSize)
  const to = chunkIndexOf(end, chunkSize)
  const out: number[] = []
  for (let i = from; i <= to; i++) out.push(i)
  return out
}
