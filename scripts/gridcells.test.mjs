// Assertions for the grid's rendition-tier choice (lib/thumbnailTier.ts), the
// cell-size slider's arithmetic (lib/gridCellSize.ts) and the pin button's
// record algebra (lib/pinboardPlace.ts togglePinRecords), plus the URL the
// first two feed (lib/utils.ts getFileURL). The contracts are
// docs/grid-scroll-performance-implementation.md §2 (tier thresholds, the
// extreme-aspect rule, the animated raw floor and the <img>-vs-<video>
// decision of §3 F6) and docs/search-scroll-mode-design.md §9 (the slider).
// No test runner in this repo — run it from the ui root:
//
//   node --experimental-strip-types scripts/gridcells.test.mjs
//
// None of these modules import anything a bundler is needed for, which is
// precisely what lets this execute them: the components that call them pull in
// React, next/image and nuqs, none of which resolve outside one. Exits
// non-zero on failure.

import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  EXTREME_ASPECT,
  TIER_SHORT_SIDE,
  TIER_SLACK,
  animatedCellMode,
  isAboveAnimatedFloor,
  isAnimatedItem,
  isExtremeAspect,
  tierForCellWidth,
} = await import("../lib/thumbnailTier.ts")
const {
  AUTO_IMAGE_BOX_HEIGHT_4XL_PX,
  AUTO_IMAGE_BOX_HEIGHT_5XL_PX,
  AUTO_IMAGE_BOX_HEIGHT_PX,
  CELL_CHROME_PX,
  GRID_GAP_PX,
  cellBoxBindingEdge,
  cellWidthForColumns,
  coverBindingEdge,
  clampCellWidth,
  coWrittenPageSize,
  columnsForCellWidth,
  imageBoxHeightForCellWidth,
  rowHeightForCellWidth,
  rowHeightForImageBox,
} = await import("../lib/gridCellSize.ts")
// The URL-domain bounds those helpers clamp into, from their single source.
const { MAX_CELL_WIDTH, MIN_CELL_WIDTH } = await import("../lib/searchLimits.ts")
// The pin button's record algebra, extracted out of CellActionsHost so the
// five-string splice arithmetic below can be asserted at all.
const { togglePinRecords } = await import("../lib/pinboardPlace.ts")
const { V1_GRID, V2_GRID } = await import("../lib/pinboardGrid.ts")
const { getFileURL } = await import("../lib/utils.ts")

