// Justified-row packing for the pinboard.
//
// packRows breaks an ordered list of items into rows and sizes everything so
// the block spans the full grid width and fills a target number of grid rows
// EXACTLY — filling exactly matters because the grid compacts vertically:
// items parked below the fold (the user's "cutting board") settle right
// against the packed block's bottom edge, so a block that comes up short
// pulls them into view.
//
// Row breaks (rowCount "auto") are chosen by dynamic programming over the
// ACCUMULATED quantized height: the letterbox a forced total inflicts is a
// uniform stretch of budget/sum(naturalRowHeights), so the primary objective
// is landing that sum on the budget — rows keep their individual natural
// heights and the stretch approaches zero. Balance (squared deviation from
// an estimated uniform row height) only breaks ties among configurations
// reaching the same total. A fixed rowCount instead means "split the space
// evenly among N rows", so there the uniform-target cost IS the objective.
// Reading order is always preserved — items only move as far as their new
// sizes force them to.
//
// justifyRows is the no-reflow variant: it keeps the caller's row groupings
// (the current arrangement) and only resizes each row to span the full
// width at its natural height.

import type { LayoutItem } from "react-grid-layout"
import { GridParams, rowStep } from "./pinboardGrid"

export interface PackItem {
  key: string
  // Effective source dimensions (after crop); only the ratio matters
  width: number
  height: number
}

const ratio = (it: PackItem) => (it.width || 1) / (it.height || 1)

// Pixel size of an item spanning w columns / h rows, including the margins
// between the cells it spans
function pixelWidth(w: number, columnWidth: number, margin: number): number {
    return w * columnWidth + (w - 1) * margin
}

// Height of a row justified to the full grid width with every item at its
// true aspect: the width available to images (grid width minus the margins
// between them) divided by the summed aspect ratios
function rowNaturalHeight(row: PackItem[], grid: GridParams, columnWidth: number): number {
    const imagesPx = pixelWidth(grid.columns, columnWidth, grid.margin)
        - (row.length - 1) * grid.margin
    return imagesPx / row.reduce((acc, it) => acc + ratio(it), 0)
}

// Largest-remainder apportionment: integers proportional to `ideal` summing
// exactly to `total`, each at least `minEach` — capped at what `total` can
// actually give every entry, so an unsatisfiable minimum degrades instead
// of overflowing (assumes total >= ideal.length)
export function apportionToTotal(ideal: number[], total: number, minEach = 1): number[] {
    const effMin = Math.max(1, Math.min(minEach, Math.floor(total / ideal.length)))
    const sum = ideal.reduce((acc, v) => acc + v, 0) || 1
    const scaled = ideal.map(v => (v * total) / sum)
    const counts = scaled.map(v => Math.max(effMin, Math.floor(v)))
    let used = counts.reduce((acc, v) => acc + v, 0)
    const byRemainder = scaled
        .map((v, i) => ({ i, frac: v - Math.floor(v) }))
        .sort((a, b) => b.frac - a.frac)
    for (let k = 0; used < total; k = (k + 1) % byRemainder.length, used++) {
        counts[byRemainder[k].i]++
    }
    // The minimum can push the total over; take back from the largest
    while (used > total) {
        let largest = -1
        for (let i = 0; i < counts.length; i++) {
            if (counts[i] > effMin && (largest < 0 || counts[i] > counts[largest])) largest = i
        }
        if (largest < 0) break
        counts[largest]--
        used--
    }
    return counts
}

// Escape hatch for boards where the minimum item size is unsatisfiable
// (too many items for the target rectangle): halve the larger minimum
// until the pessimistic capacity check passes or the 1-cell floor is
// reached. Monotone and bounded (a handful of halvings), never a search —
// the degenerate case degrades to the historical 1-cell floors instead of
// failing, looping, or pushing content far past the fold.
function relaxMinimums(
    n: number,
    columns: number,
    totalRows: number,
    minW: number,
    minH: number,
): { minW: number; minH: number } {
    let w = Math.max(1, Math.min(minW, columns))
    let h = Math.max(1, Math.min(minH, totalRows))
    // Pessimistic capacity: full rows of minimum-width items, each row at
    // the minimum height, must fit the target rectangle
    const fits = () => Math.ceil(n / Math.floor(columns / w)) * h <= totalRows
    while (!fits() && (w > 1 || h > 1)) {
        if (w >= h) w = Math.max(1, Math.floor(w / 2))
        else h = Math.max(1, Math.floor(h / 2))
    }
    return { minW: w, minH: h }
}

// Column counts for one row at a fixed pixel height: round every item up
// when the row has room (so images reach the shared row height instead of
// sitting narrow-and-letterboxed), otherwise apportion proportionally
// within the width cap. minW floors every count, capped at the width the
// row can actually give each item.
function rowColumnCounts(
    row: PackItem[],
    targetHeightPx: number,
    grid: GridParams,
    columnWidth: number,
    minW = 1,
): number[] {
    const effMin = Math.max(1, Math.min(minW, Math.floor(grid.columns / row.length)))
    const idealColumns = row.map(it =>
        (ratio(it) * targetHeightPx + grid.margin) / (columnWidth + grid.margin)
    )
    const ceilColumns = idealColumns.map(v => Math.max(effMin, Math.ceil(v)))
    if (ceilColumns.reduce((acc, v) => acc + v, 0) <= grid.columns) return ceilColumns
    const total = Math.min(grid.columns, Math.max(
        idealColumns.length,
        Math.round(idealColumns.reduce((acc, v) => acc + v, 0)),
    ))
    return apportionToTotal(idealColumns, total, effMin)
}

// Append one row's items to the layout, centered when it doesn't span the
// full width; returns the row's grid height for the caller's y cursor
function emitRow(
    layout: LayoutItem[],
    row: PackItem[],
    hGrid: number,
    y: number,
    grid: GridParams,
    columnWidth: number,
    minW = 1,
) {
    const targetPx = hGrid * rowStep(grid) - grid.margin
    const counts = rowColumnCounts(row, targetPx, grid, columnWidth, minW)
    const used = counts.reduce((acc, v) => acc + v, 0)
    let x = Math.max(0, Math.floor((grid.columns - used) / 2))
    row.forEach((it, i) => {
        layout.push({ i: it.key, x, y, w: counts[i], h: hGrid })
        x += counts[i]
    })
}

// Best break positions for exactly `m` rows against a uniform target row
// height of `targetPx`, minimizing summed squared relative deviation.
// Returns null when infeasible (m > items).
function breakIntoRows(
    items: PackItem[],
    m: number,
    targetPx: number,
    grid: GridParams,
    columnWidth: number,
): { rows: PackItem[][], cost: number } | null {
    const n = items.length
    if (m < 1 || m > n) return null
    // Prefix ratio sums make a candidate row's justified height O(1)
    const prefix = [0]
    for (const it of items) prefix.push(prefix[prefix.length - 1] + ratio(it))
    const fullPx = pixelWidth(grid.columns, columnWidth, grid.margin)
    const costOf = (i: number, j: number) => {
        const height = (fullPx - (j - i - 1) * grid.margin) / (prefix[j] - prefix[i])
        const dev = (height - targetPx) / targetPx
        return dev * dev
    }
    const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(Infinity))
    const from = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(-1))
    dp[0][0] = 0
    for (let r = 1; r <= m; r++) {
        // Row r ends at item j; leave at least one item for each later row
        for (let j = r; j <= n - (m - r); j++) {
            for (let i = r - 1; i < j; i++) {
                if (dp[r - 1][i] === Infinity) continue
                const c = dp[r - 1][i] + costOf(i, j)
                if (c < dp[r][j]) {
                    dp[r][j] = c
                    from[r][j] = i
                }
            }
        }
    }
    if (dp[m][n] === Infinity) return null
    const rows: PackItem[][] = []
    let j = n
    for (let r = m; r >= 1; r--) {
        const i = from[r][j]
        rows.unshift(items.slice(i, j))
        j = i
    }
    return { rows, cost: dp[m][n] }
}

