// One-shot marker distinguishing pinboard layout writes that are
// NAVIGATION (loading a saved board, swapping to a version in the history
// browser) from writes that are edits. The auto-layout pin-count trigger
// observes record changes and can't tell "the user added a pin" apart from
// "a version with a different item count was just loaded" — without this
// mark it would relayout a freshly loaded version, instantly rewriting it
// back into the viewport mosaic (and un-selecting it in the history panel).
//
// Module state rather than React state because the writer (history panel /
// library) and the reader (the board's trigger effect) live in distant
// subtrees, and the mark must survive exactly one URL round-trip.

let navigated = false

// Call immediately before a setSavedLayout() that restores a stored layout.
export function markPinboardNavigation() {
  navigated = true
}

// Consumed by the auto-layout trigger: true means the records change it is
// reacting to came from navigation and must not fire a relayout.
export function consumePinboardNavigation(): boolean {
  const wasNavigation = navigated
  navigated = false
  return wasNavigation
}

// The inverse mark: a pin was added/removed by a button that lives OUTSIDE
// the board (the search grid, or gallery thumbnails while the image tab is
// focused). The board's count trigger is unmounted at that moment, and on
// the next mount it only records a baseline — so without this mark those
// edits would never be auto-laid out.

let pendingEdit = false

// Call when a pin edit is written somewhere the board may not be mounted.
export function markPinboardPendingEdit() {
  pendingEdit = true
}

// Consumed by the auto-layout trigger on every records observation: true on
// the trigger's first run means the board mounted onto an un-laid-out edit.
export function consumePinboardPendingEdit(): boolean {
  const wasPending = pendingEdit
  pendingEdit = false
  return wasPending
}

// A pin add whose position the user chose explicitly (a drag-and-drop, a
// sticky-carry drop, a hole drop). The whole point of a positioned add is
// the position, so the auto-layout trigger must not immediately relayout
// it away — this mark tells it to sit that one add out.

let explicitPlacement = false

// Call immediately before a record write that adds a pin at a
// user-chosen position.
export function markPinboardExplicitPlacement() {
  explicitPlacement = true
}

// Consumed by the auto-layout trigger on every records observation: true
// means the add it is reacting to was explicitly placed — skip the fill.
export function consumePinboardExplicitPlacement(): boolean {
  const was = explicitPlacement
  explicitPlacement = false
  return was
}

// Maximize pressed from a tab strip whose pinboard tab is NOT showing (the
// tab chip's own maximize button, the one control that works from an
// inactive tab because it activates the tab itself).
//
// Every other way to maximize is reached from a MOUNTED board, so the
// board's viewport-growth effect sees `fs` go false -> true and re-fills to
// the bigger fold. This path cannot: the tab activation and the `fs` write
// land in one tick, so the board MOUNTS already maximized and that effect's
// baseline — initialized from the current flags precisely so that a tab
// switch back while maximized counts as navigation rather than a layout
// request — reads "was already fullscreen". No growth, no fill, and the
// ratchet expands under a layout built for the small fold.
//
// Hence a mark rather than a fix inside that effect: "mounted maximized" is
// genuinely ambiguous, and only the button knows this particular mount was
// asked for.

let maximizeRequest = false

// Call immediately before the paired tab-activation + `fs` writes.
export function markPinboardMaximizeRequest() {
  maximizeRequest = true
}

// Consumed by the auto-layout trigger on every records observation: true on
// the trigger's FIRST run means this mount is a maximize the user asked for
// and the board owes it a fill.
export function consumePinboardMaximizeRequest(): boolean {
  const was = maximizeRequest
  maximizeRequest = false
  return was
}
