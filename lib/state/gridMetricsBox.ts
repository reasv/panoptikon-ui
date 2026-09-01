/**
 * The result grid's MEASURED geometry, as a subscribable box rather than a
 * piece of component state — lib/state/derivedPage.ts is the template, and the
 * reasoning is the same one applied to different numbers.
 *
 * The grid is the only place these can be computed (it owns the container
 * measurement and the column count), and the size-slider control in the
 * results header is the only place they are read. It needs all three:
 *
 *   - `cellWidth` seeds the slider's thumb while the grid is in AUTO mode, so
 *     the first drag continues from the width the user is looking at;
 *   - `containerWidth` turns a candidate target width into the column count
 *     and cell width it would actually lay out, which is what the page-size
 *     co-write is computed against — the LAID-OUT width, not the target, is
 *     what decides how many cells fit on a screen;
 *   - `columns` is what the page size must stay a multiple of, so that no grid
 *     row ever straddles a virtual-page boundary (design §4: the pagination
 *     bar highlights the row's LAST item while the URL anchor names its FIRST,
 *     and those two agree only while `k % columns === 0`).
 *
 * Nothing between writer and reader needs to see any of it, so nothing between
 * them should re-render for it: held as GridPanel state, every resize tick
 * would re-render the panel and the whole grid to move a slider nobody has
 * opened.
 *
 * Created per MOUNT (GridPanel), never as a module singleton: a module-level
 * value is shared across SSR requests in one server process.
 *
 * Import-free on purpose, like the module it mirrors.
 */
import { createValueBox, type ValueBox } from "./valueBox"

export interface GridMetrics {
  /** The laid-out cell width in CSS pixels; 0 until the grid measures. */
  cellWidth: number
  /** How many columns are laid out; 0 until the grid measures. */
  columns: number
  /** The row container's content width in CSS pixels; 0 until measured. */
  containerWidth: number
}

/**
 * A read/write box of measurements, with subscribers.
 *
 * Named rather than an alias in the call sites for the same reason
 * DerivedPageStore is: what it holds and when it notifies is the contract the
 * slider depends on; `ValueBox<GridMetrics>` is only how it is built.
 */
export type GridMetricsStore = ValueBox<GridMetrics>

/** What a control mounted without a grid behind it reads, and the SSR value. */
export const EMPTY_GRID_METRICS: GridMetrics = {
  cellWidth: 0,
  columns: 0,
  containerWidth: 0,
}

/**
 * The mechanism is lib/state/valueBox.ts. The CUSTOM equality is the whole
 * reason this box needs one: the grid publishes a freshly built object on
 * every measurement, so `Object.is` would treat every resize tick — including
 * the ones that measured the identical three numbers — as a change and wake
 * the slider for it. Comparing the fields is what keeps `get()`'s identity
 * stable between real measurements, which is what makes it a valid
 * `useSyncExternalStore` snapshot.
 */
export function createGridMetricsStore(
  initial: GridMetrics = EMPTY_GRID_METRICS
): GridMetricsStore {
  return createValueBox(initial, (a, b) =>
    a.cellWidth === b.cellWidth &&
    a.columns === b.columns &&
    a.containerWidth === b.containerWidth
  )
}
