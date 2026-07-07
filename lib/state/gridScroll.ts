import { parseAsInteger, useQueryState } from "nuqs"

// Scroll anchor for the virtualized result grid: the index of the first item
// in the topmost visible row. An item index (rather than a pixel offset)
// survives viewport resizes and column-count changes — the same item is put
// back at the top whatever the layout. The param only exists once at least one
// full row is scrolled out of view; short result sets and unscrolled views
// keep a clean URL and today's behaviour.
//
// history "replace": the anchor rides along on whatever history entry is
// current — the way browsers natively treat scroll position. Back/forward
// restore it together with the state that entry represents, and scroll stops
// never become history entries of their own.
export const GRID_SCROLL_ANCHOR_KEY = "top"

export const useGridScrollAnchor = () =>
  useQueryState(
    GRID_SCROLL_ANCHOR_KEY,
    parseAsInteger.withOptions({
      history: "replace",
    })
  )
