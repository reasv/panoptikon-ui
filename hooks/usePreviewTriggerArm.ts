"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { armHoverPlay } from "@/lib/state/animatedPlayback"
import { CELL_HOVER_ROOT_ATTR } from "@/hooks/useArmedHover"
import {
  COUNTDOWN_IDLE,
  countdownArm,
  countdownClick,
  countdownLeave,
  countdownNeedsFrame,
  countdownProgress,
  countdownStep,
  type CountdownPhase,
  type CountdownState,
} from "@/lib/previewCountdown"

/**
 * "THE PLAY BADGE IS THE TRIGGER" (docs/video-hover-preview-implementation.md
 * T3–T5), as the two values a card needs: which phase its countdown is in, and
 * how full the ring should be drawn right now.
 *
 * MOUNTED BY THE CARD, NOT BY THE PICTURE, because the badge and the picture
 * are siblings on both surfaces — the grid card draws the badge inside its
 * anchor and over its picture, the filmstrip beside its link — and the arm has
 * to reach both: the badge for the ring, the picture for the start and the
 * frame swap. It is the same shape `useArmedHover` has for the card-wide arm,
 * one level up.
 *
 * IT REUSES THE ARM, IT DOES NOT REIMPLEMENT IT. `armHoverPlay` is the
 * director's own rule — a real `pointermove` within 150 ms, then a 200 ms
 * dwell, refused while a fast scroll is in flight, at most one armed root on
 * the page (D6/D7) — and the badge is simply a smaller root to point at. A
 * synthetic `pointerenter` with no movement behind it therefore starts no
 * countdown, which is the property the whole feature's "costs nothing while
 * scrolling" claim rests on and which a hand-rolled timer here would have had
 * to earn again.
 *
 * WHAT IT COSTS A CELL THAT NOBODY POINTS AT: two listeners on the badge and
 * one on the card root, no timer, no animation frame and no subscription
 * (T10). Frames are scheduled only while the ring is moving.
 */
export interface PreviewTriggerArm {
  /**
   * Attach to the badge's own element — the ring the user aims at, not the
   * box it is centred in. A callback ref with a fixed identity, so it can be
   * handed to a component that re-renders without re-running the listeners.
   */
  attach: (element: Element | null) => void
  /** The badge's click path: start now, countdown skipped (T3). */
  click: () => void
  /** Where the countdown is; the card reads `"started"` and `"counting"`. */
  phase: CountdownPhase
  /** How full to draw the ring, or null when there is no ring (0..1). */
  progress: number | null
}

/**
 * @param enabled the `"button"` trigger is in force AND this cell can actually
 * preview something. False is the whole of the `"card"` trigger's cost for
 * this hook: no listeners, no state, nothing scheduled.
 */
export function usePreviewTriggerArm(enabled: boolean): PreviewTriggerArm {
  const anchor = useRef<Element | null>(null)
  const attach = useCallback((element: Element | null) => {
    anchor.current = element
  }, [])
  const [phase, setPhase] = useState<CountdownPhase>("idle")
  const [progress, setProgress] = useState<number | null>(null)
  /**
   * THE RUNNER, built once per mount. A closure rather than a pile of refs
   * because the loop is genuinely stateful — a state, a frame handle, and one
   * function that publishes both — and because the alternative (a `useCallback`
   * that has to call itself through a ref) is the kind of knot that goes wrong
   * the next time somebody touches it.
   *
   * Everything it closes over is stable: the two `useState` setters keep their
   * identity for the life of the mount, so the listeners bound below never go
   * stale and the effect never has to re-run to refresh them.
   */
  const [runner] = useState(() => createCountdownRunner(setPhase, setProgress))
  useEffect(() => () => runner.dispose(), [runner])
  useEffect(() => {
    if (!enabled) {
      // The trigger moved, or the cell stopped being able to preview, under a
      // resting pointer. A countdown left standing would fire into a card that
      // no longer expects it.
      runner.reset()
      return
    }
    const badge = anchor.current
    if (!badge) return
    let cancel: (() => void) | undefined
    const onFire = (armed: boolean) => {
      if (armed) runner.arm()
      // FALSE IS THE DIRECTOR TAKING THE ARM BACK — another cell claimed the
      // single slot, or a fast scroll suspended it. Before the start that
      // drains the ring; after it, `countdownLeave` deliberately does nothing
      // (T5), so a preview already committed to the card is not cancelled by
      // the badge losing an arm it no longer needs.
      else runner.leave()
    }
    const enter = (event: Event) => {
      // The ENTRY'S OWN COORDINATES are handed over for the reason
      // hooks/useArmedHover.ts spells out: the browser dispatches
      // `pointerenter` before the `pointermove` that carried the pointer
      // across the boundary, so they are the only record of the movement that
      // produced this entry. Deliberately not cancelling first — a repeated
      // entry under a stationary pointer is the director's own no-op.
      cancel = armHoverPlay(badge, onFire, event as PointerEvent)
    }
    const leave = () => {
      cancel?.()
      cancel = undefined
      runner.leave()
    }
    // THE CARD'S LEAVE IS THE CANCEL (T5): from the start onward the preview
    // belongs to the card exactly as it does under the `"card"` trigger, and
    // leaving the card is what stops it. Bound to the hover root the picture
    // and the CSS both use, so all three agree on what "the card" is.
    const root = badge.closest(`[${CELL_HOVER_ROOT_ATTR}]`)
    const cardLeave = () => {
      cancel?.()
      cancel = undefined
      runner.reset()
    }
    badge.addEventListener("pointerenter", enter)
    badge.addEventListener("pointerleave", leave)
    root?.addEventListener("pointerleave", cardLeave)
    return () => {
      cancel?.()
      runner.reset()
      badge.removeEventListener("pointerenter", enter)
      badge.removeEventListener("pointerleave", leave)
      root?.removeEventListener("pointerleave", cardLeave)
    }
  }, [enabled, runner])
  const click = useCallback(() => runner.click(), [runner])
  return { attach, click, phase, progress }
}

/**
 * The frame loop, and the only thing in this file that touches a clock.
 *
 * It publishes TWO values because they change at different rates: the phase
 * moves twice per gesture and drives the card's structure (the frame swap, the
 * preview mounting), while the fraction moves every frame and drives one
 * attribute on one `<circle>`. `countdownStep` returns the same state object
 * when nothing has elapsed, so the phase setter bails on all but two frames of
 * a fill.
 */
function createCountdownRunner(
  setPhase: (phase: CountdownPhase) => void,
  setProgress: (progress: number | null) => void
) {
  let state: CountdownState = COUNTDOWN_IDLE
  let frame: number | null = null
  const now = () =>
    typeof performance === "undefined" ? Date.now() : performance.now()
  const stop = () => {
    if (frame === null) return
    cancelAnimationFrame(frame)
    frame = null
  }
  const step = (at: number) => {
    frame = null
    publish(countdownStep(state, at), at)
  }
  const publish = (next: CountdownState, at: number) => {
    state = next
    setPhase(next.phase)
    setProgress(countdownProgress(next, at))
    if (countdownNeedsFrame(next)) {
      if (frame === null) frame = requestAnimationFrame(step)
    } else {
      stop()
    }
  }
  return {
    arm: () => {
      const at = now()
      publish(countdownArm(state, at), at)
    },
    leave: () => {
      const at = now()
      publish(countdownLeave(state, at), at)
    },
    click: () => publish(countdownClick(state), now()),
    reset: () => publish(COUNTDOWN_IDLE, now()),
    dispose: stop,
  }
}