let all = true
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `\n  ${detail}` : ""}`)
  all &&= !!ok
  return ok
}

console.log("\n== tier thresholds (§2) ==")
{
  // The numbers the designs state verbatim: grid-xs up to 288 device pixels
  // (docs/thumbnail-format-implementation.md §6), grid-s up to 576, grid-m up
  // to 1152, display past that. Written as products so every assertion
  // survives a change of any constant.
  const xsMax = TIER_SHORT_SIDE["grid-xs"] * TIER_SLACK
  const sMax = TIER_SHORT_SIDE["grid-s"] * TIER_SLACK
  const mMax = TIER_SHORT_SIDE["grid-m"] * TIER_SLACK
  check("the stated thresholds are 288, 576 and 1152",
    xsMax === 288 && sMax === 576 && mMax === 1152,
    `${xsMax} / ${sMax} / ${mMax}`)
  // A POWER-OF-TWO series, which is what makes each rung halve the decoded
  // megapixels of the one above it rather than shave a little off it.
  check("each rung is half the one above it",
    TIER_SHORT_SIDE["grid-xs"] * 2 === TIER_SHORT_SIDE["grid-s"]
      && TIER_SHORT_SIDE["grid-s"] * 2 === TIER_SHORT_SIDE["grid-m"])
  check("at DPR 1 a 288px cell is still grid-xs",
    tierForCellWidth(288, 1) === "grid-xs")
  check("at DPR 1 a 289px cell steps up to grid-s",
    tierForCellWidth(289, 1) === "grid-s")
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
    tierForCellWidth(144, 2) === "grid-xs"
      && tierForCellWidth(145, 2) === "grid-s"
      && tierForCellWidth(288, 2) === "grid-s"
      && tierForCellWidth(289, 2) === "grid-m"
      && tierForCellWidth(576, 2) === "grid-m"
      && tierForCellWidth(577, 2) === "display")
  // The measured cases from the plan: a 4K five-column grid, and the same
  // grid with the slider at its minimum.
  check("a 4K 5-column cell (~750px) asks for grid-m at DPR 1",
    tierForCellWidth(750, 1) === "grid-m")
  check("a 1080p 5-column cell (~370px) asks for grid-s at DPR 1",
    tierForCellWidth(370, 1) === "grid-s")
  // THE REASON grid-xs EXISTS: at the size slider's minimum a cell is 140 CSS
  // px (MIN_CELL_WIDTH), and against the 512 rung a screenful of those decodes
  // roughly 14x the pixels it paints. It stays on the new rung to DPR 2, which
  // covers every retina laptop the grid is used on.
  check("the slider's minimum cell asks for grid-xs to DPR 2",
    tierForCellWidth(MIN_CELL_WIDTH, 1) === "grid-xs"
      && tierForCellWidth(MIN_CELL_WIDTH, 2) === "grid-xs"
      && tierForCellWidth(MIN_CELL_WIDTH, 3) === "grid-s")
  // ...and the rung must not reach any further than that. The filmstrip's
  // cards bind at 320 CSS px (STRIP_CARD_CSS_BINDING_EDGE) and the similarity
  // cards at 400/700, all of them past the 288 boundary at every density, so
  // adding grid-xs moved no surface but the small end of the grid.
  check("the filmstrip's 320px card is NOT grid-xs at any density",
    tierForCellWidth(320, 1) === "grid-s"
      && tierForCellWidth(320, 2) === "grid-m"
      && tierForCellWidth(320, 4) === "display")
  check("the similarity cards are not grid-xs either",
    tierForCellWidth(400, 1) === "grid-s"
      && tierForCellWidth(700, 1) === "grid-m")
}

console.log("\n== the BINDING EDGE of the cell's picture box (§6) ==")
{
  // The auto layout's box is `cellWidth x AUTO_IMAGE_BOX_HEIGHT_*`, NOT a
  // square, and `object-cover` scales the rendition until it covers BOTH
  // edges — so the taller edge is what the tier has to be chosen against.
  // The regression this guards: a 266px-wide auto cell (a 5-column 1400px
  // panel) is 384px tall, and the width alone put it on grid-xs (256), a 1.5x
  // upscale of the short side and well past the ladder's 1.125 slack.
  check("the auto box heights are 384 / 480 / 608",
    AUTO_IMAGE_BOX_HEIGHT_PX === 384
      && AUTO_IMAGE_BOX_HEIGHT_4XL_PX === 480
      && AUTO_IMAGE_BOX_HEIGHT_5XL_PX === 608)
  check("a 266px-wide AUTO cell is grid-s at DPR 1, not grid-xs",
    tierForCellWidth(cellBoxBindingEdge(266, AUTO_IMAGE_BOX_HEIGHT_PX), 1) === "grid-s",
    `binding edge ${cellBoxBindingEdge(266, AUTO_IMAGE_BOX_HEIGHT_PX)}`)
  check("...which is exactly what the width alone got wrong",
    tierForCellWidth(266, 1) === "grid-xs")
  // The EXPLICIT mode's box IS square, so its binding edge is its width and
  // the slider's minimum still lands on the rung grid-xs exists for.
  check("an EXPLICIT 140px cell is grid-xs at DPR 1",
    tierForCellWidth(
      cellBoxBindingEdge(140, imageBoxHeightForCellWidth(140)), 1) === "grid-xs")
  check("an explicit cell's binding edge is its own width at every size",
    [MIN_CELL_WIDTH, 200, 512, MAX_CELL_WIDTH].every((w) =>
      cellBoxBindingEdge(w, imageBoxHeightForCellWidth(w)) === w))
  // The two larger breakpoint bands bind on their box too, and THIS case
  // discriminates: a 500px-wide cell at the 5xl band is 608 tall, so a
  // LANDSCAPE picture in it needs grid-m where the width alone said grid-s.
  // (The previous 590px case did not: 590 is past the grid-s rung on its own.)
  check("a landscape image in a 500x608 5xl cell is grid-m at DPR 1",
    tierForCellWidth(
      coverBindingEdge(500, AUTO_IMAGE_BOX_HEIGHT_5XL_PX, 4000, 3000), 1) === "grid-m")
  check("...where the width alone said grid-s",
    tierForCellWidth(500, 1) === "grid-s")
  // "Not measured yet" must survive the max(): a known box height next to an
  // unmeasured width would otherwise answer a small tier for a cell nobody
  // has laid out.
  check("an unmeasured width still answers display through the binding edge",
    tierForCellWidth(cellBoxBindingEdge(0, AUTO_IMAGE_BOX_HEIGHT_PX), 1) === "display"
      && tierForCellWidth(cellBoxBindingEdge(NaN, AUTO_IMAGE_BOX_HEIGHT_PX), 1) === "display")
  check("an unusable box height falls back to the width",
    cellBoxBindingEdge(300, undefined) === 300
      && cellBoxBindingEdge(300, 0) === 300
      && cellBoxBindingEdge(300, NaN) === 300)
  // The row estimate and the box are one arithmetic now, not two ladders that
  // have to be kept in step by hand.
  check("the auto row estimates are the boxes plus the chrome",
    rowHeightForImageBox(AUTO_IMAGE_BOX_HEIGHT_PX) === 470
      && rowHeightForImageBox(AUTO_IMAGE_BOX_HEIGHT_4XL_PX) === 566
      && rowHeightForImageBox(AUTO_IMAGE_BOX_HEIGHT_5XL_PX) === 694)
}

console.log("\n== the binding edge of ONE PICTURE in that box (§6) ==")
{
  // `object-cover` scales the image until it covers BOTH edges, so the edge
  // its SHORT side has to pay for depends on the image: a portrait picture in
  // a portrait box is bound by the box's WIDTH, a landscape one by its
  // HEIGHT. The worst case above is right for a grid that knows no rows; a
  // CELL knows its own, and at the 5xl band the difference is a whole rung
  // (4x the decoded pixels) for the majority of cells.
  const PORTRAIT = [1200, 1800]
  const LANDSCAPE = [4000, 3000]
  check("a PORTRAIT image in a 266x384 auto cell is grid-xs at DPR 1",
    tierForCellWidth(
      coverBindingEdge(266, AUTO_IMAGE_BOX_HEIGHT_PX, ...PORTRAIT), 1) === "grid-xs",
    `binding edge ${coverBindingEdge(266, AUTO_IMAGE_BOX_HEIGHT_PX, ...PORTRAIT)}`)
  check("a LANDSCAPE image in the same cell is grid-s",
    tierForCellWidth(
      coverBindingEdge(266, AUTO_IMAGE_BOX_HEIGHT_PX, ...LANDSCAPE), 1) === "grid-s",
    `binding edge ${coverBindingEdge(266, AUTO_IMAGE_BOX_HEIGHT_PX, ...LANDSCAPE)}`)
  // THE CASE THIS EXISTS FOR: the 5xl band's 608px box against a ~500px cell,
  // i.e. a 4K window at 100%. Every cell used to be grid-m.
  check("at the 5xl band a portrait is grid-s and a landscape grid-m",
    tierForCellWidth(
      coverBindingEdge(500, AUTO_IMAGE_BOX_HEIGHT_5XL_PX, ...PORTRAIT), 1) === "grid-s"
      && tierForCellWidth(
        coverBindingEdge(500, AUTO_IMAGE_BOX_HEIGHT_5XL_PX, ...LANDSCAPE), 1) === "grid-m")
  // A SQUARE box has one binding edge whatever the picture is, which is what
  // makes the explicit cell size indifferent to this whole question.
  check("a square box binds on its own edge for either orientation",
    [140, 300, 512].every((w) =>
      coverBindingEdge(w, w, ...PORTRAIT) === w
        && coverBindingEdge(w, w, ...LANDSCAPE) === w
        && coverBindingEdge(w, w, 1000, 1000) === w))
  // EXCEPT BY ROUNDING: the explicit mode's box is `cellWidth x
  // Math.round(cellWidth)`, so at a fractional DPR the two edges can land on
  // opposite sides of a rung. Right, not a defect — the box really is 461 CSS
  // px tall — and this pins it so nobody "fixes" it into a square.
  check("an explicit 460.5px cell at DPR 1.25 splits on the rounded height",
    tierForCellWidth(
      coverBindingEdge(460.5, imageBoxHeightForCellWidth(460.5), ...PORTRAIT),
      1.25) === "grid-s"
      && tierForCellWidth(
        coverBindingEdge(460.5, imageBoxHeightForCellWidth(460.5), ...LANDSCAPE),
        1.25) === "grid-m",
    `edges ${coverBindingEdge(460.5, imageBoxHeightForCellWidth(460.5), ...PORTRAIT)}`
      + ` / ${coverBindingEdge(460.5, imageBoxHeightForCellWidth(460.5), ...LANDSCAPE)}`)
  // UNKNOWN DIMENSIONS ARE THE WORST CASE, which is the answer the grid gave
  // before it consulted the picture at all: a pre-backfill row has no shape to
  // reason from, and the direction that guesses is the one that paints a
  // blurry cell.
  check("unknown or unusable dimensions fall back to the worst case",
    [[null, null], [undefined, undefined], [0, 0], [NaN, 100], [100, -5]].every(
      ([w, h]) => coverBindingEdge(266, AUTO_IMAGE_BOX_HEIGHT_PX, w, h)
        === cellBoxBindingEdge(266, AUTO_IMAGE_BOX_HEIGHT_PX)))
  check("an unmeasured cell width still answers display, whatever the picture",
    tierForCellWidth(
      coverBindingEdge(0, AUTO_IMAGE_BOX_HEIGHT_PX, ...PORTRAIT), 1) === "display"
      && tierForCellWidth(
        coverBindingEdge(NaN, AUTO_IMAGE_BOX_HEIGHT_PX, ...LANDSCAPE), 1) === "display")
  check("an unusable box height falls back to the width, whatever the picture",
    coverBindingEdge(300, undefined, ...PORTRAIT) === 300
      && coverBindingEdge(300, 0, ...LANDSCAPE) === 300
      && coverBindingEdge(300, NaN, ...PORTRAIT) === 300)
  // The BOUNDARY: an image whose aspect exactly matches the box's covers both
  // edges at once, and either answer is the same picture. Taken as the
  // height, with the >= — the conservative side of a tie.
  check("an image of the box's own aspect binds on the height",
    coverBindingEdge(300, 600, 500, 1000) === 600)
  // An EXTREME-ASPECT item is asked about as its CROP (2:1 in the item's
  // orientation, the shape the cell actually paints), never as itself — see
  // SearchResultImage. A 800x20000 webtoon in an auto cell is a TALL crop, so
  // it binds on the width; the raw dimensions agree here, and would not in a
  // box more than twice as tall as it is wide.
  check("a strip's CROP binds like the crop, not like the strip",
    coverBindingEdge(266, AUTO_IMAGE_BOX_HEIGHT_PX, 1, EXTREME_ASPECT) === 266
      && coverBindingEdge(200, 500, 1, EXTREME_ASPECT) === 500
      && coverBindingEdge(200, 500, 800, 20000) === 200)
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
  // The bare URL now carries the DISPLAY REVISION (lib/utils.ts
  // DISPLAY_REVISION, docs/thumbnail-format-implementation.md §5): the old
  // display bytes were served `immutable` under an ETag with no format and no
  // geometry in it, so every browser that ever loaded one holds it at the
  // legacy URL for a year, and only a different URL can dislodge it.
  check("omitting the tier is the bare URL plus the display revision",
    getFileURL(dbs, "thumbnail", "sha256", "abc")
      === "/api/items/item/thumbnail?id=abc&id_type=sha256&index_db=stdtest&r=2",
    getFileURL(dbs, "thumbnail", "sha256", "abc"))
  check("a tier appends size=",
    getFileURL(dbs, "thumbnail", "sha256", "abc", "grid-s")
      === "/api/items/item/thumbnail?id=abc&id_type=sha256&index_db=stdtest&size=grid-s")
  check("grid-xs is a plain tier like the others",
    getFileURL(dbs, "thumbnail", "sha256", "abc", "grid-xs")
      === "/api/items/item/thumbnail?id=abc&id_type=sha256&index_db=stdtest&size=grid-xs")
  // The point of spelling `display` out (F4): it is a DIFFERENT URL from the
  // bare one, so a cache entry stamped before the tier work cannot answer it.
  check("an explicit display is a different URL from the bare one",
    getFileURL(dbs, "thumbnail", "sha256", "abc", "display")
      !== getFileURL(dbs, "thumbnail", "sha256", "abc"))
  check("no index_db still produces a well-formed URL",
    getFileURL({ index_db: null, user_data_db: null }, "thumbnail", "sha256", "abc", "grid-m")
      === "/api/items/item/thumbnail?id=abc&id_type=sha256&size=grid-m")
  check("still=true appends after the tier",
    getFileURL(dbs, "thumbnail", "sha256", "abc", "grid-m", true)
      === "/api/items/item/thumbnail?id=abc&id_type=sha256&index_db=stdtest&size=grid-m&still=true")
  check("a false still is the same URL as omitting it",
    getFileURL(dbs, "thumbnail", "sha256", "abc", "grid-m", false)
      === getFileURL(dbs, "thumbnail", "sha256", "abc", "grid-m"))
}

