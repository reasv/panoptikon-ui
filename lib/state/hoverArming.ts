// THE HOVER-TO-ANIMATE ARMING MACHINE (docs/grid-hover-animate-implementation.md
// D6/D7): the whole of the policy that decides WHEN a cell may start playing,
// with no timer, no element and no globals in it.
//
// Its own module, apart from the director that runs it
// (lib/state/animatedPlayback.ts), because the two are different kinds of
// thing: this is arithmetic over timestamps and coordinates, and the director
// is one listener lifetime, one dwell timer and one callback map. The RUNTIME
// deliberately did NOT come with it — `fastScroll` is half the arming rule and
// is sampled by the same scroll listener the playback cap uses, so splitting
// that would mean two listeners answering one question.
//
// IMPORT-FREE, which is what lets scripts/hoveranimate.test.mjs drive whole
// gestures through these functions under plain node.
//
// IT ANSWERS IN COMMANDS, never by mutating an out-parameter the caller then
// reads back. A step returns `null` when there is nothing to do — which is
// the common case, since `hoverMove` runs on every real pointer move on the
// page — so the standing cost of this feature on a grid nobody hovers is a
// coordinate compare and a timestamp write, with no allocation behind them.

/**
 * How recently the pointer must have actually MOVED for a `pointerenter` to
 * count as the user arriving at a cell (D6).
 *
 * THE WHOLE DEFENCE, and it is against the browser rather than against the
 * user: Chromium re-dispatches boundary events when content scrolls under a
 * STATIONARY cursor, so a wheel scroll through a grid delivers a
 * `pointerenter` for every cell that passes beneath the pointer. Arming on
 * those is how a scroll turns into a trail of started-and-abandoned decodes.
 * A real arrival is always preceded by a real move; a scroll under a still
 * cursor never is.
 *
 * Since the entry event's own coordinates count as that move, an event that
 * CHANGES the position always arms (its age is zero), and this window only
 * ever refuses events at the last recorded position — which is exactly the
 * re-dispatch. The coordinate compare is the rule; the window is how stale a
 * genuine same-spot re-entry (a quick out-and-back) may be and still count.
 */
export const HOVER_MOVE_WINDOW_MS = 150

/**
 * How long the pointer has to REST on a cell before it plays (D6). Long
 * enough that sweeping the grid to reach the scrollbar or a corner button
 * starts nothing, short enough that it reads as a response to looking rather
 * than as a delay.
 */
export const HOVER_DWELL_MS = 200

/**
 * What the arming rule needs to know at the moment of a `pointerenter`.
 * Element-free for the same reason PlaybackState is: the rule is a comparison
 * of two timestamps and a boolean, and scripts/hoveranimate.test.mjs pins it
 * without a DOM.
 */
export interface HoverArmInputs {
  /** `performance.now()` at the entry. */
  now: number
  /** When the pointer last actually moved; 0 = it never has. */
  lastRealMoveAt: number
  /** Is the page scrolling fast enough that the director has suspended? */
  fastScroll: boolean
}

/**
 * MAY THIS ENTRY ARM A HOVER? (D6)
 *
 * Two conditions, and both are about telling a person arriving at a cell from
 * a cell arriving at a stationary pointer:
 *
 *   - a REAL pointer move within the last `HOVER_MOVE_WINDOW_MS`. See that
 *     constant: content scrolling under a still cursor delivers genuine
 *     `pointerenter` events, and nothing about the event itself distinguishes
 *     them from the user reaching for the cell;
 *   - the director is not suspended. A fast scroll is the one state where the
 *     answer is already known for every cell on the page, so an entry during
 *     one is not worth a dwell timer that the next scroll sample would cancel.
 *
 * A future timestamp (a clock read taken before the move it is compared
 * against) fails rather than passing on a negative age — it is a state this
 * cannot be in, and treating it as "moved 0 ms ago" would arm on exactly the
 * events the window exists to refuse.
 */
export function canArmHover(input: HoverArmInputs): boolean {
  if (input.fastScroll) return false
  if (!(input.lastRealMoveAt > 0)) return false
  const age = input.now - input.lastRealMoveAt
  return age >= 0 && age <= HOVER_MOVE_WINDOW_MS
}

