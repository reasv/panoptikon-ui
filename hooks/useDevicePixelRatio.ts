import { useEffect, useState } from "react"

/**
 * The window's device pixel ratio, kept current.
 *
 * The tier a grid cell asks for is decided in DEVICE pixels (a 400px cell on a
 * 2× display needs the same rendition as an 800px cell on a 1× one), so the
 * ratio is half of that arithmetic and it is not a constant: a browser zoom
 * step changes it, and so does dragging the window between monitors of
 * different densities.
 *
 * Watched with a one-shot `(resolution: Ndppx)` media query re-armed after
 * every change — the platform's own event for this — WITH a window `resize` as
 * a second trigger. The media query alone is not enough in practice: a ratio
 * changed under DevTools device emulation flips the query's `matches` without
 * ever dispatching its `change` event (verified against Chromium's
 * `Emulation.setDeviceMetricsOverride`), which would strand every surface on a
 * stale tier for the session. Resize is the cheap belt: both real causes — a
 * zoom step and a drag to a monitor of another density — resize the layout
 * viewport, and the state write bails out whenever the ratio is unchanged, so
 * the hundred resizes that move nothing cost one comparison each.
 *
 * 1 until the first effect runs, which is the right SSR answer: the server has
 * no display, and one round of cells at a conservative tier costs nothing
 * because the grid renders no cells at all until its layout effects have
 * measured (columns are 0 before then).
 */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(1)
  useEffect(() => {
    let cancelled = false
    let media: MediaQueryList | null = null
    const onChange = () => {
      if (cancelled) return
      // The listener fires once, for the ratio it was armed at; re-arming
      // against the NEW ratio is what makes the next change observable.
      arm()
    }
    const arm = () => {
      media?.removeEventListener("change", onChange)
      const next = window.devicePixelRatio || 1
      setDpr((prev) => (prev === next ? prev : next))
      media = window.matchMedia(`(resolution: ${next}dppx)`)
      media.addEventListener("change", onChange)
    }
    arm()
    window.addEventListener("resize", onChange)
    return () => {
      cancelled = true
      window.removeEventListener("resize", onChange)
      media?.removeEventListener("change", onChange)
    }
  }, [])
  return dpr
}
