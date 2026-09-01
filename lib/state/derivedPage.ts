/**
 * The scroll-mode derived virtual page, as a subscribable box rather than a
 * piece of component state.
 *
 * WHY IT IS NOT A `useState`. The number changes every `page_size` items
 * scrolled — with the default k = 10 and five columns, every two rows, which
 * on a continuous scroll is several times a second. Held in MultiSearchView
 * (where it used to live) every one of those crossings re-rendered the search
 * page's largest component and, through it, GridPanel and the whole result
 * grid: ~24 nuqs keymaps re-instantiated, the search request rebuilt and
 * re-hashed, and the grid's virtual rows re-created — all so that a number in
 * the pagination bar could move by one. Nothing between the writer (the grid's
 * scroll listener) and the reader (the bar) needs to see the value, so nothing
 * between them should re-render for it.
 *
 * The box is created per MOUNT (see useDerivedVirtualPage in
 * app/search/SearchPage.tsx), never as a module singleton. Two reasons, and
 * both are load-bearing: a module-level value is shared across SSR requests in
 * one server process, and the initial value is *derived from the URL anchor on
 * the first render*, which is exactly what makes a deep link paint the right
 * page number instead of flashing page 1 for a frame.
 *
 * Import-free on purpose, like lib/scrollMode.ts and for the same reason: it
 * executes under plain node in scripts/scrollmode.test.mjs. The React side is
 * one `useSyncExternalStore` call in the one component that displays the value
 * (components/pageselect.tsx).
 */

/**
 * A read/write box with subscribers. Every member is created once per store
 * and keeps its identity for the store's whole life — `set` is handed to the
 * grid's and the strip's scroll listeners, which re-subscribe (and reset their
 * 350 ms scroll-stop timers) whenever it changes, exactly as they did when it
 * was a `useState` setter.
 */
export interface DerivedPageStore {
  /** The current virtual page. Stable between writes, so it is a valid
   * `useSyncExternalStore` snapshot. */
  get(): number
  /**
   * Publish a new virtual page. A write of the value already held notifies
   * nobody — the same bail-out `useState` performs, and the reason the
   * gallery's and the strip's per-scroll pushes cost nothing while the number
   * stands still.
   */
  set(page: number): void
  /** Subscribe; the returned function unsubscribes. */
  subscribe(onChange: () => void): () => void
}

export function createDerivedPageStore(initial: number): DerivedPageStore {
  let page = initial
  const listeners = new Set<() => void>()
  return {
    get: () => page,
    set: (next: number) => {
      if (next === page) return
      page = next
      // Iterated over a copy: a listener is free to unsubscribe (React does,
      // when the subscribing component unmounts on the very notification) and
      // mutating the set under its own iteration is how that turns into a
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
