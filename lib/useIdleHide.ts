import React from "react"

// Visibility driver for the video player surface: the surface appears on
// pointer activity over the video and hides again after a stillness timeout.
//
// Two hold classes, both written by the caller:
//
// - INVARIANT: `holdOpen` is absolute — while it is true nothing hides the
//   surface, not the idle timer and not pointer leave (pointer over a
//   control, gesture in flight, menu open).
// - `holdIdle` stops the idle timer only; pointer leave still hides. A
//   paused video holds this way, so a pause the user never asked for
//   (blocked autoplay) cannot pin a surface open after one stray hover.
//
// The element carrying `containerProps` must CONTAIN the surface: a surface
// rendered as a sibling would make the container fire pointerleave before
// the surface can raise its hold, and the controls would vanish under the
// pointer on the way to them.

// Stillness before the surface fades out
const IDLE_MS = 2500
// Pointer moves are continuous; restarting the idle timer on every one of
// them would be a state update per event. The hide can therefore land up to
// this late, which is invisible against a 2.5s timeout.
const POKE_THROTTLE_MS = 150

export interface IdleHideHandlers {
  onPointerEnter: () => void
  onPointerMove: () => void
  onPointerLeave: () => void
}

export function useIdleHide({
  enabled = true,
  holdOpen = false,
  holdIdle = false,
  idleMs = IDLE_MS,
  showOnEnable = false,
}: {
  enabled?: boolean
  holdOpen?: boolean
  // Blocks the idle timer only — pointer leave still hides
  holdIdle?: boolean
  idleMs?: number
  // Reveal once when the player world turns on, without waiting for the
  // first pointer move (the pointer is already parked on the play button
  // that got here). OFF by default: a board of autoplaying pins would
  // otherwise flash every surface at once on load.
  showOnEnable?: boolean
} = {}): {
  visible: boolean
  containerProps: IdleHideHandlers
  show: () => void
} {
  const [visible, setVisible] = React.useState(false)
  // Bumped by (throttled) pointer activity; restarts the idle effect below
  const [pokeNonce, setPokeNonce] = React.useState(0)
  const lastPokeRef = React.useRef(0)
  // Leave-hide is edge-triggered on this nonce, not level-triggered on "the
  // pointer is outside": the pointer is outside for the whole showOnEnable
  // reveal, which a level rule would hide instantly.
  const [leaveNonce, setLeaveNonce] = React.useState(0)
  // The leave effect must read the hold COMMITTED WITH the leave: the
  // surface's own pointerleave drops the pointer hold in the same batch as
  // the container's, so a closure read there sees the pre-leave value and
  // swallows the hide. Synced by the effect below, which is declared first
  // and therefore runs first on that commit.
  const holdOpenRef = React.useRef(holdOpen)
  React.useEffect(() => {
    holdOpenRef.current = holdOpen
  }, [holdOpen])

  const show = React.useCallback(() => {
    setVisible(true)
    const now = performance.now()
    if (now - lastPokeRef.current < POKE_THROTTLE_MS) return
    lastPokeRef.current = now
    setPokeNonce((n) => n + 1)
  }, [])

  React.useEffect(() => {
    if (!enabled || !visible || holdOpen || holdIdle) return
    const t = window.setTimeout(() => setVisible(false), idleMs)
    return () => window.clearTimeout(t)
  }, [enabled, visible, holdOpen, holdIdle, idleMs, pokeNonce])

  // Deps are the nonce alone: a later hold release must not retroactively
  // fire the hide for a leave that was held
  React.useEffect(() => {
    if (leaveNonce === 0 || holdOpenRef.current) return
    setVisible(false)
  }, [leaveNonce])

  React.useEffect(() => {
    if (!enabled) setVisible(false)
    else if (showOnEnable) show()
  }, [enabled, showOnEnable, show])

  const hideOnLeave = React.useCallback(() => {
    setLeaveNonce((n) => n + 1)
  }, [])

  return {
    visible: enabled && visible,
    containerProps: {
      onPointerEnter: show,
      onPointerMove: show,
      onPointerLeave: hideOnLeave,
    },
    show,
  }
}

// False during SSR and the first client render, so the fade classes it
// governs never differ between server and hydrated markup.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false)
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])
  return reduced
}
