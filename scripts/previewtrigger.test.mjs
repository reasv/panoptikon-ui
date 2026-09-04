// Assertions for the video-preview TRIGGER setting: the browser preference and
// its two sentences (lib/state/hoverPreviewTrigger.ts), the play badge's
// countdown state machine (lib/previewCountdown.ts), and the frame-swap rule
// that turns on both (T7). The contract is
// docs/video-hover-preview-implementation.md §1b, decisions T1-T10. Run it from
// the ui root:
//
//   node --experimental-strip-types scripts/previewtrigger.test.mjs
//
// The countdown is asserted as a PURE MACHINE fed explicit timestamps, which is
// the whole reason it is a module of its own: a fill, an abort, a click and a
// leave-after-start are four gestures, and driving them through a real clock
// and a real requestAnimationFrame would test the browser rather than the rule.
//
// The preference box IS exercised at runtime, against a fake `window` installed
// before the module is imported — the module reaches for localStorage only from
// inside its box functions, so the fake is enough for the whole of it,
// cross-tab `storage` events included. Exits non-zero on failure.

import { createChecker } from "./harness.mjs"
import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

// ---------------------------------------------------------------------------
// The fake browser, installed BEFORE the import: `bind()` reads storage on the
// first subscribe, and a module imported without a window would latch
// `typeof window === "undefined"` and never bind at all.
// ---------------------------------------------------------------------------

const store = new Map()
const storageListeners = []
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
  addEventListener: (type, listener) => {
    if (type === "storage") storageListeners.push(listener)
  },
}
/** Another tab wrote this key: what the `storage` event delivers here. */
const otherTabWrote = (key, value) => {
  if (value === null) store.delete(key)
  else store.set(key, value)
  for (const listener of storageListeners) listener({ key })
}

const {
  DEFAULT_HOVER_PREVIEW_TRIGGER,
  HOVER_PREVIEW_TRIGGER_LABELS,
  HOVER_PREVIEW_TRIGGER_STORAGE_KEY,
  getHoverPreviewTrigger,
  getServerHoverPreviewTrigger,
  hoverPreviewLead,
  hoverPreviewTriggerHint,
  parseHoverPreviewTrigger,
  setHoverPreviewTrigger,
  subscribeHoverPreviewTrigger,
} = await import("../lib/state/hoverPreviewTrigger.ts")
const {
  COUNTDOWN_IDLE,
  PREVIEW_COUNTDOWN_DRAIN_MS,
  PREVIEW_COUNTDOWN_MS,
  countdownArm,
  countdownClick,
  countdownLeave,
  countdownNeedsFrame,
  countdownProgress,
  countdownReset,
  countdownStarted,
  countdownStep,
  previewFrameShown,
} = await import("../lib/previewCountdown.ts")

const { check, finish } = createChecker()
const near = (a, b, epsilon = 1e-9) => Math.abs(a - b) <= epsilon

// ---------------------------------------------------------------------------
// T1 — the preference
// ---------------------------------------------------------------------------

{
  check("the storage key is the settled one",
    HOVER_PREVIEW_TRIGGER_STORAGE_KEY === "panoptikon.hoverPreviewTrigger",
    HOVER_PREVIEW_TRIGGER_STORAGE_KEY)
  // THE AMENDMENT'S WHOLE POINT: absent means the BUTTON, not the card. A
  // default that read "card" would ship the behaviour the QA round rejected to
  // every user who has never opened the popover.
  check("nothing stored reads as the play button",
    DEFAULT_HOVER_PREVIEW_TRIGGER === "button"
      && parseHoverPreviewTrigger(null) === "button"
      && parseHoverPreviewTrigger(undefined) === "button"
      && parseHoverPreviewTrigger("") === "button")
  check("both values round-trip",
    parseHoverPreviewTrigger("card") === "card"
      && parseHoverPreviewTrigger("button") === "button")
  // A hand-edited value, or one from a version that grew a third position:
  // there are two answers and either renders a correct grid, so anything else
  // is the default rather than an error.
  check("an unusable stored value reads as the default",
    ["Card", "badge", "{}", "null", "0"].every(
      (raw) => parseHoverPreviewTrigger(raw) === "button"))
  // NEVER THE URL, NEVER CLIENT-CONFIG: nothing in this module names a search
  // parameter or a wire field, and this pins that it stays that way.
  check("the SSR snapshot is the same value the box starts on",
    getServerHoverPreviewTrigger() === DEFAULT_HOVER_PREVIEW_TRIGGER)
}

// ---------------------------------------------------------------------------
// T1 — the runtime box, against the fake window
// ---------------------------------------------------------------------------

