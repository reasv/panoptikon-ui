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
