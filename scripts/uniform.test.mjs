// Assertions for the uniform packer in lib/pinboardPack.ts: identical-cell
// tiling, factorization scoring, obstacle flow and the sticky cell aspect.
// No test runner in this repo — run it directly from the ui root:
//
//   node --experimental-strip-types scripts/uniform.test.mjs
//
// (the flag is what lets a .mjs import the .ts module; Node 22+). Exits
// non-zero on the first failing assertion set.

import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  nearestUniformIndex,
  packUniform,
  packUniformInBox,
  rankUniformFactorizations,
} = await import("../lib/pinboardPack.ts")
const { V2_GRID, rowStep } = await import("../lib/pinboardGrid.ts")

let all = true
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `\n  ${detail}` : ""}`)
  all &&= !!ok
  return ok
}

const G = V2_GRID // 108 cols, rowHeight 5, margin 5, padding 5
const COL_W = 12 // one column's pixel width on a ~1850px board
const TOTAL = 60 // target grid rows (the fold)
// The realistic minimums a board this size hands the packers
const MINS = { minW: 4, minH: 7 }

const items = (n, aspect = 1) =>
  Array.from({ length: n }, (_, i) => ({
    key: String(i),
    width: aspect,
    height: 1,
  }))

// Row-major reconstruction of a packed layout: distinct y values ascending,
// each row's cells sorted by x
function rowsOf(layout) {
  const byY = new Map()
  for (const l of layout) {
    if (!byY.has(l.y)) byY.set(l.y, [])
    byY.get(l.y).push(l)
  }
  return [...byY.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row.sort((a, b) => a.x - b.x))
}

// The ideal cell pixel aspect of a (cols, rows) factorization, the same
// mapping the packer scores with
const cellAspectOf = (cols, rows, total = TOTAL) =>
  ((G.columns / cols) * (COL_W + G.margin) - G.margin) /
  ((total / rows) * rowStep(G) - G.margin)

// ---- lattice invariants: flush width, exact fold, ±1 cells --------------

{
  const n = 7 // prime, so the last row is ragged whatever the cols
  const layout = packUniform({
    items: items(n), grid: G, columnWidth: COL_W, totalGridRows: TOTAL,
    ...MINS,
  })
  const rows = rowsOf(layout)
  check("every item is placed", layout.length === n)
  const full = rows.slice(0, -1)
  check(
    "every full row spans the grid flush",
    full.every(
      (row) =>
        row[0].x === 0 &&
        row[row.length - 1].x + row[row.length - 1].w === G.columns &&
        row.every((l, i) => i === 0 || l.x === row[i - 1].x + row[i - 1].w)
    ),
    JSON.stringify(full.map((r) => r.map((l) => [l.x, l.w])))
  )
  check(
    "the block fills the fold exactly",
    Math.max(...layout.map((l) => l.y + l.h)) === TOTAL &&
      layout.every((l) => rows[rows.length - 1].includes(l)
        ? l.y + l.h === TOTAL : true),
    `${Math.max(...layout.map((l) => l.y + l.h))}`
  )
  const ws = layout.map((l) => l.w)
  const hs = layout.map((l) => l.h)
  check(
    "cells are identical within one lattice unit on both axes",
    Math.max(...ws) - Math.min(...ws) <= 1 &&
      Math.max(...hs) - Math.min(...hs) <= 1,
    `w ${Math.min(...ws)}..${Math.max(...ws)} h ${Math.min(...hs)}..${Math.max(...hs)}`
  )
  check(
    "reading order is preserved row-major",
    rows
      .flat()
      .map((l) => l.i)
      .join(",") === items(n).map((it) => it.key).join(","),
    rows.flat().map((l) => l.i).join(",")
  )
  const last = rows[rows.length - 1]
  check(
    "the ragged last row is left-aligned, not stretched or centered",
    last[0].x === 0 &&
      last.every((l, i) => i === 0 || l.x === last[i - 1].x + last[i - 1].w) &&
      last.reduce((acc, l) => acc + l.w, 0) < G.columns,
    JSON.stringify(last.map((l) => [l.x, l.w]))
  )
}

// ---- N=1: one cell, the whole rectangle ---------------------------------

{
  const layout = packUniform({
    items: items(1), grid: G, columnWidth: COL_W, totalGridRows: TOTAL,
    ...MINS,
  })
  check(
    "a single item spans the whole target rectangle",
    layout.length === 1 &&
      layout[0].x === 0 && layout[0].y === 0 &&
      layout[0].w === G.columns && layout[0].h === TOTAL,
    JSON.stringify(layout)
  )
}

// ---- scoring: the cell shape follows the items --------------------------

{
  const portrait = rankUniformFactorizations({
    items: items(12, 0.5), grid: G, columnWidth: COL_W, totalGridRows: TOTAL,
    ...MINS,
  })
  const landscape = rankUniformFactorizations({
    items: items(12, 2), grid: G, columnWidth: COL_W, totalGridRows: TOTAL,
    ...MINS,
  })
  check(
    "portrait items rank a portrait-ish cell first",
    portrait[0].cellAspect < 1,
    `${portrait[0].cols}x${portrait[0].rows} aspect ${portrait[0].cellAspect.toFixed(2)}`
  )
  check(
    "landscape items rank a landscape cell first",
    landscape[0].cellAspect > 1,
    `${landscape[0].cols}x${landscape[0].rows} aspect ${landscape[0].cellAspect.toFixed(2)}`
  )
  check(
    "the two item sets rank different factorizations first",
    portrait[0].cols !== landscape[0].cols ||
      portrait[0].rows !== landscape[0].rows
  )
  check(
    "the ranking is loss-ascending",
    portrait.every((f, i) => i === 0 || portrait[i - 1].loss <= f.loss)
  )
}

// ---- minimum size: infeasibility refuses, never relaxes -----------------

{
  const layout = packUniform({
    items: items(4), grid: G, columnWidth: COL_W,
    // 6 rows can't give any factorization minH=7 cells
    totalGridRows: 6, minW: 4, minH: 7,
  })
  check("an unsatisfiable minimum returns [] (no relaxation)",
    layout.length === 0, JSON.stringify(layout))
  check(
    "…and the ranking agrees there is nothing feasible",
    rankUniformFactorizations({
      items: items(4), grid: G, columnWidth: COL_W,
      totalGridRows: 6, minW: 4, minH: 7,
    }).length === 0
  )
}

// ---- obstacles: blocked cells are skipped, shortfall refuses ------------

{
  // An anchored block over the top-left 54x30: of the cols<=4
  // factorizations only 3x2 keeps 4 cells free (row 0 loses two of its
  // three cells, row 1 is untouched)
  const obstacle = { x: 0, y: 0, w: 54, h: 30 }
  const ranked = rankUniformFactorizations({
    items: items(4), obstacles: [obstacle], grid: G, columnWidth: COL_W,
    totalGridRows: TOTAL, ...MINS,
  })
  check(
    "only the factorization with enough free cells survives",
    ranked.length === 1 && ranked[0].cols === 3 && ranked[0].rows === 2,
    JSON.stringify(ranked)
  )
  const layout = packUniform({
    items: items(4), obstacles: [obstacle], grid: G, columnWidth: COL_W,
    totalGridRows: TOTAL, ...MINS,
  })
  const hits = layout.filter(
    (l) =>
      l.x < obstacle.x + obstacle.w && obstacle.x < l.x + l.w &&
      l.y < obstacle.y + obstacle.h && obstacle.y < l.y + l.h
  )
  check(
    "no placed cell intersects the obstacle",
    layout.length === 4 && hits.length === 0,
    JSON.stringify(layout)
  )
  check(
    "placement is row-major over the FREE cells",
    layout[0].y === 0 && layout[0].x === 72 &&
      layout.slice(1).every((l) => l.y === 30),
    JSON.stringify(layout)
  )
  check(
    "too few free cells refuses",
    packUniform({
      items: items(4),
      obstacles: [{ x: 0, y: 0, w: G.columns, h: TOTAL }],
      grid: G, columnWidth: COL_W, totalGridRows: TOTAL, ...MINS,
    }).length === 0
  )
}

// ---- sticky cell aspect: nearest match survives an N change -------------

{
  // The reroll stores a CELL ASPECT, never a rank index; a later fill at a
  // different item count must land on the feasible factorization nearest
  // that shape. Chosen here: the 2-column cell of a 12-item board, a very
  // wide shape nowhere near the square argmin.
  const at12 = rankUniformFactorizations({
    items: items(12), grid: G, columnWidth: COL_W, totalGridRows: TOTAL,
    ...MINS,
  })
  const chosen = at12.find((f) => f.cols === 2)
  const at20 = rankUniformFactorizations({
    items: items(20), grid: G, columnWidth: COL_W, totalGridRows: TOTAL,
    ...MINS,
  })
  const expected = at20[nearestUniformIndex(at20, chosen.cellAspect)]
  check(
    "the nearest factorization is not simply the argmin",
    expected.cols !== at20[0].cols || expected.rows !== at20[0].rows,
    `expected ${expected.cols}x${expected.rows}, argmin ${at20[0].cols}x${at20[0].rows}`
  )
  const layout = packUniform({
    items: items(20), grid: G, columnWidth: COL_W, totalGridRows: TOTAL,
    chosenAspect: chosen.cellAspect, ...MINS,
  })
  const firstRow = rowsOf(layout)[0]
  check(
    "packUniform picks that nearest factorization",
    firstRow.length === expected.cols,
    `first row has ${firstRow.length} cells, expected ${expected.cols}`
  )
  check(
    "nearestUniformIndex is an exact match for a listed aspect",
    at20[nearestUniformIndex(at20, cellAspectOf(at20[3].cols, at20[3].rows))]
      === at20[3]
  )
}

// ---- packUniformInBox: the virtual-grid translation ---------------------

{
  const box = { x: 10, y: 5, w: 40, h: 20 }
  const layout = packUniformInBox({
    items: items(4), obstacles: [], grid: G, columnWidth: COL_W, box,
    minW: 4, minH: 7,
  })
  check(
    "boxed cells tile the box exactly",
    layout.length === 4 &&
      Math.min(...layout.map((l) => l.x)) === box.x &&
      Math.min(...layout.map((l) => l.y)) === box.y &&
      Math.max(...layout.map((l) => l.x + l.w)) === box.x + box.w &&
      Math.max(...layout.map((l) => l.y + l.h)) === box.y + box.h,
    JSON.stringify(layout)
  )
  check(
    "a box below the minimum size refuses",
    packUniformInBox({
      items: items(4), obstacles: [], grid: G, columnWidth: COL_W,
      box: { x: 0, y: 0, w: 6, h: 8 }, minW: 4, minH: 7,
    }).length === 0
  )
}

console.log(all ? "\nALL PASS" : "\nFAILURES")
process.exit(all ? 0 : 1)