// Break positions minimizing the distance between the accumulated quantized
// row heights and the budget; ties broken by balance around an estimated
// uniform row height. Returns null when no configuration lands within the
// search slack (e.g. a single item whose natural height dwarfs the budget).
function breakIntoRowsByTotal(
    items: PackItem[],
    totalGridRows: number,
    grid: GridParams,
    columnWidth: number,
    minH = 1,
): { rows: PackItem[][], heights: number[] } | null {
    const n = items.length
    const step = rowStep(grid)
    const margin = grid.margin
    const prefix = [0]
    for (const it of items) prefix.push(prefix[prefix.length - 1] + ratio(it))
    const fullPx = pixelWidth(grid.columns, columnWidth, margin)
    const budgetPx = totalGridRows * step - margin
    // Row count that would make uniform natural rows total the budget:
    // m rows of n/m items have height ~ fullPx*m/totalRatio each, so
    // solving m * (fullPx*m/R) = budgetPx gives m = sqrt(budgetPx*R/fullPx)
    const mEst = Math.max(1, Math.min(n, Math.round(Math.sqrt(budgetPx * prefix[n] / fullPx))))
    const targetPx = (totalGridRows / mEst) * step - margin
    const heightPxOf = (i: number, j: number) =>
        (fullPx - (j - i - 1) * margin) / (prefix[j] - prefix[i])
    // Accumulations past the budget by more than the slack are pruned; a
    // small overshoot must stay reachable so the closest total can be > the
    // budget when nothing lands on it exactly
    const maxB = totalGridRows + Math.max(8, Math.round(totalGridRows / 2))
    const dp = Array.from({ length: n + 1 }, () => new Array<number>(maxB + 1).fill(Infinity))
    const fromI = Array.from({ length: n + 1 }, () => new Array<number>(maxB + 1).fill(-1))
    dp[0][0] = 0
    for (let j = 1; j <= n; j++) {
        for (let i = 0; i < j; i++) {
            const heightPx = heightPxOf(i, j)
            const q = Math.max(minH, Math.round((heightPx + margin) / step))
            const dev = (heightPx - targetPx) / targetPx
            const cost = dev * dev
            if (q > maxB) continue
            for (let b = 0; b + q <= maxB; b++) {
                if (dp[i][b] === Infinity) continue
                const c = dp[i][b] + cost
                if (c < dp[j][b + q]) {
                    dp[j][b + q] = c
                    fromI[j][b + q] = i
                }
            }
        }
    }
    // Closest reachable total; ties prefer overshoot (spills past the fold)
    // over undershoot (lets the cutting board rise into view), then balance
    let bestB = -1
    for (let b = 0; b <= maxB; b++) {
        if (dp[n][b] === Infinity) continue
        if (bestB < 0) { bestB = b; continue }
        const d = Math.abs(b - totalGridRows)
        const dBest = Math.abs(bestB - totalGridRows)
        // Equidistant totals can only be budget-d and budget+d; b iterates
        // upward, so the later (overshooting) one wins
        if (d < dBest || d === dBest) bestB = b
    }
    if (bestB < 0) return null
    const rows: PackItem[][] = []
    const heights: number[] = []
    let j = n
    let b = bestB
    while (j > 0) {
        const i = fromI[j][b]
        // Must quantize exactly like the DP above or the b bookkeeping drifts
        const q = Math.max(minH, Math.round((heightPxOf(i, j) + margin) / step))
        rows.unshift(items.slice(i, j))
        heights.unshift(q)
        j = i
        b -= q
    }
    return { rows, heights }
}

// Pack `items` (in reading order) into justified rows spanning exactly
// `totalGridRows` grid rows.
export function packRows({
    items,
    grid,
    columnWidth,
    totalGridRows,
    rowCount,
    forceFill = false,
    minW = 1,
    minH = 1,
}: {
    items: PackItem[],
    grid: GridParams,
    columnWidth: number,
    totalGridRows: number,
    rowCount: number | "auto",
    // Always span totalGridRows exactly, even at the cost of heavy
    // letterboxing. The visible-only fill needs this: an under-filled block
    // lets the cutting board below the fold compact up into view, which is
    // worse than any letterbox.
    forceFill?: boolean,
    // Minimum item size in grid units; relaxed (see relaxMinimums) when the
    // board can't give every item that much
    minW?: number,
    minH?: number,
}): LayoutItem[] {
    if (items.length === 0) return []
    const total = Math.max(1, totalGridRows)
    const step = rowStep(grid)
    const maxRows = Math.min(items.length, total)
    const mins = relaxMinimums(items.length, grid.columns, total, minW, minH)
    let rows: PackItem[][] | null = null
    let heights: number[] | null = null
    if (rowCount === "auto") {
        const byTotal = breakIntoRowsByTotal(items, total, grid, columnWidth, mins.minH)
        if (byTotal) {
            rows = byTotal.rows
            heights = byTotal.heights
        }
    }
    if (!rows) {
        // Fixed row count ("split the space evenly among N rows"), or the
        // fallback when no natural configuration lands near the budget:
        // uniform target height, minimize deviation from it
        const candidates = rowCount === "auto"
            ? Array.from({ length: maxRows }, (_, i) => i + 1)
            : [Math.max(1, Math.min(rowCount, maxRows))]
        let best: { rows: PackItem[][], cost: number } | null = null
        for (const m of candidates) {
            const targetPx = (total / m) * step - grid.margin
            if (targetPx <= 0) continue
            const result = breakIntoRows(items, m, targetPx, grid, columnWidth)
            if (result && (!best || result.cost < best.cost)) best = result
        }
        if (!best) return []
        rows = best.rows
        heights = rows.map(row =>
            Math.max(mins.minH, Math.round((rowNaturalHeight(row, grid, columnWidth) + grid.margin) / step))
        )
    }
    // Force the quantized heights to sum exactly to the target so the block
    // walls off the viewport; when the breaks landed on the budget this
    // changes nothing. Forcing is asymmetric: SHRINKING oversized content is
    // aspect-safe (rows narrow to keep their aspect, trading width instead),
    // but STRETCHING undersized content letterboxes every full-width row by
    // the stretch factor. When no configuration lands anywhere near the
    // budget from below (a handful of items on a huge viewport can naturally
    // fill 47 rows or 190, nothing between), auto mode prefers natural
    // heights and an unfilled viewport over grotesque letterboxing; an
    // explicit row count is a direct order and always fills.
    const chosen = heights!.reduce((acc, v) => acc + v, 0)
    const stretch = total / chosen
    if (chosen !== total && (forceFill || rowCount !== "auto" || stretch <= 1.35)) {
        heights = apportionToTotal(heights!, total, mins.minH)
    }
    const layout: LayoutItem[] = []
    let y = 0
    rows.forEach((row, r) => {
        emitRow(layout, row, heights![r], y, grid, columnWidth, mins.minW)
        y += heights![r]
    })
    return layout
}

// Resize-only justification: keep the caller's row groupings (the current
// arrangement) and give each row its natural full-width height. No fold
// fitting — the arrangement just stops letterboxing and uses the width.
export function justifyRows({
    groups,
    grid,
    columnWidth,
    minW = 1,
    minH = 1,
}: {
    groups: PackItem[][],
    grid: GridParams,
    columnWidth: number,
    minW?: number,
    minH?: number,
}): LayoutItem[] {
    const step = rowStep(grid)
    const layout: LayoutItem[] = []
    let y = 0
    for (const row of groups) {
        if (row.length === 0) continue
        const natural = rowNaturalHeight(row, grid, columnWidth)
        // No fold budget here, so no relaxation: an over-min row height just
        // makes the block taller and it scrolls
        const hGrid = Math.max(minH, Math.round((natural + grid.margin) / step))
        emitRow(layout, row, hGrid, y, grid, columnWidth, minW)
        y += hGrid
    }
    return layout
}

