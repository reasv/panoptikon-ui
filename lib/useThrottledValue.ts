import { useEffect, useRef, useState } from "react"

/**
 * Rate-limits changes to a value, comparing by *content* (JSON) rather than by
 * reference, so it is safe to feed it objects that are rebuilt on every render.
 * Only JSON-serializable values are supported.
 *
 * Behaviour:
 * - Leading edge: if at least `intervalMs` has passed since the last propagated
 *   change, a new value propagates immediately — discrete changes (toggles,
 *   clicks, navigation) are never delayed.
 * - Trailing edge: changes arriving inside the window are coalesced and the
 *   latest one propagates when the window closes — rapid-fire sources (typing,
 *   slider drags) produce at most one update per `intervalMs`.
 * - Settles: once the output matches the input by content, nothing re-fires and
 *   the returned reference stays stable until the content actually changes.
 *
 * An `intervalMs` <= 0 propagates every change on the next effect flush, but
 * callers that want throttling fully disabled should just use the input value.
 *
 * `contentKey` supplies that content comparison from outside, and the callers
 * on the search page's hot path all have one already: `useSearch` hashes the
 * very same request to key its query, and the chunk store is handed that hash.
 * Passing it turns this hook's per-render cost from a full `JSON.stringify` of
 * the whole search query into a string compare — twice per render of the
 * search page, since the two throttles were serializing overlapping halves of
 * the same object. It must be a pure function of the value's CONTENT and of
 * nothing else: a key that moves while the content stands still propagates a
 * new reference (harmless, merely early), and one that stands still while the
 * content moves loses the change entirely.
 *
 * This hook is one of the few the React Compiler skips (the effect below
 * suppresses exhaustive-deps, which opts out the whole function), so the
 * serialization it does is done on every render of every caller — which is
 * exactly why the escape hatch is worth having.
 */
export function useThrottledValue<T>(
  value: T,
  intervalMs: number,
  contentKey?: string
): T {
  const [throttled, setThrottled] = useState(value)
  const serialized = contentKey ?? JSON.stringify(value)
  // Initialized from the first render's serialization, matching useState(value)
  const throttledSerialized = useRef(serialized)
  const lastPropagated = useRef<number | null>(null)

  useEffect(() => {
    if (serialized === throttledSerialized.current) {
      return
    }
    const propagate = () => {
      lastPropagated.current = Date.now()
      throttledSerialized.current = serialized
      setThrottled(value)
    }
    const elapsed =
      lastPropagated.current === null
        ? Infinity
        : Date.now() - lastPropagated.current
    if (elapsed >= intervalMs) {
      propagate()
      return
    }
    const timer = setTimeout(propagate, intervalMs - elapsed)
    return () => clearTimeout(timer)
    // `value` is deliberately keyed by `serialized`: a rebuilt object with
    // identical content must not count as a change (that identity churn is
    // exactly what made the previous useThrottle wiring loop forever).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, intervalMs])

  return throttled
}