{
  let notified = 0
  const unsubscribe = subscribeHoverPreviewTrigger(() => { notified += 1 })
  check("an unbound box reads the default",
    getHoverPreviewTrigger() === "button")
  setHoverPreviewTrigger("card")
  check("a write publishes locally and persists",
    getHoverPreviewTrigger() === "card"
      && store.get(HOVER_PREVIEW_TRIGGER_STORAGE_KEY) === "card"
      && notified === 1,
    `notified ${notified}`)
  // The tab that wrote is the one tab `storage` never reaches, which is why
  // the write publishes locally as well — a box that only listened would leave
  // its own grid on the old trigger until a reload.
  const before = notified
  setHoverPreviewTrigger("card")
  check("writing the value it already holds notifies nobody",
    notified === before)
  otherTabWrote(HOVER_PREVIEW_TRIGGER_STORAGE_KEY, "button")
  check("another tab's write lands here",
    getHoverPreviewTrigger() === "button" && notified === before + 1)
  // `key` null is a whole-store clear, which IS a change to ours.
  otherTabWrote(HOVER_PREVIEW_TRIGGER_STORAGE_KEY, "card")
  store.clear()
  for (const listener of storageListeners) listener({ key: null })
  check("a whole-store clear falls back to the default",
    getHoverPreviewTrigger() === "button")
  const stable = getHoverPreviewTrigger()
  otherTabWrote("panoptikon.somethingElse", "x")
  check("another key's write is somebody else's",
    getHoverPreviewTrigger() === stable)
  unsubscribe()
}

// ---------------------------------------------------------------------------
// T8 — the two sentences
// ---------------------------------------------------------------------------

{
  // The sentence ABOVE "Video previews" follows the trigger: the row under it
  // is about cost, but the first thing it says is which gesture starts one.
  check("the lead sentence names the card gesture under \"card\"",
    hoverPreviewLead("card") ===
      "Play a video by resting the pointer on its card.")
  check("the lead sentence names the badge and the click under \"button\"",
    hoverPreviewLead("button") ===
      "Play a video by resting on its play button, or clicking it.")
  check("the two lead sentences differ",
    hoverPreviewLead("card") !== hoverPreviewLead("button"))
  // The line UNDER the control describes the lit segment only — the rule every
  // setting in this popover follows.
  check("the hint describes the current choice and only it",
    hoverPreviewTriggerHint("card").includes("anywhere on a video card")
      && !hoverPreviewTriggerHint("card").includes("play button")
      && hoverPreviewTriggerHint("button").includes("play button")
      && hoverPreviewTriggerHint("button").includes("clicking"))
  check("the segments are Card then Play button",
    HOVER_PREVIEW_TRIGGER_LABELS.map(([value]) => value).join(",") === "card,button"
      && HOVER_PREVIEW_TRIGGER_LABELS.map(([, label]) => label).join(",")
        === "Card,Play button")
}

// ---------------------------------------------------------------------------
// T3/T4/T5 — the countdown machine
// ---------------------------------------------------------------------------

