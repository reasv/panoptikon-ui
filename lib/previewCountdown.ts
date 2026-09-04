// THE PLAY-BADGE COUNTDOWN (docs/video-hover-preview-implementation.md
// T3–T5, T7): what happens between "the pointer has settled on the play badge"
// and "the preview starts", with no timer, no element and no globals in it.
//
// Its own module, apart from the hook that runs it
// (hooks/usePreviewTriggerArm.ts), on exactly the split
// lib/state/hoverArming.ts made from its director: this is arithmetic over two
// timestamps, and the hook is one requestAnimationFrame loop and two
// listeners. What is here is the whole of the POLICY — when the ring fills,
// when it drains, what a click does, and what leaving does before and after
// the start — and it answers in values, so a test can drive whole gestures
// through it under plain node.
//
// IT IS DELIBERATELY NOT THE 200 ms ARM. The badge takes the same
// real-pointermove-then-dwell arm every hover-armed cell takes
// (lib/state/hoverArming.ts D6, unchanged and reused): a synthetic
// `pointerenter` that carries no movement must not start a countdown any more
// than it may start a loop. What this adds is the SECOND stage the amendment
// asks for — a visible, abortable fill that makes the start of a process an
// act rather than an accident.
//
// IMPORT-FREE apart from one type, which is what lets
// scripts/previewtrigger.test.mjs execute it under plain node.

import type { HoverPreviewTrigger } from "./state/hoverPreviewTrigger"

/**
 * How long the badge's ring takes to fill once the badge arm has fired (T3).
 *
 * ~700 ms, and the number is the whole argument for the setting: long enough
 * that it cannot happen by accident on a pointer that is passing through, and
 * short enough that a user who means it is not made to wait for something they
 * have already asked for. Together with the 200 ms dwell in front of it, a
 * deliberate rest on the badge starts a preview in about nine tenths of a
 * second — and a click starts it in none.
 */
export const PREVIEW_COUNTDOWN_MS = 700

/**
 * How long the ring takes to drain back after an abort (T4). Much shorter than
 * the fill: the fill is a commitment being made and wants to be interruptible,
 * while the drain is only the UI saying "nothing happened" and must be out of
 * the way before the pointer has finished leaving.
 */
export const PREVIEW_COUNTDOWN_DRAIN_MS = 150

/**
 * WHERE ONE BADGE'S COUNTDOWN IS.
 *
 *   - `idle` — the badge is a badge. Nothing has been requested, nothing is
 *     subscribed, and this is what every video cell on a screenful holds;
 *   - `counting` — the arm fired and the ring is filling;
 *   - `draining` — the pointer left before the fill completed (T4): the ring
 *     runs back to empty from wherever it had got to, and then the state is
 *     `idle` again. Nothing was ever requested;
 *   - `started` — the preview is committed to the CARD (T5). Leaving the badge
 *     from here changes nothing at all; only leaving the card cancels, which
 *     is the card's own gesture and not this machine's.
 */
export type CountdownPhase = "idle" | "counting" | "draining" | "started"

export type CountdownState =
  | { phase: "idle" }
  | { phase: "started" }
  /** `since` is the timestamp the fill began. */
  | { phase: "counting"; since: number }
  /** `from` is the fraction the ring had reached when the pointer left. */
  | { phase: "draining"; since: number; from: number }

/** The two phases with no timestamp in them are constants, so identity holds. */
export const COUNTDOWN_IDLE: CountdownState = Object.freeze({ phase: "idle" })
export const COUNTDOWN_STARTED: CountdownState = Object.freeze({
  phase: "started",
})

/** 0..1, clamped — the ratio of `elapsed` to `span`, with a 0 span full. */
function ratio(elapsed: number, span: number): number {
  if (!(span > 0)) return 1
  if (!(elapsed > 0)) return 0
  return elapsed >= span ? 1 : elapsed / span
}

/**
 * HOW FULL THE RING IS at `now`, or null when there is no ring to draw.
 *
 * `started` answers NULL rather than 1: from the start onward the badge's ring
 * belongs to the JOB (V11's progress and its caption), and a countdown that
 * kept painting a full circle underneath would fight it. The direct rung has
 * no job at all, and the badge simply goes back to being a badge — which the
 * card then fades on hover exactly as it always did.
 */
export function countdownProgress(
  state: CountdownState,
  now: number
): number | null {
  switch (state.phase) {
    case "counting":
      return ratio(now - state.since, PREVIEW_COUNTDOWN_MS)
    case "draining":
      return (
        state.from *
        (1 - ratio(now - state.since, PREVIEW_COUNTDOWN_DRAIN_MS))
      )
    default:
      return null
  }
}