// ---------------------------------------------------------------------------
// Mosaic packing: fill a target rectangle with 2D compositions, not just rows.
//
// Row-based layouts are structurally incapable of filling a viewport with few
// items: a handful of images whose aspect ratios sum to 5 on a 2:1 viewport
// can make one short row or two overflowing ones, nothing in between. Filling
// requires columns and nested stacks — "portrait full-height on the left, a
// wide video over two small ones on the right".
//
// The search space is order-preserving binary partitions of the item
// sequence. Aspect ratios compose: side-by-side (same height) adds them,
// a1 + a2; stacking (same width) combines them harmonically,
// a1*a2/(a1 + a2). Every leaf keeps its own aspect EXACTLY, so a tree whose
// composed aspect matches the viewport aspect fills the viewport with no
// letterboxing at all — the DP below searches for that tree, bucketing
// achievable aspects per item interval in log space to stay polynomial.
// Whatever mismatch remains at the root is spread evenly across all items
// when the composition is stretched onto the target rectangle.

interface MosaicEntry {
    a: number      // composed pixel aspect of this subtree
    k: number      // split index; -1 = leaf
    dir: 0 | 1     // 0 = side by side, 1 = stacked
    lb: number     // bucket key of the left/top child
    rb: number     // bucket key of the right/bottom child
    // Statistics of the leaves' DEVIATION values — log(leaf area fraction
    // of the subtree) minus log(the leaf's target share) — count, sum, sum
    // of squares. Their variance measures how far the composition strays
    // from the target proportions; with uniform targets (the default) that
    // is exactly leaf-size disparity. Without it the DP happily pairs a
    // giant leaf with a strip of thumbnails, since any tree with a matching
    // root aspect is otherwise equally good.
    c: number
    sl: number
    sl2: number
    // Min/max deviation value over the subtree's leaves: mx - mn is the log
    // of the worst over-target/under-target area ratio, so a cap on
    // disparity can steer the search instead of being discovered broken in
    // the output.
    mn: number
    mx: number
    // Feasibility slack: min over leaves of (log leaf share - log of the
    // minimum pixel area that leaf needs to satisfy minW x minH at its own
    // aspect). A subtree rendered into a box of A px² keeps every leaf
    // above the minimum iff fs + log(A) >= 0.
    fs: number
}

// A resolved composition tree: what emitTree renders. packMosaic resolves
// its winning DP entry into one; recoverTree builds one from an existing
// arrangement so the same emitter can re-render a layout the user made.
export interface MosaicNode {
    a: number
    key: string | null // leaf's item key; null for internal nodes
    dir: 0 | 1
    left: MosaicNode | null
    right: MosaicNode | null
}

const MOSAIC_BUCKET = 0.05
// Above this the interval DP gets slow; callers fall back to row packing
// (dense boards are exactly where rows work fine)
export const MOSAIC_MAX_ITEMS = 60
// Cap on aspect buckets kept per interval, evenly spread so both wide and
// tall sub-compositions stay reachable
const MOSAIC_MAX_SET = 40
// Root candidates within this log-aspect distance of the best achievable
// participate in the variant rotation (reroll); the first ranked candidate
// is still preferred from the tighter historical window below.
const MOSAIC_VARIANT_TOL = 0.30
// ...and candidates within this of the best count as "aspect-equivalent"
// for ranking purposes (the historical tie-break window)
const MOSAIC_ASPECT_TIE = 0.08
// Soft cap on leaf-area disparity: compositions whose worst
// over-target/under-target area ratio exceeds this are penalized
// quadratically. Different sizes are fine; strips of thumbnails next to a
// giant leaf are not.
const LOG_AREA_RATIO_CAP = Math.log(9)

const mosaicKey = (a: number) => Math.round(Math.log(a) / MOSAIC_BUCKET)

const variance = (e: MosaicEntry) => e.sl2 / e.c - (e.sl / e.c) ** 2

// Per-entry quality used both to keep the best entry per aspect bucket and
// to rank root candidates: deviation variance plus the disparity-cap excess
const mosaicScore = (e: MosaicEntry) => {
    const excess = e.mx - e.mn - LOG_AREA_RATIO_CAP
    return variance(e) + (excess > 0 ? 4 * excess * excess : 0)
}

// All split points for short intervals; for long ones the endpoints (chain
// layouts need them) plus points near even ratio fractions
function candidateSplits(i: number, j: number, prefix: number[]): number[] {
    if (j - i <= 10) {
        return Array.from({ length: j - i - 1 }, (_, t) => i + 1 + t)
    }
    const ks = new Set<number>([i + 1, j - 1])
    for (const f of [0.2, 1 / 3, 0.5, 2 / 3, 0.8]) {
        const target = prefix[i] + (prefix[j] - prefix[i]) * f
        let best = i + 1
        for (let k = i + 1; k < j; k++) {
            if (Math.abs(prefix[k] - target) < Math.abs(prefix[best] - target)) best = k
        }
        ks.add(best)
    }
    return [...ks].sort((x, y) => x - y)
}

// Build the interval DP: sets[i][j] maps aspect bucket -> best entry for
// items[i..j). targetLogs[i] is log of item i's normalized target area
// share (uniform: log(1/n)); minAreaLogs[i] is log of the minimum pixel
// area leaf i needs to satisfy the minimum size at its own aspect.
function buildMosaicSets(
    items: PackItem[],
    targetLogs: number[],
    minAreaLogs: number[],
): Map<number, MosaicEntry>[][] {
    const n = items.length
    const prefix = [0]
    for (const it of items) prefix.push(prefix[prefix.length - 1] + ratio(it))
    const sets: Map<number, MosaicEntry>[][] = Array.from({ length: n + 1 }, () =>
        Array.from({ length: n + 1 }, () => new Map())
    )
    // Compose two subtrees; fl/fr are the children's shares of the parent
    // area (side by side: proportional to aspect; stacked: inverse)
    const compose = (left: MosaicEntry, right: MosaicEntry, a: number, k: number, dir: 0 | 1, lb: number, rb: number): MosaicEntry => {
        const fl = dir === 0 ? left.a / (left.a + right.a) : right.a / (left.a + right.a)
        const lfl = Math.log(fl)
        const lfr = Math.log(1 - fl)
        return {
            a, k, dir, lb, rb,
            c: left.c + right.c,
            sl: left.sl + left.c * lfl + right.sl + right.c * lfr,
            sl2: left.sl2 + 2 * lfl * left.sl + left.c * lfl * lfl
                + right.sl2 + 2 * lfr * right.sl + right.c * lfr * lfr,
            mn: Math.min(left.mn + lfl, right.mn + lfr),
            mx: Math.max(left.mx + lfl, right.mx + lfr),
            fs: Math.min(left.fs + lfl, right.fs + lfr),
        }
    }
    for (let i = 0; i < n; i++) {
        const a = ratio(items[i])
        // Leaf deviation value: its (whole-subtree) share of 1 against its
        // target share
        const v = -targetLogs[i]
        sets[i][i + 1].set(mosaicKey(a), {
            a, k: -1, dir: 0, lb: 0, rb: 0,
            c: 1, sl: v, sl2: v * v, mn: v, mx: v, fs: -minAreaLogs[i],
        })
    }
    for (let len = 2; len <= n; len++) {
        for (let i = 0; i + len <= n; i++) {
            const j = i + len
            const out = sets[i][j]
            const offer = (e: MosaicEntry) => {
                const bk = mosaicKey(e.a)
                const cur = out.get(bk)
                if (!cur || mosaicScore(e) < mosaicScore(cur)) out.set(bk, e)
            }
            for (const k of candidateSplits(i, j, prefix)) {
                for (const [lb, left] of sets[i][k]) {
                    for (const [rb, right] of sets[k][j]) {
                        const side = left.a + right.a
                        const stack = (left.a * right.a) / (left.a + right.a)
                        offer(compose(left, right, side, k, 0, lb, rb))
                        offer(compose(left, right, stack, k, 1, lb, rb))
                    }
                }
            }
            if (out.size > MOSAIC_MAX_SET) {
                const keys = [...out.keys()].sort((x, y) => x - y)
                const keep = new Set<number>()
                for (let t = 0; t < MOSAIC_MAX_SET; t++) {
                    keep.add(keys[Math.round((t * (keys.length - 1)) / (MOSAIC_MAX_SET - 1))])
                }
                for (const kk of keys) if (!keep.has(kk)) out.delete(kk)
            }
        }
    }
    return sets
}

