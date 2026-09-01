"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { armHoverPlay } from "@/lib/state/animatedPlayback"

/**
 * The marker a card puts on the element that IS its hover region — the one
 * carrying `group`, so the JS hover region and the CSS one are the same box by
 * construction. Every surface with hover-armed content (the result grid's
 * cards, the gallery filmstrip's) sets it, and the pictures inside find it
 * with `closest` rather than being handed a ref through three components.
 */
export const CELL_HOVER_ROOT_ATTR = "data-cell-hover-root"

/**
 * "The pointer has been RESTING on this card" — the director's arming rule and
 * dwell (docs/grid-hover-animate-implementation.md D6/D7), as one boolean.
 *
 * MOUNTED ONLY BY THE PICTURES THAT NEED IT (a loop in hover mode, a small
 * video cell), which is the same structural rule ExtremeAspectPicture follows:
 * a static card must not gain a listener or a state from this feature
 * existing. Two listeners and one `useState` per hovering-capable cell is the
 * price, and it is paid by those cells alone.
 *
 * `pointerenter`/`pointerleave` rather than `mouseenter`/`mouseleave`: the
 * director's whole arming rule is written in terms of `pointermove`, so the
 * boundary events have to come from the same event family or a stylus would
 * arm on a rule fed by nothing. (The extreme-aspect swap next door uses the
 * mouse pair deliberately — it tracks `:hover`, which is a CSS question.)
 *
 * FALSE IS ALSO THE DIRECTOR'S TO SAY: it hands back `onFire(false)` when
 * another cell takes the single slot, or when a fast scroll suspends playback.
 * That is what makes "at most one hover-playing cell" true without any cell
 * knowing about any other.
 */
export function useArmedHover(enabled: boolean): {
  /**
   * Attach to any element inside the hover root — the root itself is found
   * from it. A callback ref with a fixed identity, so the element it points at
   * may change (an `<img>` becoming a `<video>`, or a fallback swapping back)
   * without re-running the listener effect.
   */
  attach: (element: HTMLElement | null) => void
  /** Has the dwell fired and not yet been taken back? */
  active: boolean
} {
  const anchor = useRef<HTMLElement | null>(null)
  const attach = useCallback((element: HTMLElement | null) => {
    anchor.current = element
  }, [])
  const [active, setActive] = useState(false)
  useEffect(() => {
    if (!enabled) return
    const root = anchor.current?.closest(`[${CELL_HOVER_ROOT_ATTR}]`)
    if (!root) return
    let cancel: (() => void) | undefined
    const enter = () => {
      // Deliberately NOT cancelling first: re-entering the same root while
      // already armed is the director's own no-op, and cancelling here would
      // turn Chromium's repeated entries under a stationary pointer into a
      // dwell that restarts forever (see armHoverPlay).
      cancel = armHoverPlay(root, setActive)
    }
    const leave = () => {
      cancel?.()
      cancel = undefined
      setActive(false)
    }
    root.addEventListener("pointerenter", enter)
    root.addEventListener("pointerleave", leave)
    return () => {
      cancel?.()
      // Reset with the listeners. `enabled` can go false under a resting
      // pointer (the extreme-aspect layer covering this picture), and a latch
      // left standing would fire the moment it came back with no entry behind
      // it.
      setActive(false)
      root.removeEventListener("pointerenter", enter)
      root.removeEventListener("pointerleave", leave)
    }
  }, [enabled])
  return { attach, active }
}
