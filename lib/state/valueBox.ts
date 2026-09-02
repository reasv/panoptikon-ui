/**
 * The subscribable value box, once.
 *
 * A box is a value plus a listener set: `get` returns the value, `set`
 * publishes a new one (bailing when it equals the current), `subscribe`
 * registers a callback and hands back its unsubscribe. It is the shape
 * `useSyncExternalStore` wants, and it exists so that a value with exactly one
 * writer and one reader can travel between them without re-rendering every
 * component in between — see lib/state/derivedPage.ts and
 * lib/state/gridMetricsBox.ts for the two numbers this was built for and what
 * holding them as component state was costing.
 *
 * THE MECHANISM LIVES HERE; THE DOMAIN LIVES THERE. Each caller keeps its own
 * named interface, its own doc explaining what its value means and why it is
 * not `useState`, and its own factory function — this only supplies the parts
 * that were verbatim identical between them, down to the unsubscribe-during-
 * notify comment below.
 *
 * Import-free on purpose, like its callers and for the same reason: it
 * executes under plain node in the test suites (scripts/scrollmode.test.mjs).
 */
export interface ValueBox<T> {
  /**
   * The current value. STABLE BETWEEN WRITES — the same reference comes back
   * until `set` accepts a new one, which is what makes it a valid
   * `useSyncExternalStore` snapshot (a fresh object per read would re-render
   * its reader forever).
   */
  get(): T
  /**
   * Publish a value. A write the equality check considers unchanged notifies
   * nobody — the same bail-out `useState` performs, and the reason a
   * per-scroll or per-resize push costs nothing while the value stands still.
   */
  set(next: T): void
  /** Subscribe; the returned function unsubscribes. */
  subscribe(onChange: () => void): () => void
}

/**
 * @param initial the value the box starts holding.
 * @param equals when two values are the same value, and therefore when a write
 * notifies nobody. Defaults to `Object.is`, which is what a box over a
 * primitive wants; a box over an object passes a field comparison so that a
 * freshly built but equal object does not wake its readers.
 */
export function createValueBox<T>(
  initial: T,
  equals: (a: T, b: T) => boolean = Object.is
): ValueBox<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next: T) => {
      if (equals(next, value)) return
      value = next
      // Iterated over a copy: a listener is free to unsubscribe on its own
      // notification (React does, when the subscribing component unmounts),
      // and mutating the set under its own iteration is how that turns into a
      // missed notification for whoever came after it.
      for (const listener of [...listeners]) listener()
    },
    subscribe: (onChange: () => void) => {
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
      }
    },
  }
}