// Normalized per-item target shares from raw weights (uniform when absent),
// as logs, for buildMosaicSets
function targetLogsFrom(n: number, weights?: number[]): number[] {
    if (!weights || weights.length !== n) {
        return new Array<number>(n).fill(Math.log(1 / n))
    }
    const floor = Math.max(1e-6, ...weights) * 1e-4
    const clean = weights.map(w => Math.max(floor, w))
    const sum = clean.reduce((acc, v) => acc + v, 0)
    return clean.map(w => Math.log(w / sum))
}

// Log of the minimum pixel area each item needs so that both its width and
// height clear the minimum at the item's own aspect
function minAreaLogsFrom(
    items: PackItem[],
    mins: { minW: number; minH: number },
    grid: GridParams,
    columnWidth: number,
): number[] {
    const wMinPx = pixelWidth(mins.minW, columnWidth, grid.margin)
    const hMinPx = mins.minH * rowStep(grid) - grid.margin
    return items.map(it => {
        const a = ratio(it)
        return Math.log(Math.max((wMinPx * wMinPx) / a, hMinPx * hMinPx * a))
    })
}

// Materialize the DP entry for items[i..j) at bucket bk into a plain tree
function resolveNode(
    sets: Map<number, MosaicEntry>[][],
    items: PackItem[],
    i: number,
    j: number,
    bk: number,
): MosaicNode {
    const e = sets[i][j].get(bk)!
    if (e.k === -1) return { a: e.a, key: items[i].key, dir: 0, left: null, right: null }
    return {
        a: e.a, key: null, dir: e.dir,
        left: resolveNode(sets, items, i, e.k, e.lb),
        right: resolveNode(sets, items, e.k, j, e.rb),
    }
}

// Render a composition tree into a box of grid cells.
function emitTree(
    layout: LayoutItem[],
    node: MosaicNode,
    x: number, y: number, w: number, h: number,
    grid: GridParams,
    columnWidth: number,
    mins: { minW: number; minH: number },
) {
    if (node.key !== null) {
        layout.push({ i: node.key, x, y, w, h })
        return
    }
    const left = node.left!
    const right = node.right!
    // A box that can't give both children the minimum in the tree's
    // direction degrades to the other direction when that one can;
    // failing both, it keeps the tree's direction with the historical
    // 1-cell floors — the best-effort residue of the escape hatch
    // (relaxMinimums keeps boxes this tight rare). A box too thin to
    // split AT ALL in the tree's direction always degrades, as before,
    // rather than emitting zero-sized children.
    const sideOk = w >= 2 * mins.minW
    const stackOk = h >= 2 * mins.minH
    let dir = node.dir
    if (dir === 0 && !sideOk && stackOk) dir = 1
    else if (dir === 1 && !stackOk && sideOk) dir = 0
    if (dir === 0 && w < 2) dir = 1
    else if (dir === 1 && h < 2) dir = 0
    // Split positions are computed in pixels and then snapped to the
    // lattice: a box spanning w cells is w*(unit) - margin pixels wide
    // and the split consumes one margin, so apportioning cell counts
    // directly would drift by a margin's worth per level of nesting —
    // enough to visibly distort small leaves in deep trees.
    if (dir === 0) {
        const lo = sideOk ? mins.minW : 1
        const unit = columnWidth + grid.margin
        const boxPx = w * unit - grid.margin
        const leftPx = (boxPx - grid.margin) * (left.a / (left.a + right.a))
        const wl = Math.min(w - lo, Math.max(lo, Math.round((leftPx + grid.margin) / unit)))
        emitTree(layout, left, x, y, wl, h, grid, columnWidth, mins)
        emitTree(layout, right, x + wl, y, w - wl, h, grid, columnWidth, mins)
    } else {
        const lo = stackOk ? mins.minH : 1
        const unit = rowStep(grid)
        const boxPx = h * unit - grid.margin
        // Stacked: heights inversely proportional to aspects
        const topPx = (boxPx - grid.margin) * (right.a / (left.a + right.a))
        const hl = Math.min(h - lo, Math.max(lo, Math.round((topPx + grid.margin) / unit)))
        emitTree(layout, left, x, y, w, hl, grid, columnWidth, mins)
        emitTree(layout, right, x, y + hl, w, h - hl, grid, columnWidth, mins)
    }
}

// Root candidates for a target aspect, ranked: feasible (every leaf clears
// the minimum size in a box of boxAreaPx) before infeasible, then
// aspect-equivalent-to-best before merely close, then by quality score.
// The variant index (reroll) rotates through this list — every entry is a
// genuinely different composition (distinct composed aspect bucket).
function rankRootCandidates(
    roots: Map<number, MosaicEntry>,
    targetA: number,
    boxAreaPx: number,
): { bk: number; e: MosaicEntry; d: number }[] {
    const boxAreaLog = Math.log(boxAreaPx)
    const cands = [...roots.entries()].map(([bk, e]) => ({
        bk, e,
        d: Math.abs(Math.log(e.a / targetA)),
        infeasible: e.fs + boxAreaLog < 0 ? 1 : 0,
    }))
    if (cands.length === 0) return []
    let best = Infinity
    for (const c of cands) best = Math.min(best, c.d)
    const pool = cands.filter(c => c.d <= best + MOSAIC_VARIANT_TOL)
    pool.sort((x, y) =>
        x.infeasible - y.infeasible
        || (x.d <= best + MOSAIC_ASPECT_TIE ? 0 : 1) - (y.d <= best + MOSAIC_ASPECT_TIE ? 0 : 1)
        || mosaicScore(x.e) - mosaicScore(y.e)
        || x.d - y.d
    )
    return pool
}

export function packMosaic({
    items,
    grid,
    columnWidth,
    totalGridRows,
    // "force": always span the full target rectangle (the wall against a
    // cutting board below the fold). "auto": fill when the best composition
    // is within ~35% of the viewport aspect, otherwise render it undistorted
    // and leave the viewport partially empty.
    fill,
    minW = 1,
    minH = 1,
    variant = 0,
    weights,
}: {
    items: PackItem[],
    grid: GridParams,
    columnWidth: number,
    totalGridRows: number,
    fill: "force" | "auto",
    // Minimum leaf size in grid units; relaxed (see relaxMinimums) when the
    // board can't give every item that much, and best-effort within a split
    // whose box is too thin in both directions
    minW?: number,
    minH?: number,
    // Reroll index: rotates through the ranked near-best compositions, so
    // repeated invocations cycle genuinely distinct layouts
    variant?: number,
    // Optional per-item target area weights (parallel to items). The packer
    // aims each leaf at its normalized share instead of uniform — this is
    // how "keep the current proportions" reflow expresses importance.
    weights?: number[],
}): LayoutItem[] {
    const n = items.length
    if (n === 0) return []
    if (n > MOSAIC_MAX_ITEMS) {
        return packRows({ items, grid, columnWidth, totalGridRows, rowCount: "auto", forceFill: fill === "force", minW, minH })
    }
    const step = rowStep(grid)
    const total = Math.max(1, totalGridRows)
    const mins = relaxMinimums(n, grid.columns, total, minW, minH)
    const widthPx = pixelWidth(grid.columns, columnWidth, grid.margin)
    const heightPx = total * step - grid.margin
    const targetA = widthPx / heightPx

    const sets = buildMosaicSets(
        items,
        targetLogsFrom(n, weights),
        minAreaLogsFrom(items, mins, grid, columnWidth),
    )
    const ranked = rankRootCandidates(sets[0][n], targetA, widthPx * heightPx)
    if (ranked.length === 0) return []
    const chosen = ranked[((variant % ranked.length) + ranked.length) % ranked.length]
    const root = chosen.e

    // Target box in grid cells: stretch onto the full rectangle when forced
    // or close enough; otherwise keep the composition's own aspect (full
    // width and shorter, or full height and narrower, centered)
    let box = { x: 0, y: 0, w: grid.columns, h: total }
    if (fill !== "force" && chosen.d > Math.log(1.35)) {
        // The relaxed minimums also floor the undistorted box, so a lone
        // item (or a thin composition) can't come out below minimum size
        if (root.a >= targetA) {
            const hPx = widthPx / root.a
            box.h = Math.max(mins.minH, Math.min(total, Math.round((hPx + grid.margin) / step)))
        } else {
            const wPx = heightPx * root.a
            const w = Math.max(mins.minW, Math.min(grid.columns,
                Math.round((wPx + grid.margin) / (columnWidth + grid.margin))))
            box = { x: Math.floor((grid.columns - w) / 2), y: 0, w, h: total }
        }
    }

    const layout: LayoutItem[] = []
    const rootNode = resolveNode(sets, items, 0, n, chosen.bk)
    emitTree(layout, rootNode, box.x, box.y, box.w, box.h, grid, columnWidth, mins)
    return layout
}