console.log("\n== the display revision (§5) ==")
{
  const dbs = { index_db: "stdtest", user_data_db: null }
  const url = (...args) => getFileURL(dbs, ...args)
  const carries = (u) => /[?&]r=2(&|$)/.test(u)
  // WHERE IT GOES: the display rendition, whether asked for by name or by
  // omission — those are the two spellings of the one request whose bytes this
  // release changes.
  check("the bare thumbnail URL carries it",
    carries(url("thumbnail", "sha256", "abc")), url("thumbnail", "sha256", "abc"))
  check("an explicit display carries it",
    carries(url("thumbnail", "sha256", "abc", "display")),
    url("thumbnail", "sha256", "abc", "display"))
  check("a display poster (still=true) carries it too",
    carries(url("thumbnail", "sha256", "abc", "display", true))
      && carries(url("thumbnail", "sha256", "abc", undefined, true)))
  check("a display request for a video's single frame carries it",
    carries(url("thumbnail", "sha256", "abc", undefined, false, false)))
  // WHERE IT MUST NOT GO, and this is the assertion the whole parameter turns
  // on: a grid tier's bytes are versioned inside its own ETag
  // (TIER_PROCESS_VERSION), so it needs no revision — and adding one would
  // move every grid URL in the app, costing a cold cache in the one surface
  // most sensitive to one. Byte-identical to the pre-revision build.
  for (const tier of ["grid-m", "grid-s", "grid-xs"]) {
    check(`${tier} URLs are byte-identical to before the revision existed`,
      !carries(url("thumbnail", "sha256", "abc", tier))
        && !carries(url("thumbnail", "sha256", "abc", tier, true))
        && !carries(url("thumbnail", "sha256", "abc", tier, false, false)),
      url("thumbnail", "sha256", "abc", tier, true, false))
  }
  // `file` serves the bytes on disk, which no release of this app changes.
  check("the original-file URL never carries it",
    !carries(url("file", "sha256", "abc")), url("file", "sha256", "abc"))
  // One value, one place. A call site that could pass its own would let two
  // surfaces disagree about the URL for the same item and stop sharing a
  // cache entry, which is exactly what PreviewSurface's note depends on.
  check("the revision is not a parameter any call site can vary",
    url("thumbnail", "sha256", "abc") === url("thumbnail", "sha256", "abc", undefined))
}

