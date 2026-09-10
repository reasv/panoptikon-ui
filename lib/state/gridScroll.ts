import { createSerializer, parseAsInteger, useQueryState } from "nuqs"

// Scroll anchor for the virtualized result grid: the index of the first item
// in the topmost visible row. An item index (rather than a pixel offset)
// survives viewport resizes and column-count changes — the same item is put
// back at the top whatever the layout. The param only exists once at least one
// full row is scrolled out of view; short result sets and unscrolled views
// keep a clean URL and today's behaviour.
//
// "First item of the row" is what a scroll WRITES; what a layout change
// RESTORES is the row containing the anchor, and it leaves the anchor as it
// found it rather than re-quantizing it to that row's first item under the
// new column count — otherwise every column change walked the position up by
// a partial row (see the scroll-stop write in app/search/ResultGrid.tsx).
//
// history "replace": the anchor rides along on whatever history entry is
// current — the way browsers natively treat scroll position. Back/forward
// restore it together with the state that entry represents, and scroll stops
// never become history entries of their own.
export const GRID_SCROLL_ANCHOR_KEY = "top"

const gridScrollAnchorParser = parseAsInteger.withOptions({
  history: "replace",
})

export const useGridScrollAnchor = () =>
  useQueryState(GRID_SCROLL_ANCHOR_KEY, gridScrollAnchorParser)

// The same param as a URL serializer, for links BUILT rather than navigated
// to — find-in-folder's prefetched href (components/gallery/FindButton.tsx),
// which has to carry the scroll-mode landing position the same way the
// in-place navigation writes it. Shares the parser above so the two can
// never disagree about the wire format.
export const gridScrollAnchorSerializer = createSerializer({
  top: gridScrollAnchorParser,
})
