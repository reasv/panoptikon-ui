// Assertions for the grid's rendition-tier choice (lib/thumbnailTier.ts) and
// the cell-size slider's arithmetic (lib/gridCellSize.ts), plus the URL the
// two feed (lib/utils.ts getFileURL). The contracts are
// docs/grid-scroll-performance-implementation.md §2 (tier thresholds, the
// extreme-aspect rule) and docs/search-scroll-mode-design.md §9 (the slider).
// No test runner in this repo — run it from the ui root:
//
//   node --experimental-strip-types scripts/gridcells.test.mjs
//
// Both modules are import-free precisely so this can execute them: the
// components that call them pull in React, next/image and nuqs, none of which
// resolve outside a bundler. Exits non-zero on failure.

import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  EXTREME_ASPECT,
  TIER_SHORT_SIDE,
  TIER_SLACK,
  isExtremeAspect,
  tierForCellWidth,
} = await import("../lib/thumbnailTier.ts")
const {
  CELL_CHROME_PX,
  GRID_GAP_PX,
  MAX_CELL_WIDTH,
  MIN_CELL_WIDTH,
  cellWidthForColumns,
  clampCellWidth,
  coWrittenPageSize,
  columnsForCellWidth,
  imageBoxHeightForCellWidth,
  rowHeightForCellWidth,
} = await import("../lib/gridCellSize.ts")
const { getFileURL } = await import("../lib/utils.ts")

