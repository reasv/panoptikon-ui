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
