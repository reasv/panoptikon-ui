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

import type ReactGridLayout from "react-grid-layout"
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
// exactly to `total`, each at least 1 (assumes total >= ideal.length)
function apportionToTotal(ideal: number[], total: number): number[] {
    const sum = ideal.reduce((acc, v) => acc + v, 0) || 1
    const scaled = ideal.map(v => (v * total) / sum)
    const counts = scaled.map(v => Math.max(1, Math.floor(v)))
    let used = counts.reduce((acc, v) => acc + v, 0)
    const byRemainder = scaled
        .map((v, i) => ({ i, frac: v - Math.floor(v) }))
        .sort((a, b) => b.frac - a.frac)
    for (let k = 0; used < total; k = (k + 1) % byRemainder.length, used++) {
        counts[byRemainder[k].i]++
    }
    // The 1-minimum can push the total over; take back from the largest
    while (used > total) {
        let largest = -1
        for (let i = 0; i < counts.length; i++) {
            if (counts[i] > 1 && (largest < 0 || counts[i] > counts[largest])) largest = i
        }
        if (largest < 0) break
        counts[largest]--
        used--
    }
    return counts
}

// Column counts for one row at a fixed pixel height: round every item up
// when the row has room (so images reach the shared row height instead of
// sitting narrow-and-letterboxed), otherwise apportion proportionally
// within the width cap
function rowColumnCounts(
    row: PackItem[],
    targetHeightPx: number,
    grid: GridParams,
    columnWidth: number,
): number[] {
    const idealColumns = row.map(it =>
        (ratio(it) * targetHeightPx + grid.margin) / (columnWidth + grid.margin)
    )
    const ceilColumns = idealColumns.map(v => Math.max(1, Math.ceil(v)))
    if (ceilColumns.reduce((acc, v) => acc + v, 0) <= grid.columns) return ceilColumns
    const total = Math.min(grid.columns, Math.max(
        idealColumns.length,
        Math.round(idealColumns.reduce((acc, v) => acc + v, 0)),
    ))
    return apportionToTotal(idealColumns, total)
}

// Append one row's items to the layout, centered when it doesn't span the
// full width; returns the row's grid height for the caller's y cursor
function emitRow(
    layout: ReactGridLayout.Layout[],
    row: PackItem[],
    hGrid: number,
    y: number,
    grid: GridParams,
    columnWidth: number,
) {
    const targetPx = hGrid * rowStep(grid) - grid.margin
    const counts = rowColumnCounts(row, targetPx, grid, columnWidth)
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
            const q = Math.max(1, Math.round((heightPx + margin) / step))
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
        const q = Math.max(1, Math.round((heightPxOf(i, j) + margin) / step))
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
}): ReactGridLayout.Layout[] {
    if (items.length === 0) return []
    const total = Math.max(1, totalGridRows)
    const step = rowStep(grid)
    const maxRows = Math.min(items.length, total)
    let rows: PackItem[][] | null = null
    let heights: number[] | null = null
    if (rowCount === "auto") {
        const byTotal = breakIntoRowsByTotal(items, total, grid, columnWidth)
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
            Math.max(1, Math.round((rowNaturalHeight(row, grid, columnWidth) + grid.margin) / step))
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
        heights = apportionToTotal(heights!, total)
    }
    const layout: ReactGridLayout.Layout[] = []
    let y = 0
    rows.forEach((row, r) => {
        emitRow(layout, row, heights![r], y, grid, columnWidth)
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
}: {
    groups: PackItem[][],
    grid: GridParams,
    columnWidth: number,
}): ReactGridLayout.Layout[] {
    const step = rowStep(grid)
    const layout: ReactGridLayout.Layout[] = []
    let y = 0
    for (const row of groups) {
        if (row.length === 0) continue
        const natural = rowNaturalHeight(row, grid, columnWidth)
        const hGrid = Math.max(1, Math.round((natural + grid.margin) / step))
        emitRow(layout, row, hGrid, y, grid, columnWidth)
        y += hGrid
    }
    return layout
}

// Group items into logical rows by y-overlap: a row is seeded by the
// topmost remaining item and collects every item whose top edge is above
// that item's vertical center. Same grouping the sort/shift actions use.
export function groupRowsByOverlap(layout: ReactGridLayout.Layout[]): ReactGridLayout.Layout[][] {
    const heightSorted = [...layout].sort((a, b) => a.y - b.y)
    const groups: ReactGridLayout.Layout[][] = []
    let startIdx = 0
    while (startIdx < heightSorted.length) {
        const lowestYItem = heightSorted[startIdx]
        const centerY = lowestYItem.y + Math.floor(lowestYItem.h / 2)
        const currentRow: ReactGridLayout.Layout[] = []
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
