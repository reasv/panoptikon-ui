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
import { createChecker } from "./harness.mjs"
import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  MAX_CANVAS_AREA,
  MAX_CANVAS_SIDE,
  canvasClampFactor,
  cellRect,
  colStep,
  fitLayoutWidthToOutput,
  foldRows,
  itemOutputSize,
  mosaicGeometry,
  resolvePinDraw,
  solveWithinCanvasLimits,
} = await import("../lib/pinboardGeometry.ts")
const { V2_GRID, effectiveGrid, rowStep } = await import("../lib/pinboardGrid.ts")

const { check, finish } = createChecker()
const eq = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol

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

// ---- selection subsets: the same board, fewer keys ---------------------

{
  // Three pins side by side; the export captures the outer two.
  const three = [
    "aaaaaaaaaa", "0", "0", "20", "12",
    "bbbbbbbbbb", "24", "0", "20", "12",
    "cccccccccc", "48", "0", "20", "12",
  ]
  const only = new Set(["0-aaaaaaaaaa", "10-cccccccccc"])
  const sel = geometryOf({
    records: three, grid: G, layoutWidth: W, seamless: false,
    extent: "full", visibleRows: rows, only,
  })
  check(
    "a selection captures only its own keys",
    sel.placements.length === 2 &&
      sel.placements.every((p) => only.has(p.key)),
    sel.placements.map((p) => p.key).join(" ")
  )
  // The key is the RECORD OFFSET plus the sha, so it must survive the
  // filter: numbering the kept records 0,5 instead of 0,10 would name
  // different items than the board's own selection does.
  check(
    "keys keep their original record offsets",
    sel.placements[1].key === "10-cccccccccc",
    sel.placements[1].key
  )
  const first = cellRect(G, W, 0, 0, 20, 12)
  const last = cellRect(G, W, 48, 0, 20, 12)
  check(
    "the box spans the selection, gap in the middle included",
    sel.cropLeft === Math.max(0, first.left - G.padding) &&
      sel.width === Math.round(last.left + last.width + G.padding - sel.cropLeft),
    `${sel.cropLeft} + ${sel.width}`
  )
  // The unselected middle pin's spot is inside the box and simply empty:
  // the selection keeps the arrangement it has on screen.
  const middle = cellRect(G, W, 24, 0, 20, 12)
  check(
    "an unselected item between two selected ones leaves its gap",
    middle.left > sel.cropLeft && middle.left + middle.width < sel.cropLeft + sel.width
  )
  const one = geometryOf({
    records: three, grid: G, layoutWidth: W, seamless: false,
    extent: "full", visibleRows: rows, only: new Set(["5-bbbbbbbbbb"]),
  })
  check(
    "a one-key selection crops to that item alone",
    one.placements.length === 1 &&
      one.width === Math.round(middle.width + 2 * G.padding),
    `${one.width}`
  )
  check(
    "a selection naming nothing on the board has no pins",
    mosaicGeometry({
      records: three, grid: G, layoutWidth: W, seamless: false,
      extent: "full", visibleRows: rows, only: new Set(["999-zzzzzzzzzz"]),
    }).failure === "no-pins"
  )
}

// ---- output width: the preset names the FILE's width -------------------

{
  const three = [
    "aaaaaaaaaa", "0", "0", "20", "12",
    "bbbbbbbbbb", "24", "0", "20", "12",
  ]
  const only = new Set(["0-aaaaaaaaaa"])
  const solveAt = (width) =>
    mosaicGeometry({
      records: three, grid: effectiveGrid(G, width / W), layoutWidth: width,
      seamless: false, extent: "full", visibleRows: rows, only,
    })
  // Laid out at the preset, one pin of 20 columns is nowhere near it.
  const naive = geometryOf({
    records: three, grid: effectiveGrid(G, 1920 / W), layoutWidth: 1920,
    seamless: false, extent: "full", visibleRows: rows, only,
  })
  check(
    "laying the BOARD out at the preset undershoots for a selection",
    naive.width < 1920 / 3,
    `${naive.width}`
  )
  const fitted = fitLayoutWidthToOutput(1920, solveAt)
  const out = geometryOf({
    records: three, grid: effectiveGrid(G, fitted.layoutWidth / W),
    layoutWidth: fitted.layoutWidth, seamless: false, extent: "full",
    visibleRows: rows, only,
  })
  check(
    "fitting for output width lands on the preset",
    fitted.ok && Math.abs(out.width - 1920) <= 2,
    `layoutWidth=${fitted.layoutWidth} -> ${out.width}`
  )
  check(
    "a failing probe propagates instead of guessing a width",
    fitLayoutWidthToOutput(1920, () => ({ ok: false, failure: "no-pins" }))
      .failure === "no-pins"
  )
}

// ---- resolvePinDraw: the four lines every compositor runs ---------------
//
// Extracted from the canvas compositor so the preview, the mosaic and the
// composition document all place a pin identically (§4 C5), which means it is
// now the ONE place a crop, an orientation and a contain fit meet. Both cases
// below are computed by hand rather than re-derived from the module, so a
// change to any of the three has to be a deliberate one.