let all = true
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `\n  ${detail}` : ""}`)
  all &&= !!ok
  return ok
}

console.log("\n== tier thresholds (§2) ==")
{
  // The two numbers the design states verbatim: grid-s up to 576 device
  // pixels, grid-m up to 1152, display past that. Written as products so the
  // assertion survives a change of either constant.
  const sMax = TIER_SHORT_SIDE["grid-s"] * TIER_SLACK
  const mMax = TIER_SHORT_SIDE["grid-m"] * TIER_SLACK
  check("the stated thresholds are 576 and 1152",
    sMax === 576 && mMax === 1152, `${sMax} / ${mMax}`)
  check("at DPR 1 a 576px cell is still grid-s",
    tierForCellWidth(576, 1) === "grid-s")
  check("at DPR 1 a 577px cell steps up to grid-m",
    tierForCellWidth(577, 1) === "grid-m")
  check("at DPR 1 a 1152px cell is still grid-m",
    tierForCellWidth(1152, 1) === "grid-m")
  check("at DPR 1 a 1153px cell needs display",
    tierForCellWidth(1153, 1) === "display")
  // DPR is a multiplier on the box, nothing else: the same cell on a 2x
  // display asks for the tier a twice-as-wide cell would.
  check("DPR 2 halves every threshold",
    tierForCellWidth(288, 2) === "grid-s"
      && tierForCellWidth(289, 2) === "grid-m"
      && tierForCellWidth(576, 2) === "grid-m"
      && tierForCellWidth(577, 2) === "display")
  // The measured cases from the plan: a 4K five-column grid, and the same
  // grid with the slider at its minimum.
  check("a 4K 5-column cell (~750px) asks for grid-m at DPR 1",
    tierForCellWidth(750, 1) === "grid-m")
  check("a 1080p 5-column cell (~370px) asks for grid-s at DPR 1",
    tierForCellWidth(370, 1) === "grid-s")
  check("the gallery filmstrip's 240px card is grid-s to DPR 2.4",
    tierForCellWidth(240, 1) === "grid-s"
      && tierForCellWidth(240, 2) === "grid-s"
      && tierForCellWidth(240, 2.4) === "grid-s"
      && tierForCellWidth(240, 3) === "grid-m")
}
{
  // "Not measured yet" must answer display, never the smallest tier: the
  // conservative direction is the one that cannot paint a blurry cell.
  check("an unmeasured width answers display",
    tierForCellWidth(0, 2) === "display"
      && tierForCellWidth(-10, 1) === "display"
      && tierForCellWidth(NaN, 1) === "display"
      && tierForCellWidth(Infinity, 1) === "display")
  check("a nonsense DPR falls back to 1",
    tierForCellWidth(500, 0) === "grid-s"
      && tierForCellWidth(500, NaN) === "grid-s"
      && tierForCellWidth(500, -2) === "grid-s")
}

console.log("\n== the extreme-aspect test (§2) ==")
{
  check("the threshold is aspect 2", EXTREME_ASPECT === 2)
  check("aspect exactly 2 is NOT extreme, in either orientation",
    !isExtremeAspect(1000, 500) && !isExtremeAspect(500, 1000))
  check("past 2 is extreme, in either orientation",
    isExtremeAspect(1001, 500) && isExtremeAspect(500, 1001))
  check("a webtoon strip is extreme", isExtremeAspect(800, 20000))
  check("an ordinary photo is not", isExtremeAspect(4000, 3000) === false)
  // MISSING DIMENSIONS ARE NORMAL. Treating an unknown as extreme would
  // mount the hover swap on every pre-backfill row — the exact cost the
  // zero-cost-for-normal invariant exists to prevent.
  check("missing dimensions are treated as normal aspect",
    !isExtremeAspect(null, null)
      && !isExtremeAspect(undefined, undefined)
      && !isExtremeAspect(800, null)
      && !isExtremeAspect(null, 800)
      && !isExtremeAspect(0, 0)
      && !isExtremeAspect(-5, 10)
      && !isExtremeAspect(NaN, 100))
}

console.log("\n== the URL the tier produces ==")
{
  const dbs = { index_db: "stdtest", user_data_db: null }
  check("omitting the tier is the legacy bare URL",
    getFileURL(dbs, "thumbnail", "sha256", "abc")
      === "/api/items/item/thumbnail?id=abc&id_type=sha256&index_db=stdtest",
    getFileURL(dbs, "thumbnail", "sha256", "abc"))
  check("a tier appends size=",
    getFileURL(dbs, "thumbnail", "sha256", "abc", "grid-s")
      === "/api/items/item/thumbnail?id=abc&id_type=sha256&index_db=stdtest&size=grid-s")
  // The point of spelling `display` out (F4): it is a DIFFERENT URL from the
  // bare one, so a cache entry stamped before the tier work cannot answer it.
  check("an explicit display is a different URL from the bare one",
    getFileURL(dbs, "thumbnail", "sha256", "abc", "display")
      !== getFileURL(dbs, "thumbnail", "sha256", "abc"))
  check("no index_db still produces a well-formed URL",
    getFileURL({ index_db: null, user_data_db: null }, "thumbnail", "sha256", "abc", "grid-m")
      === "/api/items/item/thumbnail?id=abc&id_type=sha256&size=grid-m")
}

console.log("\n== columns and row height from an explicit cell width (§9) ==")
{
  // N columns carry N-1 gaps, so the naive floor(container/target) loses a
  // column as soon as the gaps add up to one.
  check("three 300px columns fit 932px exactly (2 gaps)",
    columnsForCellWidth(932, 300, GRID_GAP_PX) === 3)
  // One pixel less is one pixel too few for three cells AT the target, so it
  // is two — the target is a floor on the cell width, not an approximation of
  // it. (The naive floor(container/target) would say 3 here and lay out three
  // 299.3px cells.)
  check("one pixel less is two columns, not three narrow ones",
    columnsForCellWidth(931, 300, GRID_GAP_PX) === 2)
  check("a container narrower than one cell still gets one column",
    columnsForCellWidth(100, 300, GRID_GAP_PX) === 1)
  check("an unmeasured container gets no columns at all",
    columnsForCellWidth(0, 300) === 0 && columnsForCellWidth(1000, 0) === 0)
  // The round trip: the columns a target produces, laid out, are never
  // NARROWER than the target — that is what makes the tier chosen from the
  // result at least as big as the tier chosen from the target.
  for (const container of [800, 1280, 1920, 2560, 3840, 7680]) {
    for (const target of [140, 200, 300, 480, 700, 1200]) {
      const columns = columnsForCellWidth(container, target, GRID_GAP_PX)
      const width = cellWidthForColumns(container, columns, GRID_GAP_PX)
      if (!check(
        `laid-out cells are never narrower than the target (${container}/${target})`,
        columns === 1 || width >= target - 1e-9,
        `${columns} columns of ${width}`
      )) break
    }
  }
}
{
  // The chrome constant is what makes an explicit row height as exact as a
  // breakpoint one (design §6): the shipped constants are 470/566/694 over
  // picture boxes of 384/480/608.
  check("the chrome constant matches all three shipped breakpoints",
    470 - 384 === CELL_CHROME_PX
      && 566 - 480 === CELL_CHROME_PX
      && 694 - 608 === CELL_CHROME_PX)
  check("the row height is the square box plus the chrome",
    rowHeightForCellWidth(400) === 400 + CELL_CHROME_PX
      && imageBoxHeightForCellWidth(400.4) === 400)
  check("cell widths clamp into the slider's range",
    clampCellWidth(0) === MIN_CELL_WIDTH
      && clampCellWidth(99999) === MAX_CELL_WIDTH
      && clampCellWidth(NaN) === MIN_CELL_WIDTH
      && clampCellWidth(300.6) === 301)
}

console.log("\n== the page-size co-write (§9) ==")
{
  // Items per screenful scale with the SQUARE of the width ratio: the width
  // sets the columns, and the row height derives from the width.
  check("halving the cell width quadruples the page size",
    coWrittenPageSize(10, 400, 200) === 40)
  check("doubling it quarters the page size",
    coWrittenPageSize(40, 200, 400) === 10)
  check("a 1.5x shrink scales by 2.25",
    coWrittenPageSize(100, 600, 400) === 225)
  check("an unchanged width writes nothing",
    coWrittenPageSize(10, 400, 400) === null)
  // A `page_size` below 1 means "no LIMIT", not a small page: scaling it
  // would silently impose one.
  check("a no-LIMIT page size is left alone",
    coWrittenPageSize(0, 400, 200) === null
      && coWrittenPageSize(-1, 400, 200) === null)
  check("unusable widths write nothing",
    coWrittenPageSize(10, 0, 200) === null
      && coWrittenPageSize(10, 400, 0) === null
      && coWrittenPageSize(10, NaN, 200) === null)
  check("the result stays inside the page-size bounds",
    coWrittenPageSize(9000, 1200, 140) === 10000)
  // Clamped to 1 and ALREADY 1, which is "nothing to write" — the null the
  // unchanged case returns, not a redundant write of the same value.
  check("a page size of 1 shrinking further writes nothing",
    coWrittenPageSize(1, 140, 1200) === null)
  // Rounding must never produce a zero-item page out of a legal one.
  check("a heavy enlargement still leaves at least one item",
    coWrittenPageSize(2, MIN_CELL_WIDTH, MAX_CELL_WIDTH) === 1)
}

console.log(all ? "\nALL PASS" : "\nFAILURES")
process.exit(all ? 0 : 1)
