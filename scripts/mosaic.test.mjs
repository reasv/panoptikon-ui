// Assertions for lib/pinboardGeometry.ts, the shared cell mapping and the
// mosaic export's capture-box math. No test runner in this repo — run it
// directly from the ui root:
//
//   node --experimental-strip-types scripts/mosaic.test.mjs
//
// (the flag is what lets a .mjs import the .ts module; Node 22+). Exits
// non-zero on the first failing assertion set.

// The geometry module imports its siblings extensionless, which node's
// resolver rejects; ts-hooks fills that in. register() has to run before
// the modules load, hence the dynamic imports.
import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  MAX_CANVAS_AREA,
  MAX_CANVAS_SIDE,
  canvasClampFactor,
  cellRect,
  colStep,
  foldRows,
  mosaicGeometry,
  solveWithinCanvasLimits,
} = await import("../lib/pinboardGeometry.ts")
const { V2_GRID, effectiveGrid, rowStep } = await import("../lib/pinboardGrid.ts")

let all = true
const eq = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `\n  ${detail}` : ""}`)
  all &&= !!ok
  return ok
}

// mosaicGeometry answers with a tagged result (a box, or WHY there is no
// box); the geometry assertions below want the box itself.
function geometryOf(input) {
  const result = mosaicGeometry(input)
  if (!result.ok) {
    throw new Error(`expected a capture box, got failure "${result.failure}"`)
  }
  return result.geometry
}

const G = V2_GRID // 108 cols, rowHeight 5, margin 5, padding 5
const W = 1920

// ---- padded lattice: unchanged from the preview compositor -------------

{
  const colW = (W - 2 * G.padding - (G.columns - 1) * G.margin) / G.columns
  const r = cellRect(G, W, 3, 4, 10, 6)
  check(
    "padded rect matches the board's own mapping",
    eq(r.left, G.padding + 3 * (colW + G.margin)) &&
      eq(r.top, G.padding + 4 * rowStep(G)) &&
      eq(r.width, 10 * colW + 9 * G.margin) &&
      eq(r.height, 6 * G.rowHeight + 5 * G.margin),
    JSON.stringify(r)
  )
}

// ---- seamless lattice: rects tile exactly ------------------------------

{
  const step = colStep(G, W)
  const a = cellRect(G, W, 0, 0, 10, 6, true)
  const b = cellRect(G, W, 10, 0, 4, 6, true) // immediately right of a
  const c = cellRect(G, W, 0, 6, 10, 2, true) // immediately below a
  check(
    "seamless rects start at the origin (no container padding)",
    eq(a.left, 0) && eq(a.top, 0)
  )
  check(
    "seamless neighbours share edges exactly",
    eq(a.left + a.width, b.left) && eq(a.top + a.height, c.top),
    `a.right=${a.left + a.width} b.left=${b.left} a.bottom=${a.top + a.height} c.top=${c.top}`
  )
  check(
    "seamless cell = w*colStep by h*rowStep",
    eq(a.width, 10 * step) && eq(a.height, 6 * rowStep(G))
  )
  // A full-width row of seamless cells spans the board minus the padding
  // it absorbed, plus the one margin RGL never spends
  const full = cellRect(G, W, 0, 0, G.columns, 1, true)
  check(
    "a full-width seamless row spans boardWidth - 2*padding + margin",
    eq(full.width, W - 2 * G.padding + G.margin),
    `${full.width}`
  )
}

// ---- fold rows: the inverse of the vertical mapping --------------------

{
  const rows = foldRows(G, 1000)
  const bottom = 2 * G.padding + rows * rowStep(G) - G.margin
  check(
    "foldRows is the largest row count fitting the container",
    bottom <= 1000 && 2 * G.padding + (rows + 1) * rowStep(G) - G.margin > 1000,
    `rows=${rows} bottom=${bottom}`
  )
  check("foldRows never returns 0", foldRows(G, 1) === 1)
}

// ---- mosaic geometry: extents, seams, crop box ------------------------

// Two pins: one in the first rows, one far below the fold.
const records = [
  "aaaaaaaaaa", "0", "0", "20", "12",
  "bbbbbbbbbb", "0", "200", "20", "12",
]
const rows = 40

{
  const full = geometryOf({
    records, grid: G, layoutWidth: W, seamless: false,
    extent: "full", visibleRows: rows,
  })
  const bottomPin = cellRect(G, W, 0, 200, 20, 12)
  check(
    "full extent reaches the bottom pin plus padding",
    full.height === Math.round(bottomPin.top + bottomPin.height + G.padding - 0),
    `${full.height}`
  )
  check(
    "full extent crops to the content box (both pins are 20 cols wide)",
    full.width === Math.round(cellRect(G, W, 0, 0, 20, 1).width + 2 * G.padding),
    `${full.width}`
  )
  check("cropTop is 0 when a pin sits in row 0", full.cropTop === 0)
}

{
  const vis = geometryOf({
    records, grid: G, layoutWidth: W, seamless: false,
    extent: "visible", visibleRows: rows,
  })
  check(
    "visible extent cuts at the fill line",
    vis.height === Math.round(2 * G.padding + rows * rowStep(G) - G.margin),
    `${vis.height}`
  )
  check(
    "the fill line is the inverse of foldRows",
    foldRows(G, vis.height) === rows,
    `foldRows(${vis.height}) = ${foldRows(G, vis.height)}`
  )
  // The straddler: a pin whose top is inside the box but whose bottom is
  // past it stays in the placement list (the canvas edge clips it)
  const straddle = geometryOf({
    records: ["cccccccccc", "0", String(rows - 2), "20", "12"],
    grid: G, layoutWidth: W, seamless: false,
    extent: "visible", visibleRows: rows,
  })
  const r = cellRect(G, W, 0, rows - 2, 20, 12)
  check(
    "a straddling pin is kept and clipped, not dropped",
    straddle.placements.length === 1 &&
      r.top < straddle.cropTop + straddle.height &&
      r.top + r.height > straddle.cropTop + straddle.height,
    `pin ${r.top}..${r.top + r.height}, box ends ${straddle.cropTop + straddle.height}`
  )
}

{
  // Visible extent on a board shorter than the fold: the box is the
  // content, not a screenful of empty background
  const short = geometryOf({
    records: ["aaaaaaaaaa", "0", "0", "20", "12"],
    grid: G, layoutWidth: W, seamless: false,
    extent: "visible", visibleRows: rows,
  })
  const pin = cellRect(G, W, 0, 0, 20, 12)
  check(
    "visible extent never pads past the content",
    short.height === Math.round(pin.top + pin.height + G.padding),
    `${short.height}`
  )
}

{
  const seam = geometryOf({
    records, grid: G, layoutWidth: W, seamless: true,
    extent: "visible", visibleRows: rows,
  })
  check(
    "seamless visible extent is exactly rows * rowStep",
    seam.height === rows * rowStep(G) && seam.cropTop === 0,
    `${seam.height}`
  )
  check(
    "seamless crop box has no padding gutter",
    seam.cropLeft === 0 &&
      seam.width === Math.round(20 * colStep(G, W)),
    `left=${seam.cropLeft} width=${seam.width}`
  )
}

{
  // Offset board: the crop box follows the content, keeping one padding
  const off = geometryOf({
    records: ["aaaaaaaaaa", "50", "10", "20", "12"],
    grid: G, layoutWidth: W, seamless: false,
    extent: "full", visibleRows: rows,
  })
  const pin = cellRect(G, W, 50, 10, 20, 12)
  check(
    "padded crop box keeps exactly one padding around the content",
    eq(off.cropLeft, pin.left - G.padding) &&
      eq(off.cropTop, pin.top - G.padding) &&
      off.width === Math.round(pin.width + 2 * G.padding),
    `cropLeft=${off.cropLeft} cropTop=${off.cropTop} width=${off.width}`
  )
}

{
  const empty = mosaicGeometry({
    records: [], grid: G, layoutWidth: W, seamless: false,
    extent: "full", visibleRows: rows,
  })
  check(
    "an empty board has no geometry",
    empty.ok === false && empty.failure === "no-pins",
    JSON.stringify(empty)
  )
}

{
  // A board whose every pin sits BELOW the fill line: the visible box cuts
  // to nothing (its top is already past its bottom). That must be
  // distinguishable from a broken board, because the fix is the extent
  // switch, not a retry.
  const below = ["dddddddddd", "0", String(rows + 10), "20", "12"]
  const input = {
    records: below, grid: G, layoutWidth: W, seamless: false,
    extent: "visible", visibleRows: rows,
  }
  const vis = mosaicGeometry(input)
  check(
    "a board entirely below the fold reports empty-visible",
    vis.ok === false && vis.failure === "empty-visible",
    JSON.stringify(vis)
  )
  const seam = mosaicGeometry({ ...input, seamless: true })
  check(
    "…seamless too",
    seam.ok === false && seam.failure === "empty-visible",
    JSON.stringify(seam)
  )
  const full = mosaicGeometry({ ...input, extent: "full" })
  check(
    "…and the same board composites fine on the full extent",
    full.ok === true && full.geometry.height > 0,
    JSON.stringify(full.ok ? full.geometry.height : full)
  )
}

// ---- proportional grid: the mosaic scales with the target width --------

{
  // A "Scale With Window" board authored at 1503px, exported at 3840: the
  // cell ASPECT must survive the trip, or the export is not the board.
  const refWidth = 1503
  const target = 3840
  const gLive = effectiveGrid(G, 1) // scale 1 at the reference width
  const gTarget = effectiveGrid(G, target / refWidth)
  const a = cellRect(gLive, refWidth, 0, 0, 10, 6)
  const b = cellRect(gTarget, target, 0, 0, 10, 6)
  check(
    "cell aspect is preserved when the whole grid scales with the width",
    eq(a.width / a.height, b.width / b.height, 1e-9),
    `${a.width / a.height} vs ${b.width / b.height}`
  )
  check(
    "and the export really is bigger",
    eq(b.width / a.width, target / refWidth, 1e-9)
  )
}

// ---- canvas guard -----------------------------------------------------

check("canvasClampFactor is 1 for an ordinary canvas", canvasClampFactor(3840, 8000) === 1)
{
  const f = canvasClampFactor(3840, 40000)
  check(
    "an over-tall canvas is clamped to the side limit",
    f < 1 && eq(40000 * f, MAX_CANVAS_SIDE, 1e-6),
    `factor=${f}`
  )
}
{
  const w = 12000
  const h = 30000 // 360M px: under the side cap on width, over the area cap
  const f = canvasClampFactor(w, h)
  check(
    "an over-area canvas is clamped to the area limit",
    f < 1 && w * f * h * f <= MAX_CANVAS_AREA + 1,
    `factor=${f} area=${Math.round(w * f * h * f)}`
  )
  check(
    "the clamped canvas also respects the side limit",
    w * f <= MAX_CANVAS_SIDE && h * f <= MAX_CANVAS_SIDE
  )
}
{
  // The real loop (the one composeBoardMosaic runs): shrink the TARGET
  // WIDTH by the factor and re-solve — the geometry must then fit.
  const tall = ["aaaaaaaaaa", "0", "0", "108", "40000"]
  const res = solveWithinCanvasLimits(3840, (width) =>
    mosaicGeometry({
      records: tall, grid: effectiveGrid(G, width / 1503), layoutWidth: width,
      seamless: false, extent: "full", visibleRows: rows,
    })
  )
  check(
    "re-solving at the clamped width yields a drawable canvas",
    res.ok &&
      res.geometry.width <= MAX_CANVAS_SIDE &&
      res.geometry.height <= MAX_CANVAS_SIDE &&
      res.geometry.width * res.geometry.height <= MAX_CANVAS_AREA,
    res.ok ? `${res.geometry.width}x${res.geometry.height} at target ${res.layoutWidth}` : JSON.stringify(res)
  )
  check(
    "the clamp is reported back to the caller",
    res.ok && res.clampedWidth !== null && res.clampedWidth < 3840,
    res.ok ? `${res.clampedWidth}` : ""
  )
}

{
  // A request that fits straight away is not reported as clamped.
  const res = solveWithinCanvasLimits(1920, (width) =>
    mosaicGeometry({
      records, grid: effectiveGrid(G, width / 1503), layoutWidth: width,
      seamless: false, extent: "full", visibleRows: rows,
    })
  )
  check(
    "an honored request reports no clamp",
    res.ok && res.clampedWidth === null && res.layoutWidth === 1920,
    JSON.stringify(res.ok ? { w: res.layoutWidth, c: res.clampedWidth } : res)
  )
}

{
  // The exit rule: the loop is left by a solve that FIT. A solver that
  // never fits must fail — handing the last oversized geometry back would
  // allocate a canvas the browser returns blank (or OOMs on).
  let calls = 0
  const oversized = {
    placements: [], cropLeft: 0, cropTop: 0,
    width: MAX_CANVAS_SIDE * 3, height: MAX_CANVAS_SIDE * 3,
  }
  const res = solveWithinCanvasLimits(3840, () => {
    calls++
    return { ok: true, geometry: oversized }
  })
  check(
    "a solve that never fits fails instead of allocating",
    res.ok === false && res.failure === "too-large",
    JSON.stringify(res)
  )
  check("…after spending every pass", calls === 4, `calls=${calls}`)
  check(
    "a failing solve propagates its own reason",
    (() => {
      const r = solveWithinCanvasLimits(3840, () => ({
        ok: false, failure: "empty-visible",
      }))
      return r.ok === false && r.failure === "empty-visible"
    })()
  )
}

console.log(all ? "\nALL PASS" : "\nFAILURES")
process.exit(all ? 0 : 1)