{
  check("an idle badge draws no ring and schedules no frame",
    countdownProgress(COUNTDOWN_IDLE, 1000) === null
      && !countdownNeedsFrame(COUNTDOWN_IDLE)
      && !countdownStarted(COUNTDOWN_IDLE))
  // THE FILL (T3): arm, and the ring is a function of the clock alone.
  const armed = countdownArm(COUNTDOWN_IDLE, 1000)
  check("the arm starts an empty, animating fill",
    armed.phase === "counting"
      && countdownProgress(armed, 1000) === 0
      && countdownNeedsFrame(armed))
  check("the fill is linear in the elapsed time",
    near(countdownProgress(armed, 1000 + PREVIEW_COUNTDOWN_MS / 2), 0.5)
      && near(countdownProgress(armed, 1000 + PREVIEW_COUNTDOWN_MS / 4), 0.25))
  check("a frame before the end changes nothing (the same object)",
    countdownStep(armed, 1000 + PREVIEW_COUNTDOWN_MS - 1) === armed)
  const started = countdownStep(armed, 1000 + PREVIEW_COUNTDOWN_MS)
  check("the fill completing IS the start",
    countdownStarted(started)
      && !countdownNeedsFrame(started)
      // The ring goes back to the JOB's from here (V11) — a countdown that
      // kept painting a full circle underneath would fight it.
      && countdownProgress(started, 9999) === null)
  check("the countdown is about three quarters of a second",
    PREVIEW_COUNTDOWN_MS === 700 && PREVIEW_COUNTDOWN_DRAIN_MS === 150)

  // THE ABORT (T4): leaving before the end drains from where it got to, and
  // nothing was ever requested — there is no job to cancel because there was
  // never one to create.
  const leftAt = 1000 + PREVIEW_COUNTDOWN_MS * 0.6
  const draining = countdownLeave(armed, leftAt)
  check("leaving mid-fill drains from the fraction it had reached",
    draining.phase === "draining"
      && near(draining.from, 0.6)
      && near(countdownProgress(draining, leftAt), 0.6)
      && countdownNeedsFrame(draining))
  check("the drain runs back to empty",
    near(countdownProgress(draining, leftAt + PREVIEW_COUNTDOWN_DRAIN_MS / 2), 0.3)
      && near(countdownProgress(draining, leftAt + PREVIEW_COUNTDOWN_DRAIN_MS), 0))
  const drained = countdownStep(draining, leftAt + PREVIEW_COUNTDOWN_DRAIN_MS)
  check("a drained ring is an idle badge again",
    drained.phase === "idle"
      && !countdownNeedsFrame(drained)
      && countdownProgress(drained, 9999) === null)
  check("the drain is faster than the fill",
    PREVIEW_COUNTDOWN_DRAIN_MS < PREVIEW_COUNTDOWN_MS)
  // Re-arming a draining badge starts a fresh fill rather than resuming: the
  // pointer left and came back, which is a new gesture.
  check("re-arming a draining badge starts from empty",
    countdownProgress(countdownArm(draining, leftAt + 50), leftAt + 50) === 0)

  // THE CLICK (T3): no dwell to wait out, no ring to fill.
  check("a click starts at once",
    countdownStarted(countdownClick(COUNTDOWN_IDLE))
      && countdownStarted(countdownClick(armed))
      && countdownStarted(countdownClick(draining)))

  // AFTER THE START (T5): the badge has done its job and the preview belongs
  // to the CARD. Neither leaving the badge nor the director taking the arm
  // back may undo it — cancelling because the pointer drifted a few pixels
  // after a deliberate aim would be the interface changing its mind.
  check("leaving the badge after the start changes nothing",
    countdownLeave(started, 5000) === started
      && countdownStarted(countdownLeave(started, 5000)))
  check("a re-arm after the start is ignored",
    countdownArm(started, 5000) === started)
  check("a click after the start is ignored",
    countdownClick(started) === started)
  check("a started badge needs no frames",
    !countdownNeedsFrame(started))
  // Leaving the CARD is the one thing that does undo it (the hook's own
  // reset), and it lands on the same idle state a fresh cell holds.
  check("the card's leave resets to idle",
    countdownReset() === COUNTDOWN_IDLE)

  // A clock that goes backwards, and one that jumps: neither may paint a ring
  // outside the circle.
  check("the fraction is clamped at both ends",
    countdownProgress(armed, 500) === 0
      && countdownProgress(armed, 1e12) === 1
      && countdownProgress(draining, leftAt - 100) <= draining.from
      && countdownProgress(draining, 1e12) === 0)
}

// ---------------------------------------------------------------------------
// T7 — the frame swap, per (trigger, cell size, phase)
// ---------------------------------------------------------------------------

{
  const shown = (trigger, swaps, cardHovered, phase) =>
    previewFrameShown({ trigger, swaps, cardHovered, phase })
  const PHASES = ["idle", "counting", "draining", "started"]

  // A SMALL CELL NEVER SWAPS, in either mode and in every phase (V12, which
  // T7 leaves standing): the plan hands it the same URL for both layers, so
  // `swaps` is false and there is nothing to show.
  check("a small cell never shows a second frame",
    PHASES.every((phase) =>
      !shown("card", false, true, phase) && !shown("button", false, true, phase)))

  // UNDER "card" the swap is plain `:hover`, arriving with the card's own
  // cover→contain zoom-out so the hover is ONE change.
  check("under \"card\" a large cell swaps on hover and only on hover",
    shown("card", true, true, "idle")
      && !shown("card", true, false, "idle"))

  // UNDER "button" the card hover is left alone — the 2x2 zooms out like any
  // image card, with the badge still on it — and the swap is the badge arm's
  // first feedback.
  check("under \"button\" card hover alone does not swap",
    !shown("button", true, true, "idle"))
  check("under \"button\" the swap lands when the countdown starts",
    shown("button", true, true, "counting"))
  check("under \"button\" the swap holds through the preview",
    shown("button", true, true, "started"))
  check("an aborted countdown takes the swap back",
    !shown("button", true, true, "draining"))
  // The card's hover flag is not consulted at all in this mode: the phase is
  // the whole answer, and a pointer resting on the badge of a card the
  // stylesheet has not registered as hovered cannot exist.
  check("under \"button\" the swap does not depend on the hover flag",
    PHASES.every((phase) =>
      shown("button", true, true, phase) === shown("button", true, false, phase)))
}

finish()