// Pack into an arbitrary sub-rectangle of the grid: the packer runs on a
// virtual grid as wide as the box and the result is translated into place.
// Columns are uniform across the grid, so the virtual grid's pixel geometry
// matches the real sub-rectangle exactly. Used by "arrange selection within
// its bounding box" and the region engine's fallbacks.
export function packMosaicInBox({
    items,
    grid,
    columnWidth,
    box,
    minW = 1,
    minH = 1,
    variant = 0,
    weights,
}: {
    items: PackItem[],
    grid: GridParams,
    columnWidth: number,
    box: { x: number; y: number; w: number; h: number },
    minW?: number,
    minH?: number,
    variant?: number,
    weights?: number[],
}): LayoutItem[] {
    const virtual: GridParams = { ...grid, columns: Math.max(1, box.w) }
    const packed = packMosaic({
        items, grid: virtual, columnWidth,
        totalGridRows: Math.max(1, box.h),
        fill: "force", minW, minH, variant, weights,
    })
    return packed.map(l => ({ ...l, x: l.x + box.x, y: l.y + box.y }))
}

// Region packing in an arbitrary sub-rectangle of the grid — the same
// virtual-grid trick as packMosaicInBox. Obstacles are given in BOARD
// coordinates; they are translated into the box's frame and packRegion
// clips them to it (an obstacle poking partway into the box blocks
// exactly the overlap). With no obstacle overlapping the box this
// degrades to packMosaicInBox via packRegion's own fallback. Used by
// "arrange selection within its bounding box", where locked items inside
// the box must be packed around, not painted over.
export function packRegionInBox({
    items,
    obstacles,
    grid,
    columnWidth,
    box,
    minW = 1,
    minH = 1,
    variant = 0,
    weights,
}: {
    items: PackItem[],
    obstacles: GridRect[],
    grid: GridParams,
    columnWidth: number,
    box: { x: number; y: number; w: number; h: number },
    minW?: number,
    minH?: number,
    variant?: number,
    weights?: number[],
}): LayoutItem[] {
    const virtual: GridParams = { ...grid, columns: Math.max(1, box.w) }
    const packed = packRegion({
        items,
        obstacles: obstacles.map(o => ({ ...o, x: o.x - box.x, y: o.y - box.y })),
        grid: virtual,
        columnWidth,
        totalGridRows: Math.max(1, box.h),
        minW, minH, variant, weights,
    })
    return packed.map(l => ({ ...l, x: l.x + box.x, y: l.y + box.y }))
}

// ---------------------------------------------------------------------------
// Eviction: clear unselected movable items out of an arrange box.

// "Arrange selection" claims its bounding box for the selected items, so
// unlocked non-selected items inside the box must get out of the way — but
// only via LOCAL, predictable moves; anything that can't leave cheaply
// stays put and is flowed around like an anchor. The moves, chosen by which
// box edges an intruder straddles:
//  - one side only: slide out sideways (at most by its overlap with the
//    box, so the vacated cells are all inside the box and the pack refills
//    them — no hole opens outside), shrinking away whatever the free space
//    can't absorb; below minW it stays as an obstacle instead.
//  - corner peekers first try a full sideways slide (no shrink — that
//    would vacate out-of-box cells, a real hole); if it doesn't fit, they
//    escalate to their vertical edge's move below.
//  - crosses the bottom: drop straight down below the box (past anchored
//    items, pushing whatever it lands on down the same way). The board is
//    open-ended downward, so this move always succeeds.
//  - crosses the top (not the bottom): raise its bottom edge to the box
//    top; below minH it stays as an obstacle. Never dropped: teleporting
//    an item from above the box to below it is exactly the unpredictable
//    far move this pass exists to avoid.
//  - fully interior (or spanning both sides): no edge to leave through
//    cheaply — obstacle.
//  Corner slides and shrinks do vacate the intruder's small out-of-box
//  overhang — a hole right beside the move that up-only compaction fills
//  locally.
// Everything is computed against a working copy so evictees can't collide
// with each other; a drop cascade may push a later intruder clear of the
// box before its turn, in which case it needs no move of its own.
// Returns the updated non-participant layout plus the rects of the
// intruders that stayed put, for the packer's obstacle list.
export function evictFromBox({
    layout,
    box,
    participantKeys,
    sizeLockedKeys,
    anchoredKeys,
    columns,
    minW = 1,
    minH = 1,
}: {
    layout: LayoutItem[],
    box: GridRect,
    // Selected items being re-packed into the box: excluded from the
    // working set (the pack replaces them, all inside the box)
    participantKeys: Set<string>,
    // Size locks: evictable, but only by whole moves — slide fully clear
    // or drop below; the shrink escapes are off the table, so a rigid
    // intruder that can't move cheaply stays put as an obstacle
    sizeLockedKeys: Set<string>,
    // Position locks: never evicted, immovable even for the drop cascade
    anchoredKeys: Set<string>,
    columns: number,
    minW?: number,
    minH?: number,
}): { rest: LayoutItem[], extraObstacles: GridRect[] } {
    const overlaps = (a: GridRect, b: GridRect) =>
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    const inBox = (l: GridRect) => overlaps(l, box)
    const rest = layout.filter(l => !participantKeys.has(l.i)).map(l => ({ ...l }))
    const extraObstacles: GridRect[] = []
    const asRect = (l: LayoutItem): GridRect => ({ x: l.x, y: l.y, w: l.w, h: l.h })

    // Free horizontal run beside an item, over its own rows, bounded by the
    // nearest blocker in the working set (or the board edge)
    const gapLeft = (l: LayoutItem) => {
        let edge = 0
        for (const o of rest) {
            if (o.i === l.i) continue
            if (o.y < l.y + l.h && l.y < o.y + o.h && o.x + o.w <= l.x) {
                edge = Math.max(edge, o.x + o.w)
            }
        }
        return l.x - edge
    }
    const gapRight = (l: LayoutItem) => {
        let edge = columns
        for (const o of rest) {
            if (o.i === l.i) continue
            if (o.y < l.y + l.h && l.y < o.y + o.h && o.x >= l.x + l.w) {
                edge = Math.min(edge, o.x)
            }
        }
        return edge - (l.x + l.w)
    }

    // Straight-down drop to the first row >= minY clear of anchored items,
    // then push whatever movable items it now overlaps down the same way.
    // Every move only increases y, so the cascade terminates.
    const dropTo = (l: LayoutItem, minY: number) => {
        let y = Math.max(l.y, minY)
        for (; ;) {
            const anchor = rest.find(o =>
                o.i !== l.i && anchoredKeys.has(o.i) && overlaps({ ...asRect(l), y }, asRect(o)))
            if (!anchor) break
            y = anchor.y + anchor.h
        }
        l.y = y
        for (const o of rest) {
            if (o.i === l.i || anchoredKeys.has(o.i)) continue
            if (overlaps(asRect(l), asRect(o))) dropTo(o, l.y + l.h)
        }
    }

    const intruders = rest
        .filter(l => !anchoredKeys.has(l.i) && inBox(asRect(l)))
        .sort((a, b) => a.y - b.y || a.x - b.x)
    for (const l of intruders) {
        // A previous intruder's drop cascade may have already pushed this
        // one clear of the box
        if (!inBox(asRect(l))) continue
        const rigid = sizeLockedKeys.has(l.i)
        const left = l.x < box.x
        const right = l.x + l.w > box.x + box.w
        const top = l.y < box.y
        const bottom = l.y + l.h > box.y + box.h
        const oneSide = left !== right
        const peek = left ? l.x + l.w - box.x : box.x + box.w - l.x
        if (oneSide && !top && !bottom && !rigid) {
            // Pure side peeker: slide out as far as free space allows and
            // shrink away the remainder (its edge lands on the box edge)
            const shift = Math.min(peek, left ? gapLeft(l) : gapRight(l))
            const shrink = peek - shift
            if (l.w - shrink < minW) {
                extraObstacles.push(asRect(l))
                continue
            }
            l.w -= shrink
            l.x = left ? box.x - l.w : box.x + box.w
        } else if (oneSide && (left ? gapLeft(l) : gapRight(l)) >= peek) {
            // Corner peeker with room (or a rigid side peeker): slide fully
            // out, no shrink (a shrink here would vacate out-of-box cells —
            // a real hole; a rigid item can't shrink at all)
            l.x += left ? -peek : peek
        } else if (bottom) {
            // Bottom peeker, or a stuck bottom corner: drop below the box
            // (a whole move, available to rigid intruders too)
            dropTo(l, box.y + box.h)
        } else if (top && !rigid && box.y - l.y >= minH) {
            // Top peeker, or a stuck top corner: bottom edge up to the box
            // top — never dropped across the box like a bottom peeker
            l.h = box.y - l.y
        } else {
            // Fully interior, spanning both sides, a top peeker too short
            // to shrink, or a rigid one that can't slide clear: nowhere to
            // go without a disruptive move — stays put as an obstacle
            extraObstacles.push(asRect(l))
        }
    }
    return { rest, extraObstacles }
}