console.log("\n== does the picture move (F6) ==")
{
  // GIF: animated unless MEASURED still. NULL is "not measured", which is what
  // a pre-backfill row carries and what today's endpoint already treats as
  // animated (it serves every GIF as the original file).
  check("a GIF with no measured duration is animated",
    isAnimatedItem("image/gif", null) && isAnimatedItem("image/gif", undefined))
  check("a GIF measured at 0 is a still picture",
    !isAnimatedItem("image/gif", 0))
  check("a GIF with a positive duration is animated",
    isAnimatedItem("image/gif", 1.2))
  // WebP/AVIF: the opposite default. Most are stills, so only a measurement
  // moves them into the animated path.
  check("an unmeasured WebP is NOT animated",
    !isAnimatedItem("image/webp", null) && !isAnimatedItem("image/webp", undefined))
  check("a WebP measured at 0 is NOT animated",
    !isAnimatedItem("image/webp", 0))
  check("a measured WebP is animated",
    isAnimatedItem("image/webp", 1.199))
  check("AVIF follows the WebP rule, not the GIF one",
    !isAnimatedItem("image/avif", null) && isAnimatedItem("image/avif", 2))
  check("a mime parameter does not defeat the GIF prefix test",
    isAnimatedItem("image/gif; charset=binary", null))
  // Unmeasured stills, which is what nearly every PNG and JPEG row is.
  check("an unmeasured PNG or JPEG is not animated",
    !isAnimatedItem("image/png", null) && !isAnimatedItem("image/jpeg", null)
      && !isAnimatedItem("image/png", 0))
  // ...but a MEASURED one is, and deliberately so: this mirrors the backend's
  // `is_animated_image` verbatim, where every non-GIF image container follows
  // the measurement (APNG is a real animated PNG). The two sides answering
  // differently is what would make a stored rendition unreachable.
  check("a measured PNG follows the same rule as WebP (APNG)",
    isAnimatedItem("image/png", 3))
  check("a video item is not an animated picture",
    !isAnimatedItem("video/mp4", 30))
  check("a missing type is not animated",
    !isAnimatedItem(null, 3) && !isAnimatedItem(undefined, 3) && !isAnimatedItem("", 3))
  check("a non-finite duration cannot make a WebP animated",
    !isAnimatedItem("image/webp", NaN) && !isAnimatedItem("image/webp", Infinity))
}

