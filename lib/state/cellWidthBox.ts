/**
 * The result grid's MEASURED cell width, as a subscribable box rather than a
 * piece of component state — lib/state/derivedPage.ts is the template, and the
 * reasoning is the same one, applied to a different number.
 *
 * The grid is the only place the value can be computed (it owns the container
 * measurement and the column count), and the size-slider control in the
 * results header is the only place it is read — it seeds the slider's thumb
 * while the grid is in AUTO mode, so the first drag continues from the width
 * the user is looking at instead of jumping to an arbitrary number. Nothing
 * between the two needs to see it, so nothing between them should re-render
 * for it: held as GridPanel state, every resize tick would re-render the panel
 * and the whole grid to move a slider nobody has opened.
 *
 * Created per MOUNT (GridPanel), never as a module singleton: a module-level
 * value is shared across SSR requests in one server process.
 *
 * Import-free on purpose, like the module it mirrors.
 */
export interface CellWidthStore {
  /** The last measured cell width in CSS pixels; 0 until the grid measures. */
  get(): number
  /** Publish a measurement. Writing the value already held notifies nobody. */
  set(width: number): void
  /** Subscribe; the returned function unsubscribes. */
  subscribe(onChange: () => void): () => void
}

export function createCellWidthStore(initial: number = 0): CellWidthStore {
  let width = initial
  const listeners = new Set<() => void>()
  return {
    get: () => width,
    set: (next: number) => {
      if (next === width) return
      width = next
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
