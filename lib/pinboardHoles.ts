// Hole geometry for the pinboard's hole-targeting modes: the Move to Hole
// verb, sticky-carry drops and shift-drag drops. A "hole" is free grid
// space; since free space is rarely rectangular, the targeting UI offers
// its rectangular carve-outs — the maximal empty rectangles — and picks
// the one the cursor most plausibly means.

import { GridRect } from "./pinboardPack"

function buildMask(occupied: GridRect[], columns: number, rows: number): boolean[][] {
    const busy: boolean[][] = Array.from(
        { length: rows }, () => new Array<boolean>(columns).fill(false))
    for (const r of occupied) {
        const x0 = Math.max(0, r.x), x1 = Math.min(columns, r.x + r.w)
        const y0 = Math.max(0, r.y), y1 = Math.min(rows, r.y + r.h)
        for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) busy[y][x] = true
        }
    }
    return busy
}

// All maximal empty rectangles of the free mask over a columns x rows
// board (a free rect not contained in any larger free rect). Every free
// cell is covered by at least one, and every rectangular hole the user
// could mean is a sub-rect of one. Histogram sweep: h[x] counts the
// consecutive free cells ending at the current row; the stack pass emits,
// per row, each rectangle that is maximal in width for its height (blocked
// left, right and above — the popped bar's own column is exactly that
// tall); keeping only those also blocked below leaves exactly the maximal
// set, each emitted once at its own bottom row. O(rows * columns) plus the
// mask fill.
export function maximalFreeRects(
    occupied: GridRect[], columns: number, rows: number,
): GridRect[] {
    if (columns <= 0 || rows <= 0) return []
    const busy = buildMask(occupied, columns, rows)
    const bottomBlocked = (r: GridRect) => {
        const below = r.y + r.h
        if (below >= rows) return true
        for (let x = r.x; x < r.x + r.w; x++) {
            if (busy[below][x]) return true
        }
        return false
    }
    const out: GridRect[] = []
    const h = new Array<number>(columns).fill(0)
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) h[x] = busy[y][x] ? 0 : h[x] + 1
        const stack: { start: number, height: number }[] = []
        for (let x = 0; x <= columns; x++) {
            const cur = x < columns ? h[x] : 0
            let start = x
            while (stack.length && stack[stack.length - 1].height >= cur) {
                const t = stack.pop()!
                // An equal-height pop just merges runs (start widens);
                // emitting it too would duplicate the rect
                if (t.height > cur) {
                    const rect = { x: t.start, y: y - t.height + 1, w: x - t.start, h: t.height }
                    if (bottomBlocked(rect)) out.push(rect)
                }
                start = t.start
            }
            if (cur > 0) stack.push({ start, height: cur })
        }
    }
    return out
}

// The free mask as merged row-run rectangles, for painting the faint
// "these are the holes" tint when a targeting mode is active. Runs with
// identical horizontal extent in consecutive rows merge vertically, so the
// tint is a modest number of boxes rather than one per row.
export function freeRuns(
    occupied: GridRect[], columns: number, rows: number,
): GridRect[] {
    if (columns <= 0 || rows <= 0) return []
    const busy = buildMask(occupied, columns, rows)
    const out: GridRect[] = []
    // Open runs from the previous row, keyed by `${x}:${w}`, still
    // extendable into the current row
    let open = new Map<string, GridRect>()
    for (let y = 0; y < rows; y++) {
        const next = new Map<string, GridRect>()
        for (let x = 0; x < columns;) {
            if (busy[y][x]) { x++; continue }
            const start = x
            while (x < columns && !busy[y][x]) x++
            const key = `${start}:${x - start}`
            const prev = open.get(key)
            if (prev) {
                prev.h += 1
                next.set(key, prev)
                open.delete(key)
            } else {
                const run = { x: start, y, w: x - start, h: 1 }
                out.push(run)
                next.set(key, run)
            }
        }
        open = next
    }
    return out
}

// Which rectangle does a cursor at (px, py) — fractional grid units —
// mean? Among the candidates containing the point, the one where the
// cursor is proportionally most central relative to the rect's OWN
// dimensions (normalized Chebyshev distance to the center). Unlike raw
// closest-center this is scale-invariant: hovering the middle of a fat
// block beats a long sliver crossing it, and sliding toward the sliver's
// axis hands over naturally. Ambiguity only exists where maximal rects
// overlap — exactly where intent is genuinely ambiguous — and the visible
// highlight resolves it before the click commits anything.
export function pickRectAt(
    rects: GridRect[], px: number, py: number,
): GridRect | null {
    let best: GridRect | null = null
    let bestScore = Infinity
    for (const r of rects) {
        if (px < r.x || px >= r.x + r.w || py < r.y || py >= r.y + r.h) continue
        const score = Math.max(
            Math.abs(px - (r.x + r.w / 2)) / (r.w / 2),
            Math.abs(py - (r.y + r.h / 2)) / (r.h / 2),
        )
        if (score < bestScore
            || (score === bestScore && best !== null && r.w * r.h > best.w * best.h)) {
            best = r
            bestScore = score
        }
    }
    return best
}

// Intersection of two rects, or null when they don't overlap — the carve
// gesture clamps its drag box to the candidate it started in.
export function intersectRect(a: GridRect, b: GridRect): GridRect | null {
    const x = Math.max(a.x, b.x)
    const y = Math.max(a.y, b.y)
    const w = Math.min(a.x + a.w, b.x + b.w) - x
    const h = Math.min(a.y + a.h, b.y + b.h) - y
    return w > 0 && h > 0 ? { x, y, w, h } : null
}

export function rectsOverlap(a: GridRect, b: GridRect): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}