console.log("\n== the raw floor (F6) ==")
{
  // The server's own numbers, as /api/client-config reports them. Passed in
  // rather than hardcoded anywhere in the UI — that is the point of the field.
  const floor = { maxFileSize: 1048576, maxSide: 512 }
  const above = (size, w, h) => isAboveAnimatedFloor(size, w, h, floor)
  // The floor is `bytes <= max AND both sides <= max`; clearing EITHER half
  // puts the item above it.
  check("at both limits exactly, the item is BELOW the floor",
    !above(1048576, 512, 512))
  check("one byte over the size limit clears it",
    above(1048577, 512, 512))
  check("one pixel over on either side clears it",
    above(1000, 513, 100) && above(1000, 100, 513))
  check("small in both is below it",
    !above(9793, 200, 150))
  // The dimension-free shortcut: past the size limit nothing else matters, so
  // a row with no dimensions is still settled.
  check("past the size limit, missing dimensions still answer above",
    above(4 * 1048576, null, null) && above(4 * 1048576, undefined, undefined))
  // ...and the genuinely unsettleable case answers the CONSERVATIVE way, which
  // animatedCellMode turns into a poster request rather than a <video>.
  check("within the size limit and with no dimensions, the answer is below",
    !above(1000, null, null) && !above(1000, 0, 0))
  check("an unknown size is never assumed above",
    !above(null, 9999, 9999) && !above(undefined, 9999, 9999) && !above(NaN, 9999, 9999))
  check("a non-finite dimension does not clear the floor",
    !above(1000, NaN, 100) && !above(1000, 100, Infinity))
  // No floor reported (an older Server, or the config still in flight) means
  // "no loops exist" — every animated item stays on the <img> path.
  check("no floor means nothing is above it",
    !isAboveAnimatedFloor(9e9, 9999, 9999, null)
      && !isAboveAnimatedFloor(9e9, 9999, 9999, undefined))
  // A floor the server could conceivably move: the assertions must follow the
  // reported numbers rather than a constant baked in on this side.
  check("the arithmetic follows the reported numbers, not constants",
    isAboveAnimatedFloor(2048, 100, 100, { maxFileSize: 1024, maxSide: 512 })
      && !isAboveAnimatedFloor(2048, 100, 100, { maxFileSize: 4096, maxSide: 512 }))
}