/**
 * ADVANCE THE MACHINE to `now` — the one thing the frame loop does.
 *
 * Returns the SAME OBJECT when nothing has elapsed yet, which is what makes
 * the caller's `setState` a no-op on the frames in between: a 700 ms fill is
 * forty-odd frames, and only two of them are transitions.
 */
export function countdownStep(
  state: CountdownState,
  now: number
): CountdownState {
  if (state.phase === "counting") {
    return now - state.since >= PREVIEW_COUNTDOWN_MS ? COUNTDOWN_STARTED : state
  }
  if (state.phase === "draining") {
    return now - state.since >= PREVIEW_COUNTDOWN_DRAIN_MS
      ? COUNTDOWN_IDLE
      : state
  }
  return state
}

/**
 * THE BADGE ARM FIRED (200 ms of real rest on the badge): start filling.
 *
 * A re-arm while already `started` is ignored rather than restarting anything
 * — the preview is running, and the director can legitimately re-report an arm
 * for a badge the pointer never left.
 */
export function countdownArm(
  state: CountdownState,
  now: number
): CountdownState {
  if (state.phase === "started") return state
  return { phase: "counting", since: now }
}

/**
 * THE POINTER LEFT THE BADGE (or the director took the arm back).
 *
 * Before the start this ABORTS (T4): the fill stops where it is and runs back,
 * and because nothing is requested until the start there is nothing to cancel
 * — no job, no element, no bytes.
 *
 * After the start it does NOTHING (T5), and that asymmetry is the decision
 * rather than an oversight: the user has just spent most of a second aiming at
 * a small target, or clicked it, and cancelling because the pointer drifted a
 * few pixels afterwards would be the interface changing its mind. What owns
 * the preview from the start onward is the CARD, exactly as under the `"card"`
 * trigger.
 */
export function countdownLeave(
  state: CountdownState,
  now: number
): CountdownState {
  if (state.phase !== "counting") return state
  return { phase: "draining", since: now, from: countdownProgress(state, now) ?? 0 }
}

/**
 * THE BADGE WAS CLICKED (T3): start at once, countdown skipped. A click is a
 * statement of intent that no dwell can improve on, and it is the answer for
 * someone who does not want to wait out a ring on every video they look at.
 */
export function countdownClick(state: CountdownState): CountdownState {
  return state.phase === "started" ? state : COUNTDOWN_STARTED
}

/** The pointer left the CARD, or the cell went away: forget everything. */
export function countdownReset(): CountdownState {
  return COUNTDOWN_IDLE
}

/**
 * DOES THIS STATE NEED ANIMATION FRAMES? Only while something is moving —
 * which is the whole of the idle-cost claim for this feature (T10): a grid of
 * video cells with nobody pointing at one schedules no frames at all.
 */
export function countdownNeedsFrame(state: CountdownState): boolean {
  return state.phase === "counting" || state.phase === "draining"
}

/** Has the preview started? The one bit the picture below the badge reads. */
export function countdownStarted(state: CountdownState): boolean {
  return state.phase === "started"
}

/**
 * IS THE SINGLE-FRAME LAYER SHOWING? (V12 as T7 amends it.)
 *
 * A pure function of the trigger, the cell's size and the phase, because it is
 * exactly the rule that changed and the one a screenshot is least able to
 * settle:
 *
 *   - `swaps` is the LARGE cell (the plan hands a small one the same URL for
 *     both layers, so there is no swap to make and never was — V12);
 *   - under `"card"` the swap follows plain `:hover`, arriving in the same
 *     moment as the card's own cover→contain zoom-out, so the hover is one
 *     change rather than two;
 *   - under `"button"` the card hover is just a card hover — the 2×2 zooms out
 *     like any image card and the badge stays on it — and the swap to the
 *     single frame lands when the BADGE ARM FIRES, which makes it the first
 *     feedback that a preview is coming. An aborted countdown takes it back
 *     (`draining` answers false), and the video fades in over it when it
 *     plays.
 */
export function previewFrameShown(input: {
  trigger: HoverPreviewTrigger
  /** Does this cell have a second picture to swap to (a LARGE cell)? */
  swaps: boolean
  /** Is the pointer on the card? Only the `"card"` trigger asks. */
  cardHovered: boolean
  /** The badge countdown's phase; `idle` under the `"card"` trigger. */
  phase: CountdownPhase
}): boolean {
  if (!input.swaps) return false
  if (input.trigger === "card") return input.cardHovered
  return input.phase === "counting" || input.phase === "started"
}