// ---------------------------------------------------------------------------
// Structure recovery: rebuild a guillotine tree from an existing arrangement
// so "grow to fill" can re-solve sizes without rearranging anything.

export interface ArrangedItem extends PackItem {
    x: number
    y: number
    w: number
    h: number
}

// Recover a composition tree from the current arrangement: recursively find
// a full-span cut line no item straddles and split there. Leaves carry the
// items' CONTENT aspects (not their current cell aspects), so re-emitting
// the tree sizes everything to its content while every item keeps its
// neighbors. Gaps in the arrangement simply close on re-emit — that's the
// "grow" part. Returns null when the arrangement doesn't decompose (a
// non-guillotine weave like a pinwheel).
export function recoverTree(items: ArrangedItem[]): MosaicNode | null {
    if (items.length === 0) return null
    if (items.length === 1) {
        return { a: ratio(items[0]), key: items[0].key, dir: 0, left: null, right: null }
    }
    const x0 = Math.min(...items.map(it => it.x))
    const x1 = Math.max(...items.map(it => it.x + it.w))
    const y0 = Math.min(...items.map(it => it.y))
    const y1 = Math.max(...items.map(it => it.y + it.h))
    // Candidate cuts are item edges strictly inside the bounding box. The
    // valid cut closest to the box centre (normalized per axis) wins: the
    // most balanced tree accumulates the least rounding drift on re-emit.
    let best: { dir: 0 | 1; at: number; dist: number } | null = null
    const consider = (dir: 0 | 1, at: number, lo: number, hi: number) => {
        if (at <= lo || at >= hi) return
        for (const it of items) {
            const s = dir === 0 ? it.x : it.y
            const e = s + (dir === 0 ? it.w : it.h)
            if (s < at && at < e) return
        }
        const dist = Math.abs((at - lo) / (hi - lo) - 0.5)
        if (!best || dist < best.dist) best = { dir, at, dist }
    }
    for (const it of items) {
        consider(0, it.x, x0, x1)
        consider(0, it.x + it.w, x0, x1)
        consider(1, it.y, y0, y1)
        consider(1, it.y + it.h, y0, y1)
    }
    if (!best) return null
    const { dir, at } = best as { dir: 0 | 1; at: number }
    const first = items.filter(it => (dir === 0 ? it.x + it.w : it.y + it.h) <= at)
    const second = items.filter(it => (dir === 0 ? it.x : it.y) >= at)
    if (first.length + second.length !== items.length) return null
    const left = recoverTree(first)
    const right = recoverTree(second)
    if (!left || !right) return null
    const a = dir === 0 ? left.a + right.a : (left.a * right.a) / (left.a + right.a)
    return { a, key: null, dir, left, right }
}

// Last-resort structure for arrangements that don't decompose exactly: the
// y-overlap row groups (the same grouping the sort/shift actions use)
// stacked top to bottom, each row recovered properly where it decomposes
// (e.g. a stacked pair inside the row) and chained side by side in x-order
// where it doesn't. Rows and in-row order survive, which is the contract
// "grow" makes; only weird in-row weaves get straightened. This exists
// because a board whose items were shrunk in place compacts upward
// unevenly, and one non-guillotine pocket anywhere would otherwise fail
// the whole recovery.
function rowStackTree(items: ArrangedItem[]): MosaicNode | null {
    if (items.length === 0) return null
    const sorted = [...items].sort((a, b) => a.y - b.y)
    const groups: ArrangedItem[][] = []
    let idx = 0
    while (idx < sorted.length) {
        const seed = sorted[idx]
        const centerY = seed.y + Math.floor(seed.h / 2)
        const row: ArrangedItem[] = []
        let i = idx
        for (; i < sorted.length; i++) {
            if (sorted[i].y > centerY) break
            row.push(sorted[i])
        }
        idx = i
        row.sort((a, b) => a.x - b.x)
        groups.push(row)
    }
    const leaf = (it: ArrangedItem): MosaicNode =>
        ({ a: ratio(it), key: it.key, dir: 0, left: null, right: null })
    const side = (l: MosaicNode, r: MosaicNode): MosaicNode =>
        ({ a: l.a + r.a, key: null, dir: 0, left: l, right: r })
    const stack = (t: MosaicNode, b: MosaicNode): MosaicNode =>
        ({ a: (t.a * b.a) / (t.a + b.a), key: null, dir: 1, left: t, right: b })
    const rowTrees = groups.map(g => recoverTree(g) ?? g.map(leaf).reduce(side))
    return rowTrees.reduce(stack)
}

// Re-solve sizes only: recover the guillotine structure of the current
// arrangement and re-render it onto the full-width target rectangle.
// Items keep their neighbors and relative positions; only sizes change.
// The emitter partitions the target height exactly, so the result always
// spans totalGridRows — growing must never come up short of the viewport
// (the row-stack fallback guarantees a tree even for arrangements that
// don't decompose).
export function growToFill({
    items,
    grid,
    columnWidth,
    totalGridRows,
    minW = 1,
    minH = 1,
}: {
    items: ArrangedItem[],
    grid: GridParams,
    columnWidth: number,
    totalGridRows: number,
    minW?: number,
    minH?: number,
}): LayoutItem[] {
    const tree = recoverTree(items) ?? rowStackTree(items)
    if (!tree) return []
    const total = Math.max(1, totalGridRows)
    const mins = relaxMinimums(items.length, grid.columns, total, minW, minH)
    const layout: LayoutItem[] = []
    emitTree(layout, tree, 0, 0, grid.columns, total, grid, columnWidth, mins)
    return layout
}

// growToFill in an arbitrary sub-rectangle of the grid — the same
// virtual-grid trick as packMosaicInBox. The items' current positions are
// translated into the box's frame so structure recovery sees the real
// arrangement, and the re-solved sizes span the box exactly. Used by
// "grow selection": the box is the selection's bounding box expanded into
// the empty space around it.
export function growToFillInBox({
    items,
    grid,
    columnWidth,
    box,
    minW = 1,
    minH = 1,
}: {
    items: ArrangedItem[],
    grid: GridParams,
    columnWidth: number,
    box: GridRect,
    minW?: number,
    minH?: number,
}): LayoutItem[] {
    const virtual: GridParams = { ...grid, columns: Math.max(1, box.w) }
    const packed = growToFill({
        items: items.map(it => ({ ...it, x: it.x - box.x, y: it.y - box.y })),
        grid: virtual, columnWidth,
        totalGridRows: Math.max(1, box.h),
        minW, minH,
    })
    return packed.map(l => ({ ...l, x: l.x + box.x, y: l.y + box.y }))
}