console.log("\n== what a grid cell renders (F6) ==")
{
  const floor = { maxFileSize: 1048576, maxSide: 512 }
  const mode = (item) => animatedCellMode(item, floor)
  // The case that must stay free: a static row leaves with "static", which is
  // today's <img> at today's URL.
  check("a PNG is static",
    mode({ type: "image/png", size: 58809, width: 800, height: 600 }) === "static")
  check("a video item is static",
    mode({ type: "video/mp4", duration: 30, size: 9e8, width: 1920, height: 1080 }) === "static")
  // The loop case: animated AND above the floor.
  check("a large GIF is a loop",
    mode({ type: "image/gif", duration: 1.2, size: 540046, width: 800, height: 600 }) === "loop")
  check("a measured WebP above the floor is a loop",
    mode({ type: "image/webp", duration: 1.199, size: 40410, width: 800, height: 600 }) === "loop")
  check("an above-floor GIF that is small in bytes is still a loop",
    mode({ type: "image/gif", duration: 1, size: 1472, width: 514, height: 260 }) === "loop")
  // Below the floor: the endpoint serves the original at every tier, so the
  // <img> path shows an animating GIF exactly as it does today. still=true is
  // documented as a no-op there, which is what lets one flag cover this and
  // the ambiguous case below.
  check("a below-floor GIF asks for the still (a no-op that serves the raw file)",
    mode({ type: "image/gif", duration: 0.51, size: 9793, width: 200, height: 150 }) === "still")
  // The ambiguous row: animated, within the size limit, no dimensions. Never
  // a <video>, because the bytes might not be one.
  check("an animated row with no dimensions asks for the still",
    mode({ type: "image/gif", duration: null, size: 1000 }) === "still")
  check("an animated row with no size asks for the still",
    mode({ type: "image/gif", duration: 2, width: 4000, height: 3000 }) === "still")
  // ...but a row over the size limit needs no dimensions to be settled.
  check("a huge animated row with no dimensions is still a loop",
    mode({ type: "image/gif", duration: 4, size: 8 * 1048576 }) === "loop")
  // A measured-still GIF is a static card, not a poster request: it has no
  // loop and no animation, so it is an ordinary image.
  check("a GIF measured as still is a static card",
    mode({ type: "image/gif", duration: 0, size: 540046, width: 800, height: 600 }) === "static")
  // With no floor (older Server / config in flight) nothing is ever a loop,
  // and the animated rows fall back to the safe still request.
  check("with no floor an animated item is a still, never a loop",
    animatedCellMode({ type: "image/gif", duration: 1.2, size: 540046, width: 800, height: 600 }, null)
      === "still")
  check("with no floor a static item is still static",
    animatedCellMode({ type: "image/png", size: 1, width: 1, height: 1 }, null) === "static")
  // THE PERMISSIVE HOLE, asserted so it stays visible. A row that has not
  // resolved its metadata yet and defaults its `type` to a placeholder answers
  // "static" — a BARE grid-tier URL — for what may well be an animated item
  // above the floor, and the endpoint answers that with `video/mp4` into an
  // `<img>`. Unlike every other field here, an absent type has NO safe default:
  // guessing animated would send `still=true` for every non-image row on earth,
  // and guessing static is the blank cell this asserts. The fix belongs at the
  // call site and it is to wait, which is what
  // components/sidebar/options/itemSimilarity/similarityTarget.tsx now does —
  // a skeleton until its item query answers for the target's own sha.
  check("an unknown type answers static — permissively, hence the V1 gating",
    mode({ type: "unknown", duration: 1.2, size: 540046, width: 800, height: 600 }) === "static")
  check("an empty type answers static for the same reason",
    mode({ type: "", duration: 1.2, size: 540046, width: 800, height: 600 }) === "static")
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
  // THE GRID READS `cs` THROUGH THIS CLAMP, and that is what keeps a
  // hand-edited URL from rendering an empty page: an out-of-range target
  // reaches `columnsForCellWidth` as 0 columns, which is indistinguishable
  // from "not measured yet" — no cells, no skeletons, no scroll space.
  for (const hostile of [0, -5, -1e9, NaN, 0.4]) {
    const clamped = clampCellWidth(hostile)
    check(
      `a hostile ?cs=${hostile} still lays out columns`,
      columnsForCellWidth(2473, clamped, GRID_GAP_PX) >= 1,
      `clamped to ${clamped}`
    )
  }
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

console.log("\n== the co-write snaps to whole rows (design §4's row invariant) ==")
{
  // The bar highlights the top row's LAST item while the URL anchor records
  // its FIRST, so the two name the same virtual page only while no row
  // straddles a k-boundary — i.e. while k is a multiple of the column count.
  // Every co-written page size must therefore be one.
  for (const columns of [1, 2, 3, 5, 7, 9, 12, 17, 24, 49]) {
    for (const [size, prev, next] of [
      [10, 584, 292], [10, 584, 140], [50, 300, 700], [7, 400, 401],
      [100, 250, 1000], [3, 1200, 140], [10, 742, 207],
    ]) {
      const k = coWrittenPageSize(size, prev, next, columns)
      if (k === null) continue
      if (!check(
        `k=${k} is a whole number of ${columns}-wide rows (${size} @ ${prev}->${next})`,
        k % columns === 0 && k >= columns,
        `${k} % ${columns} = ${k % columns}`
      )) break
    }
  }
  // The rounding is a snap, not a redefinition: it stays within half a row of
  // the (prev/next)^2 intent.
  for (const columns of [3, 5, 9, 17]) {
    const exact = 10 * (584 / 207) ** 2
    const k = coWrittenPageSize(10, 584, 207, columns)
    check(
      `the ${columns}-column snap stays within half a row of the intent`,
      Math.abs(k - exact) <= columns / 2 + 1e-9,
      `${k} vs ${exact.toFixed(2)}`
    )
  }
  check("at least one whole row survives an extreme enlargement",
    coWrittenPageSize(2, MIN_CELL_WIDTH, MAX_CELL_WIDTH, 9) === 9)
  check("the ceiling is still a whole number of rows",
    coWrittenPageSize(9000, 1200, 140, 7) === Math.floor(10000 / 7) * 7)
  // The verifier's own case: 5 columns, a co-written 38 was the misalignment.
  check("the k=38-over-9-columns straddle cannot be written any more",
    coWrittenPageSize(10, 584, 292, 9) % 9 === 0)
  // An unusable column count is the pre-existing unrounded answer, not a crash.
  check("no column count falls back to the unrounded clamp",
    coWrittenPageSize(10, 400, 200, 0) === 40
      && coWrittenPageSize(10, 400, 200, NaN) === 40
      && coWrittenPageSize(10, 400, 200, -3) === 40)
}

// ---- the pin button's record algebra ------------------------------------
//
// Pinboard records are a FLAT array of five strings per pin
// ([sha256, x, y, w, hField]), so every removal is a splice of five at an
// offset that is an index times five. That arithmetic used to live inline in
// CellActionsHost with no way to reach it; these are the cases it can get
// wrong, all of which corrupt the whole board rather than one pin.

{
  const sha = (n) => `${n}`.repeat(64).slice(0, 64)
  const A = sha(1), B = sha(2), C = sha(3)
  const rec = (s, x, y, w, h) =>
    [s.slice(0, 10), `${x}`, `${y}`, `${w}`, `${h}`]
  const board = [...rec(A, 0, 0, 5, 5), ...rec(B, 5, 0, 5, 5), ...rec(C, 0, 5, 5, 5)]
  const opts = { galleryTrim: null }

  check("unpinning the FIRST pin splices the right five fields",
    togglePinRecords(board, V2_GRID, A, opts).join(",")
      === [...rec(B, 5, 0, 5, 5), ...rec(C, 0, 5, 5, 5)].join(","),
    togglePinRecords(board, V2_GRID, A, opts).join(","))

  check("unpinning a MIDDLE pin leaves its neighbours intact",
    togglePinRecords(board, V2_GRID, B, opts).join(",")
      === [...rec(A, 0, 0, 5, 5), ...rec(C, 0, 5, 5, 5)].join(","),
    togglePinRecords(board, V2_GRID, B, opts).join(","))

  check("unpinning the LAST pin splices off the end",
    togglePinRecords(board, V2_GRID, C, opts).join(",")
      === [...rec(A, 0, 0, 5, 5), ...rec(B, 5, 0, 5, 5)].join(","),
    togglePinRecords(board, V2_GRID, C, opts).join(","))

  // The record stores a PREFIX, and the caller passes a full hash. Matching
  // has to happen on the prefix at both ends or nothing is ever found pinned.
  check("a full sha256 matches the stored prefix",
    togglePinRecords(board, V2_GRID, A, opts).length === 10)

  // Every record survives a toggle intact — a splice off by one would shift
  // every following field by one position and scramble the board.
  {
    const out = togglePinRecords(board, V2_GRID, B, opts)
    check("no record is left straddling a five-field boundary",
      out.length % 5 === 0 && out[0] === A.slice(0, 10) && out[5] === C.slice(0, 10),
      out.join(","))
  }
}

{
  const A = "a".repeat(64), B = "b".repeat(64)
  const opts = { galleryTrim: null }
  // Duplicates of one image are ordinary, so a board-bound unpin removes the
  // record at its OWN offset rather than the first prefix match. The layout
  // key's leading field is that offset.
  const dupes = [
    "aaaaaaaaaa", "0", "0", "5", "5",
    "aaaaaaaaaa", "5", "0", "5", "5",
    "aaaaaaaaaa", "0", "5", "5", "5",
  ]
  const out = togglePinRecords(dupes, V2_GRID, A, { ...opts, layoutKey: "5-x" })
  check("a layout key removes THAT copy, not the first prefix match",
    out.length === 10 && out[1] === "0" && out[6] === "0" && out[7] === "5",
    out.join(","))
  check("without a layout key the FIRST copy goes",
    togglePinRecords(dupes, V2_GRID, A, opts).slice(0, 5).join(",")
      === "aaaaaaaaaa,5,0,5,5",
    togglePinRecords(dupes, V2_GRID, A, opts).slice(0, 5).join(","))

  // A new pin appends exactly five fields, storing the prefix and a plain
  // integer h field (no trim in force).
  const added = togglePinRecords(dupes, V2_GRID, B, opts)
  check("pinning a new item appends exactly one five-field record",
    added.length === dupes.length + 5
      && added.slice(0, dupes.length).join(",") === dupes.join(",")
      && added[dupes.length] === "bbbbbbbbbb",
    added.slice(dupes.length).join(","))
  check("a new pin's h field is a bare integer without a trim",
    /^[0-9]+$/.test(added[added.length - 1]),
    added[added.length - 1])
  // 10x10 v1 units scaled onto the target lattice: V1 is the identity, and a
  // wider grid gets proportionally more columns.
  const onV1 = togglePinRecords([], V1_GRID, B, opts)
  check("a first pin on the v1 grid is 10x10 at the origin",
    onV1.join(",") === "bbbbbbbbbb,0,0,10,10", onV1.join(","))
  const onV2 = togglePinRecords([], V2_GRID, B, opts)
  check("the default size scales onto the board's own lattice",
    Number(onV2[3]) === Math.round(10 * (V2_GRID.columns / V1_GRID.columns)),
    onV2.join(","))
}

console.log(all ? "\nALL PASS" : "\nFAILURES")
process.exit(all ? 0 : 1)
