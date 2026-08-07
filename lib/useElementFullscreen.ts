import React from "react"

// Element fullscreen for the wrapper that holds a <video> and its player
// surface. Element (not screen) fullscreen is what keeps the custom surface
// on top of the picture — anything portalled to document.body would render
// outside the fullscreen element and be invisible while it is active.
//
// `isFullscreen` is true only for THIS element: a different element being
// fullscreen reads as false, so every player on the page stays truthful.
export function useElementFullscreen(
  targetRef?: React.RefObject<HTMLElement | null>
): {
  isFullscreen: boolean
  supported: boolean
  enter: () => void
  exit: () => void
  toggle: () => void
} {
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const [supported, setSupported] = React.useState(false)

  React.useEffect(() => {
    setSupported(targetRef != null && document.fullscreenEnabled === true)
    const sync = () => {
      const el = targetRef?.current ?? null
      setIsFullscreen(el != null && document.fullscreenElement === el)
    }
    sync()
    document.addEventListener("fullscreenchange", sync)
    return () => document.removeEventListener("fullscreenchange", sync)
  }, [targetRef])

  const enter = React.useCallback(() => {
    const el = targetRef?.current
    if (!el || document.fullscreenElement === el) return
    void el.requestFullscreen().catch(() => { })
  }, [targetRef])

  // Scoped like toggle(): a different element being fullscreen is not ours to
  // exit — every player on the page shares one document
  const exit = React.useCallback(() => {
    const el = targetRef?.current
    if (!el || document.fullscreenElement !== el) return
    void document.exitFullscreen().catch(() => { })
  }, [targetRef])

  const toggle = React.useCallback(() => {
    const el = targetRef?.current
    if (!el) return
    if (document.fullscreenElement === el) void document.exitFullscreen().catch(() => { })
    else void el.requestFullscreen().catch(() => { })
  }, [targetRef])

  return { isFullscreen, supported, enter, exit, toggle }
}