/**
 * Identity is all the machine wants of a hover root; the app's are Elements.
 */
export type HoverRoot = Element

/**
 * WHAT A STEP DECIDED, handed back as a value.
 *
 * `null` from a step means "nothing happened", which is what the overwhelming
 * majority of pointer moves are.
 */
export interface HoverCommands {
  /** A dwell timer is running and must be cleared. */
  cancelDwell: boolean
  /**
   * A root that had already been TOLD TO PLAY and must now be told to stop. A
   * dwell that never fired has nothing to take back, which is why this is
   * separate from `cancelDwell`.
   */
  stop: HoverRoot | null
  /** A root whose dwell the caller must start. */
  start: HoverRoot | null
}

/**
 * THE MACHINE'S STATE (D6/D7) — the answer to two ways a cell could otherwise
 * never play:
 *
 *   1. `pointerenter` is dispatched BEFORE the `pointermove` that carried the
 *      pointer across the boundary, so a rule fed only by `pointermove` never
 *      sees the movement that produced the entry. A cursor that RESTED longer
 *      than the window before crossing in was therefore refused — and because
 *      moving inside a cell fires no second `pointerenter`, nothing ever asked
 *      again. `hoverEnter` samples the entry's own coordinates.
 *   2. A cell released by a scroll suspend, with the pointer never leaving it,
 *      had the same problem from the other end. Both cases now leave a PENDING
 *      candidate that `hoverMove` arms on the next REAL move inside it.
 *      Nothing re-arms on a scroll settling or on time passing: no play
 *      without a move the user made.
 *
 * A MUTABLE CURSOR, STEPPED IN PLACE, rather than a reducer returning fresh
 * state: `hoverMove` runs on every real `pointermove` on the page, and the
 * standing cost of this feature on a grid nobody hovers is precisely the thing
 * it exists to keep small. The state is an explicit argument with no globals
 * and no DOM in it, which is what lets the tests drive whole gestures through
 * these functions — the director owns exactly one of these, and the tests own
 * their own.
 */
export interface HoverArming {
  /** The last pointer coordinates seen; NaN until the first sample. */
  x: number
  y: number
  /** When the pointer last actually MOVED (0 = it never has). */
  movedAt: number
  /** The root whose dwell is running, or has fired and is playing. */
  armed: HoverRoot | null
  /** Has `armed`'s dwell elapsed? */
  fired: boolean
  /** The root to arm on the next real move INSIDE it (see above). */
  pending: HoverRoot | null
}

/**
 * Reset a machine IN PLACE, and the constructor for a new one.
 *
 * One function for both because the director's instance is a module singleton
 * it cannot replace on teardown — the listeners close over it — so "forget
 * everything" and "start empty" have to be the same six writes or they will
 * drift the next time a field is added.
 */
export function initHoverArming(state: Partial<HoverArming>): HoverArming {
  state.x = NaN
  state.y = NaN
  state.movedAt = 0
  state.armed = null
  state.fired = false
  state.pending = null
  return state as HoverArming
}

export function newHoverArming(): HoverArming {
  return initHoverArming({})
}

/**
 * Fold one pointer position in, and say whether it was the pointer actually
 * MOVING.
 *
 * THE FIRST SAMPLE ONLY SEEDS THE POSITION: with nothing to compare against,
 * "the coordinates changed" is unknowable, and reading it as a move would arm
 * on the very first event a page delivers — which, when content renders or
 * scrolls under an already-resting cursor, is an entry nobody caused.
 */
function samplePointer(
  state: HoverArming,
  x: number,
  y: number,
  at: number
): boolean {
  const seen = !Number.isNaN(state.x)
  const moved = seen && (x !== state.x || y !== state.y)
  state.x = x
  state.y = y
  if (moved) state.movedAt = at
  return moved
}

/** Take the slot back, saying whether its holder had been told to play. */
function dropArmed(state: HoverArming): { cancelDwell: boolean; stop: HoverRoot | null } {
  if (!state.armed) return { cancelDwell: false, stop: null }
  const stop = state.fired ? state.armed : null
  state.armed = null
  state.fired = false
  return { cancelDwell: true, stop }
}