// ---------------------------------------------------------------------------
// Region packing: fill the target rectangle AROUND fixed obstacles
// (anchored items). The free space is decomposed into rectangles — all
// reasonable guillotine decompositions are enumerated, since which cut is
// best (extend an anchor's bottom edge or its side edge?) depends on the
// content — and one
// shared interval DP over the item sequence scores every candidate: an
// outer DP assigns contiguous reading-order runs to the regions,
// minimizing aspect mismatch plus board-wide deviation from the target
// area shares. The jointly best (decomposition, allocation, trees) wins.

export interface GridRect { x: number; y: number; w: number; h: number }

const rectKey = (r: GridRect) => `${r.x},${r.y},${r.w},${r.h}`
const rectsIntersect = (a: GridRect, b: GridRect) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

// Decompositions kept per sub-rectangle during enumeration; also the cap on
// how many full candidates the allocation DP scores
const REGION_PER_RECT_CAP = 6
// Aspect mismatch stretches every item in the region, so it is weighted
// per item and above the size-deviation terms
const REGION_ASPECT_WEIGHT = 4
// A region whose composition would push some leaf below the minimum size
const INFEASIBLE_REGION_PENALTY = 1000
// Leaving a region empty is allowed but worse than any reasonable fill —
// a hole invites the vertical compactor to pull items below it up into it.
// Kept below the infeasible penalty so a sliver region prefers staying
// empty over hosting a micro-item.
const EMPTY_REGION_PENALTY = 600

// Merge free rects sharing a full edge: two stacked full-width bands are
// one region, and fatter regions compose better
function mergeAdjacent(rects: GridRect[]): GridRect[] {
    const out = [...rects]
    let merged = true
    while (merged) {
        merged = false
        outer: for (let i = 0; i < out.length; i++) {
            for (let j = i + 1; j < out.length; j++) {
                const a = out[i], b = out[j]
                if (a.x === b.x && a.w === b.w && (a.y + a.h === b.y || b.y + b.h === a.y)) {
                    out[i] = { x: a.x, y: Math.min(a.y, b.y), w: a.w, h: a.h + b.h }
                    out.splice(j, 1)
                    merged = true
                    break outer
                }
                if (a.y === b.y && a.h === b.h && (a.x + a.w === b.x || b.x + b.w === a.x)) {
                    out[i] = { x: Math.min(a.x, b.x), y: a.y, w: a.w + b.w, h: a.h }
                    out.splice(j, 1)
                    merged = true
                    break outer
                }
            }
        }
    }
    return out
}

// All (capped, deduped) rectangle decompositions of rect minus obstacles.
// Cuts extend the edges of the topmost-leftmost obstacle; each choice
// recurses on both halves and the cross products are merged and deduped.
// Merging across cuts means the results aren't limited to strict guillotine
// partitions — adjacent pieces reunite into fat rectangles wherever the
// geometry allows.
function enumerateFreeRegions(rect: GridRect, obstacles: GridRect[]): GridRect[][] {
    const memo = new Map<string, GridRect[][]>()
    const recurse = (r: GridRect): GridRect[][] => {
        if (r.w <= 0 || r.h <= 0) return [[]]
        const key = rectKey(r)
        const hit = memo.get(key)
        if (hit) return hit
        const obs = obstacles.filter(o => rectsIntersect(o, r))
        if (obs.length === 0) {
            const out = [[r]]
            memo.set(key, out)
            return out
        }
        let o = obs[0]
        for (const c of obs) if (c.y < o.y || (c.y === o.y && c.x < o.x)) o = c
        const cuts: { dir: 0 | 1; at: number }[] = []
        if (o.x > r.x) cuts.push({ dir: 0, at: o.x })
        if (o.x + o.w < r.x + r.w) cuts.push({ dir: 0, at: o.x + o.w })
        if (o.y > r.y) cuts.push({ dir: 1, at: o.y })
        if (o.y + o.h < r.y + r.h) cuts.push({ dir: 1, at: o.y + o.h })
        if (cuts.length === 0) {
            // The obstacle covers this rect entirely
            const out: GridRect[][] = [[]]
            memo.set(key, out)
            return out
        }
        const seen = new Set<string>()
        const results: GridRect[][] = []
        for (const cut of cuts) {
            const [r1, r2] = cut.dir === 0
                ? [{ ...r, w: cut.at - r.x }, { ...r, x: cut.at, w: r.x + r.w - cut.at }]
                : [{ ...r, h: cut.at - r.y }, { ...r, y: cut.at, h: r.y + r.h - cut.at }]
            for (const d1 of recurse(r1)) {
                for (const d2 of recurse(r2)) {
                    const combined = mergeAdjacent([...d1, ...d2])
                    const ck = combined.map(rectKey).sort().join(";")
                    if (seen.has(ck)) continue
                    seen.add(ck)
                    results.push(combined)
                }
            }
        }
        // Fewer, fatter regions first; the cap keeps the cross products and
        // the downstream allocation DPs bounded
        results.sort((a, b) => a.length - b.length)
        const out = results.slice(0, REGION_PER_RECT_CAP)
        memo.set(key, out)
        return out
    }
    return recurse(rect)
}