{
  // A quarter turn CLOCKWISE: crops are stored in DISPLAY space, so the fit
  // runs on the swapped (2000x4000) dimensions and the source rect is the
  // display rect unwound — the map `sourceRect` implements.
  //
  //   display region: 0.5*2000 x 0.4*4000 = 1000 x 1600
  //   contain in 600x400: scale = min(0.6, 0.25) = 0.25 -> 250 x 400
  //   letterboxed at the SIDES: visL = (600-250)/2 = 175, visT = 0
  //   source rect: ccw of the crop = {0.1, 0.25, 0.4, 0.5}
  //                = 400,500 1600x1000 px of the 4000x2000 source
  const crop = { x: 0.25, y: 0.1, w: 0.5, h: 0.4 }
  const cell = { left: 100, top: 50, width: 600, height: 400 }
  const turned = resolvePinDraw(
    { crop, orient: { quarterTurns: 1, flipped: false }, left: 0, top: 0, width: 0, height: 0 },
    4000,
    2000,
    cell
  )
  check(
    "a turned pin's destination is the contain fit of its DISPLAY crop",
    eq(turned.dest.left, 275) &&
      eq(turned.dest.top, 50) &&
      eq(turned.dest.width, 250) &&
      eq(turned.dest.height, 400),
    JSON.stringify(turned.dest)
  )
  check(
    "…and its source rect is that crop unwound into source pixels",
    eq(turned.src.x * 4000, 400) &&
      eq(turned.src.y * 2000, 500) &&
      eq(turned.src.w * 4000, 1600) &&
      eq(turned.src.h * 2000, 1000),
    JSON.stringify(turned.src)
  )
  // A MIRROR, same crop: no axis swap, so the fit letterboxes top and bottom
  // instead, and the source rect is the crop reflected about x = 1/2.
  //
  //   display region: 0.5*4000 x 0.4*2000 = 2000 x 800
  //   contain in 600x400: scale = min(0.3, 0.5) = 0.3 -> 600 x 240
  //   visL = 0, visT = (400-240)/2 = 80
  //   source rect: {1-0.25-0.5, 0.1, 0.5, 0.4} = 1000,200 2000x800 px
  const mirrored = resolvePinDraw(
    { crop, orient: { quarterTurns: 0, flipped: true }, left: 0, top: 0, width: 0, height: 0 },
    4000,
    2000,
    cell
  )
  check(
    "a mirrored pin letterboxes on the other axis",
    eq(mirrored.dest.left, 100) &&
      eq(mirrored.dest.top, 130) &&
      eq(mirrored.dest.width, 600) &&
      eq(mirrored.dest.height, 240),
    JSON.stringify(mirrored.dest)
  )
  check(
    "…and its source rect is the crop reflected, not the crop",
    eq(mirrored.src.x * 4000, 1000) &&
      eq(mirrored.src.y * 2000, 200) &&
      eq(mirrored.src.w * 4000, 2000) &&
      eq(mirrored.src.h * 2000, 800),
    JSON.stringify(mirrored.src)
  )
  check(
    "unusable natural dimensions yield no draw at all",
    resolvePinDraw({ crop, orient: null, left: 0, top: 0, width: 0, height: 0 }, 0, 2000, cell) ===
      null
  )
}

// ---- single item: the crop region, not the cell ------------------------

{
  // A quarter-width crop of a 4000x3000 source is 1000x750, whatever cell
  // it happens to sit in.
  const crop = { x: 0.25, y: 0.25, w: 0.25, h: 0.25 }
  const native = itemOutputSize(crop, 4000, 3000, null, null)
  check(
    "native size is the crop at source resolution",
    native.width === 1000 && native.height === 750,
    `${native.width}x${native.height}`
  )
  check(
    "no crop means the whole source",
    (() => {
      const s = itemOutputSize(null, 4000, 3000, null, null)
      return s.width === 4000 && s.height === 3000
    })()
  )
  // An odd quarter turn swaps the source's axes before the crop applies:
  // crops are stored in DISPLAY space.
  const turned = itemOutputSize(crop, 4000, 3000, { quarterTurns: 1, flipped: false }, null)
  check(
    "an odd quarter turn swaps the output's axes",
    turned.width === 750 && turned.height === 1000,
    `${turned.width}x${turned.height}`
  )
  const scaled = itemOutputSize(crop, 4000, 3000, null, 2000)
  check(
    "a target width scales the whole picture, aspect kept",
    scaled.width === 2000 && scaled.height === 1500,
    `${scaled.width}x${scaled.height}`
  )
  // The canvas guard applies here too: an absurd upscale is shrunk to
  // something drawable rather than silently producing a blank canvas.
  const huge = itemOutputSize(null, 4000, 3000, null, 40000)
  check(
    "an undrawable request is clamped, not allocated",
    huge.width <= MAX_CANVAS_SIDE &&
      huge.height <= MAX_CANVAS_SIDE &&
      huge.width * huge.height <= MAX_CANVAS_AREA &&
      huge.width < 40000,
    `${huge.width}x${huge.height}`
  )
  check(
    "unusable natural dimensions yield no size at all",
    itemOutputSize(null, 0, 3000, null, null) === null
  )
}

finish()