/** Give `root` the slot if D6 allows it right now. */
function tryArm(
  state: HoverArming,
  root: HoverRoot,
  at: number,
  fastScroll: boolean
): HoverCommands | null {
  if (!canArmHover({ now: at, lastRealMoveAt: state.movedAt, fastScroll })) {
    return null
  }
  const dropped = dropArmed(state)
  state.armed = root
  state.fired = false
  state.pending = null
  return { cancelDwell: true, stop: dropped.stop, start: root }
}

/**
 * The pointer entered `root`, at (`x`, `y`).
 *
 * THE ENTERING MOVEMENT COUNTS: the browser dispatches this before the
 * `pointermove` that carried the pointer in, so the entry's own coordinates
 * are the only record of that movement the rule can have. Chromium's
 * re-dispatched enters — the ones D6 exists to refuse — carry the SAME
 * coordinates as the last move, so they are still not moves and the
 * stationary-cursor defence is unchanged.
 */
export function hoverEnter(
  state: HoverArming,
  root: HoverRoot,
  x: number,
  y: number,
  at: number,
  fastScroll: boolean
): HoverCommands | null {
  samplePointer(state, x, y, at)
  if (state.armed === root) {
    // Re-entering the cell that already holds the slot keeps its dwell running
    // rather than restarting it — see HOVER_MOVE_WINDOW_MS for why a cell can
    // be handed repeated entries it never left.
    state.pending = null
    return null
  }
  const dropped = dropArmed(state)
  if (canArmHover({ now: at, lastRealMoveAt: state.movedAt, fastScroll })) {
    state.armed = root
    state.fired = false
    state.pending = null
    return { cancelDwell: true, stop: dropped.stop, start: root }
  }
  state.pending = root
  return dropped.cancelDwell
    ? { cancelDwell: true, stop: dropped.stop, start: null }
    : null
}

/**
 * The pointer moved. `insidePending` is the caller's answer to "did this land
 * inside the candidate" — asked only when there IS one, which is what keeps
 * the standing cost of an un-hovered page to a comparison and a write.
 *
 * The no-movement path returns before allocating anything: an event whose
 * coordinates are identical to the last one is not the pointer moving, and it
 * is by far the most common thing this function is handed.
 */
export function hoverMove(
  state: HoverArming,
  x: number,
  y: number,
  at: number,
  fastScroll: boolean,
  insidePending: boolean
): HoverCommands | null {
  if (!samplePointer(state, x, y, at)) return null
  const root = state.pending
  if (!root || !insidePending) return null
  return tryArm(state, root, at, fastScroll)
}

/** The pointer left `root`, or the cell went away: it forfeits both slots. */
export function hoverLeave(
  state: HoverArming,
  root: HoverRoot
): HoverCommands | null {
  if (state.pending === root) state.pending = null
  if (state.armed !== root) return null
  const dropped = dropArmed(state)
  return { cancelDwell: true, stop: dropped.stop, start: null }
}

/**
 * Something scrolled. ANY scroll cancels a dwell that has not fired (D6) — the
 * content under the pointer is moving, so the cell the entry named is not the
 * cell that will be there in 200 ms — and a SUSPEND (the fast-scroll
 * threshold) also stops one that has already fired.
 *
 * Either way the cell is REMEMBERED: the pointer may never leave it, and
 * without the candidate the cell could not play again without a trip out and
 * back. It still takes a real move to arm it.
 */
export function hoverScroll(
  state: HoverArming,
  suspend: boolean
): HoverCommands | null {
  if (!state.armed) return null
  if (!suspend && state.fired) return null
  state.pending = state.armed
  const dropped = dropArmed(state)
  return { cancelDwell: true, stop: dropped.stop, start: null }
}

/** The dwell elapsed: `root` is playing, so a later drop has to stop it. */
export function hoverFired(state: HoverArming, root: HoverRoot): void {
  if (state.armed !== root) return
  state.fired = true
}