// Pack `items` (in reading order) into the target rectangle around fixed
// obstacles. Returns [] when nothing can be packed (no free space, or no
// feasible allocation), so callers keep the existing layout.
export function packRegion({
    items,
    obstacles,
    grid,
    columnWidth,
    totalGridRows,
    minW = 1,
    minH = 1,
    variant = 0,
    weights,
}: {
    items: PackItem[],
    obstacles: GridRect[],
    grid: GridParams,
    columnWidth: number,
    totalGridRows: number,
    minW?: number,
    minH?: number,
    variant?: number,
    weights?: number[],
}): LayoutItem[] {
    const n = items.length
    if (n === 0) return []
    const total = Math.max(1, totalGridRows)
    // Clip obstacles to the target rectangle: the part of an anchored item
    // hanging below the fold doesn't shape the region being packed
    const clipped: GridRect[] = []
    for (const o of obstacles) {
        const x = Math.max(0, o.x)
        const y = Math.max(0, o.y)
        const w = Math.min(grid.columns, o.x + o.w) - x
        const h = Math.min(total, o.y + o.h) - y
        if (w > 0 && h > 0) clipped.push({ x, y, w, h })
    }
    if (clipped.length === 0) {
        return packMosaic({ items, grid, columnWidth, totalGridRows: total, fill: "force", minW, minH, variant, weights })
    }
    if (n > MOSAIC_MAX_ITEMS) {
        return packRowsAroundObstacles({ items, obstacles: clipped, grid, columnWidth, total, minW, minH })
    }
    const candidates = enumerateFreeRegions({ x: 0, y: 0, w: grid.columns, h: total }, clipped)
        .filter(c => c.length > 0)
    if (candidates.length === 0) return []
    // Every candidate covers the same free cells, so the relaxation target
    // (expressed as an equivalent full-width rectangle) is shared
    const freeCells = candidates[0].reduce((acc, r) => acc + r.w * r.h, 0)
    const mins = relaxMinimums(n, grid.columns, Math.max(1, Math.floor(freeCells / grid.columns)), minW, minH)
    const sets = buildMosaicSets(
        items,
        targetLogsFrom(n, weights),
        minAreaLogsFrom(items, mins, grid, columnWidth),
    )

    const unitX = columnWidth + grid.margin
    const unitY = rowStep(grid)
    const pxW = (r: GridRect) => r.w * unitX - grid.margin
    const pxH = (r: GridRect) => r.h * unitY - grid.margin

    interface Plan {
        cost: number
        regions: GridRect[]
        runs: { i: number; j: number; bk: number }[]
    }
    const plans: Plan[] = []
    for (const cand of candidates) {
        const regions = [...cand].sort((r1, r2) => r1.y - r2.y || r1.x - r2.x)
        const R = regions.length
        const totalPx = regions.reduce((acc, r) => acc + pxW(r) * pxH(r), 0)
        // Assign contiguous runs of the reading-order sequence to the
        // regions in region order; dp[r][j] = best cost with the first r
        // regions consuming the first j items
        const dp: number[][] = Array.from({ length: R + 1 }, () => new Array<number>(n + 1).fill(Infinity))
        const fromJ: number[][] = Array.from({ length: R + 1 }, () => new Array<number>(n + 1).fill(-1))
        const fromBk: number[][] = Array.from({ length: R + 1 }, () => new Array<number>(n + 1).fill(0))
        dp[0][0] = 0
        for (let r = 0; r < R; r++) {
            const region = regions[r]
            const areaPx = pxW(region) * pxH(region)
            const aR = pxW(region) / pxH(region)
            // Shifting a subtree's unit-area statistics onto this region's
            // true share of the free area is a closed-form translation, so
            // the size-deviation term is BOARD-WIDE, not per-region: cramming
            // many items into a small region scores exactly as badly as it
            // looks
            const u = Math.log(areaPx / totalPx)
            const feasLog = Math.log(areaPx)
            for (let i = 0; i <= n; i++) {
                if (dp[r][i] === Infinity) continue
                if (dp[r][i] + EMPTY_REGION_PENALTY < dp[r + 1][i]) {
                    dp[r + 1][i] = dp[r][i] + EMPTY_REGION_PENALTY
                    fromJ[r + 1][i] = i
                }
                for (let j = i + 1; j <= n; j++) {
                    let bestCost = Infinity
                    let bestBk = 0
                    for (const [bk, e] of sets[i][j]) {
                        const dev = Math.log(e.a / aR)
                        let cost = REGION_ASPECT_WEIGHT * e.c * dev * dev
                            + (e.sl2 + 2 * u * e.sl + e.c * u * u)
                        if (e.fs + feasLog < 0) cost += INFEASIBLE_REGION_PENALTY
                        if (cost < bestCost) { bestCost = cost; bestBk = bk }
                    }
                    if (bestCost === Infinity) continue
                    const c2 = dp[r][i] + bestCost
                    if (c2 < dp[r + 1][j]) {
                        dp[r + 1][j] = c2
                        fromJ[r + 1][j] = i
                        fromBk[r + 1][j] = bestBk
                    }
                }
            }
        }
        if (dp[R][n] === Infinity) continue
        const runs: Plan["runs"] = []
        let j = n
        for (let r = R; r >= 1; r--) {
            const i = fromJ[r][j]
            runs.unshift({ i, j, bk: fromBk[r][j] })
            j = i
        }
        plans.push({ cost: dp[R][n], regions, runs })
    }
    if (plans.length === 0) return []
    plans.sort((a, b) => a.cost - b.cost)
    // Reroll rotates through the decomposition choices first; once those
    // wrap, it rotates the composition of the largest filled region
    const plan = plans[((variant % plans.length) + plans.length) % plans.length]
    const innerVariant = Math.floor(variant / plans.length)
    if (innerVariant > 0) {
        let largest = -1
        let largestArea = -1
        plan.runs.forEach((run, r) => {
            const area = pxW(plan.regions[r]) * pxH(plan.regions[r])
            if (run.j > run.i && area > largestArea) { largest = r; largestArea = area }
        })
        if (largest >= 0) {
            const run = plan.runs[largest]
            const region = plan.regions[largest]
            const ranked = rankRootCandidates(
                sets[run.i][run.j], pxW(region) / pxH(region), largestArea)
            if (ranked.length > 0) run.bk = ranked[innerVariant % ranked.length].bk
        }
    }
    const layout: LayoutItem[] = []
    plan.regions.forEach((region, r) => {
        const { i, j, bk } = plan.runs[r]
        if (j <= i) return // region left empty
        const regionMins = relaxMinimums(j - i, region.w, region.h, minW, minH)
        emitTree(layout, resolveNode(sets, items, i, j, bk),
            region.x, region.y, region.w, region.h, grid, columnWidth, regionMins)
    })
    return layout
}

// Justified rows flowing around the obstacles like text around floats:
// the dense-board fallback of packRegion, and the with-locks variant of
// the explicit row layouts. Horizontal bands between consecutive obstacle
// edges have constant free x-intervals, so each (band x interval) segment
// is a rectangle; items are apportioned to segments by area in reading
// order.
export function packRowsAroundObstacles({
    items,
    obstacles,
    grid,
    columnWidth,
    total,
    minW,
    minH,
}: {
    items: PackItem[],
    obstacles: GridRect[],
    grid: GridParams,
    columnWidth: number,
    total: number,
    minW: number,
    minH: number,
}): LayoutItem[] {
    const edgeSet = new Set<number>([0, total])
    for (const o of obstacles) {
        if (o.y > 0 && o.y < total) edgeSet.add(o.y)
        if (o.y + o.h > 0 && o.y + o.h < total) edgeSet.add(o.y + o.h)
    }
    const edges = [...edgeSet].sort((a, b) => a - b)
    const segments: GridRect[] = []
    for (let b = 0; b + 1 < edges.length; b++) {
        const y0 = edges[b], y1 = edges[b + 1]
        const blockers = obstacles
            .filter(o => o.y < y1 && o.y + o.h > y0)
            .sort((a, c) => a.x - c.x)
        let x = 0
        for (const o of blockers) {
            if (o.x > x) segments.push({ x, y: y0, w: o.x - x, h: y1 - y0 })
            x = Math.max(x, o.x + o.w)
        }
        if (x < grid.columns) segments.push({ x, y: y0, w: grid.columns - x, h: y1 - y0 })
    }
    if (segments.length === 0) return []
    // Apportion items to segments by area, largest remainder, zero allowed
    const areas = segments.map(s => s.w * s.h)
    const sum = areas.reduce((acc, v) => acc + v, 0) || 1
    const ideal = areas.map(a => (a * items.length) / sum)
    const counts = ideal.map(v => Math.floor(v))
    let used = counts.reduce((acc, v) => acc + v, 0)
    const byRem = ideal
        .map((v, i) => ({ i, frac: v - Math.floor(v) }))
        .sort((a, b) => b.frac - a.frac)
    for (let k = 0; used < items.length; k = (k + 1) % byRem.length, used++) {
        counts[byRem[k].i]++
    }
    const layout: LayoutItem[] = []
    let cursor = 0
    segments.forEach((seg, s) => {
        if (counts[s] === 0) return
        const chunk = items.slice(cursor, cursor + counts[s])
        cursor += counts[s]
        const packed = packRows({
            items: chunk,
            grid: { ...grid, columns: seg.w },
            columnWidth,
            totalGridRows: seg.h,
            rowCount: "auto",
            forceFill: true,
            minW, minH,
        })
        for (const l of packed) layout.push({ ...l, x: l.x + seg.x, y: l.y + seg.y })
    })
    return layout
}

// Group items into logical rows by y-overlap: a row is seeded by the
// topmost remaining item and collects every item whose top edge is above
// that item's vertical center. Same grouping the sort/shift actions use.
export function groupRowsByOverlap(layout: LayoutItem[]): LayoutItem[][] {
    const heightSorted = [...layout].sort((a, b) => a.y - b.y)
    const groups: LayoutItem[][] = []
    let startIdx = 0
    while (startIdx < heightSorted.length) {
        const lowestYItem = heightSorted[startIdx]
        const centerY = lowestYItem.y + Math.floor(lowestYItem.h / 2)
        const currentRow: LayoutItem[] = []
        let i = startIdx
        for (; i < heightSorted.length; i++) {
            if (heightSorted[i].y > centerY) break
            currentRow.push(heightSorted[i])
        }
        startIdx = i
        currentRow.sort((a, b) => a.x - b.x)
        groups.push(currentRow)
    }
    return groups
}
