// Assertions for the GRID PLACEHOLDER RUNG: what a card paints while its
// picture is in flight, which is a per-tier choice (`placeholderForTier`,
// lib/thumbnailTier.ts) applied by one switch (`cellPlaceholder`,
// lib/state/blurHashDataURL.ts) — plus the raster cache that has to keep the
// rungs apart, and the module-scope date formatter, the other half of the same
// measured fix.
//
// The measurement behind the ladder, all over the same fixed 32,100 px / 8 s
// scroll at `cs=140` on a 4K viewport (~330 cell mounts/s), each against the
// 32x32 raster the whole grid used to pay: 8x8 took script -44%; `"none"` took
// script -62%, task -38% and style -61%; `"colour"` is within noise of `"none"`
// on script and costs it +5% of task and +263 ms of style recalc. The profile
// that started it charged 36% of all busy JS to the placeholder and 4-5% to
// `getLocale`. No test runner in this repo — run it from the ui root:
//
//   node --experimental-strip-types scripts/blurplaceholder.test.mjs
//
// The tier ladder itself, the cell-size slider and the pin algebra are
// scripts/gridcells.test.mjs's; the thumbnail URLs the tier feeds are
// scripts/thumbnailurl.test.mjs's. Nothing about the placeholder is asserted
// in either — this file is the whole of it.
//
// `placeholderForTier` is pure and lives next to the tier ladder it rides, so
// it executes under plain node. `cellPlaceholder` and `blurHashToDataURL` are
// not import-free — they pull the `blurhash` package — but that package is
// plain ESM with no DOM in it, so node loads it and the encoder runs here
// exactly as it does in a browser (it already prefers `Buffer` over `btoa` for
// the base64 step). That is what lets the CACHE be asserted rather than
// described.
//
// WHAT THIS FILE CANNOT REACH: the WIRING. `CellStillImage` and the strip's
// `StripCardImage` live in .tsx files that import React and next/image,
// neither of which resolves outside a bundler, so "the colour goes on the
// <img> and not into next/image's `placeholder` prop" and "next/image really
// calls our onLoad" are not asserted here. Everything those two branches key
// on IS: the rung, the switch, `isPlaceholderColour` over the whole union, and
// `clearPlaceholderColour` itself, which takes a plain `{currentTarget}` and
// so runs under node. The residue needing a BROWSER is named in the section
// below.
//
// Exits non-zero on failure.

import { createChecker } from "./harness.mjs"
import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  TIER_LADDER,
  TIER_PLACEHOLDER_RUNG,
  TIER_SHORT_SIDE,
  placeholderForTier,
  tierForCellWidth,
} = await import("../lib/thumbnailTier.ts")
const {
  blurHashAverageColour,
  blurHashToDataURL,
  cellPlaceholder,
  clearPlaceholderColour,
  isPlaceholderColour,
} = await import("../lib/state/blurHashDataURL.ts")
const { decode } = await import("blurhash")
const { getLocale } = await import("../lib/utils.ts")

const { check, finish } = createChecker()

// Real 4x3-component hashes. Base83 never contains ":", which is what makes
// the "<size>:" cache-key prefix unambiguous.
const HASH = "LEHV6nWB2yk8pyo0adR*.7kCMdnj"
const HASH_B = "L6PZfSi_.AyE_3t7t7R**0o#DgR4"
const HASH_C = "LKO2?U%2Tw=w]~RBVZRi};RPxuwH"
const HASH_D = "LlMF%n00%#MwS|WCWEM{R*bbWBbH"

/** The raw PNG bytes behind a `data:image/png;base64,...` value. */
function pngBytes(dataURL) {
  const marker = "data:image/png;base64,"
  if (!dataURL?.startsWith(marker)) return null
  return Buffer.from(dataURL.slice(marker.length), "base64")
}

/** `[width, height]` out of a PNG's IHDR, or null if it is not a PNG. */
function pngDims(dataURL) {
  const bytes = pngBytes(dataURL)
  if (!bytes || bytes.length < 24) return null
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return null
  }
  // Bytes 12..15 are the chunk type; IHDR's width and height are the two
  // big-endian u32s that follow it.
  if (bytes.toString("latin1", 12, 16) !== "IHDR") return null
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

console.log("\n== the ladder: which rung each tier takes ==")
{
  // THE DECISION, spelled as the assertion. `grid-xs` takes the cheap rung and
  // not `"none"` deliberately: it measured within noise of `"none"` on script
  // and costs it +5% of task, and it is the only rung that shows anything at
  // all when the pictures are genuinely late.
  check(
    "grid-xs paints the average colour, grid-s 16x16, grid-m and display 32x32",
    placeholderForTier("grid-xs") === "colour"
      && placeholderForTier("grid-s") === 16
      && placeholderForTier("grid-m") === 32
      && placeholderForTier("display") === 32,
    JSON.stringify(TIER_PLACEHOLDER_RUNG)
  )
  check(
    "an UNKNOWN tier answers the full 32, the conservative direction",
    placeholderForTier(undefined) === 32
  )
  check(
    "every tier the ladder names has a rung — no tier falls through",
    [...TIER_LADDER, "display"].every(
      (tier) => TIER_PLACEHOLDER_RUNG[tier] !== undefined
    )
  )
  // The contract both call sites rely on THROUGH `cellPlaceholder`: a rung is
  // either a raster size or one of the two no-decode words, and nothing else
  // may ever be returned.
  const rungs = [...TIER_LADDER, "display", undefined].map(placeholderForTier)
  check(
    "every rung is a number or one of the two no-decode words",
    rungs.every((r) => typeof r === "number" || r === "none" || r === "colour"),
    rungs.join(",")
  )
  // The ladder's shape: cost may only go UP as the cell gets bigger. A cheap
  // word sorts below every raster.
  const weight = (rung) =>
    typeof rung === "number" ? rung : rung === "colour" ? 1 : 0
  check(
    "the rung never shrinks as the tier grows (monotone with the ladder)",
    TIER_LADDER.every((tier, i) =>
      i === 0
        ? true
        : weight(TIER_PLACEHOLDER_RUNG[tier])
          >= weight(TIER_PLACEHOLDER_RUNG[TIER_LADDER[i - 1]])
    ),
    TIER_LADDER.map((t) => `${t}=${TIER_PLACEHOLDER_RUNG[t]}`).join(" ")
  )
  check(
    "a raster rung is at least 32x smaller than its tier's own short side — " +
      "the placeholder is an upscale by construction, so its resolution is free",
    TIER_LADDER.every((tier) => {
      const rung = TIER_PLACEHOLDER_RUNG[tier]
      return typeof rung !== "number" || rung * 32 <= TIER_SHORT_SIDE[tier]
    })
  )
}

console.log("\n== what the two call sites' boxes actually land on ==")
{
  // The result grid at the size slider's 140px minimum — the case the whole
  // measurement was taken at. Any dpr from 1 to 2 stays inside grid-xs.
  check(
    "a 140px grid cell takes the colour rung at dpr 1, 1.25 and 2",
    [1, 1.25, 2].every(
      (dpr) => placeholderForTier(tierForCellWidth(140, dpr)) === "colour"
    )
  )
  // The gallery strip's fixed box: STRIP_CARD_CSS_BINDING_EDGE = 320.
  check(
    "the strip's 320px binding edge asks for 16x16 at dpr 1 and 32x32 at dpr 2",
    placeholderForTier(tierForCellWidth(320, 1)) === 16
      && placeholderForTier(tierForCellWidth(320, 2)) === 32
  )
  // ...but it is NOT out of the colour rung's reach, which is why the strip
  // carries the paint and the clear rather than treating them as the grid's
  // private business: a zoomed-out browser drops the device pixel ratio below
  // 1 and 320 CSS px stops binding 256 device px.
  check(
    "a zoomed-out browser (dpr <= 0.85) does put the strip on the colour rung",
    [0.67, 0.75, 0.85].every(
      (dpr) => placeholderForTier(tierForCellWidth(320, dpr)) === "colour"
    )
  )
  check(
    "a large grid cell (slider >= 600) keeps the full 32x32",
    placeholderForTier(tierForCellWidth(600, 1.25)) === 32
      && placeholderForTier(tierForCellWidth(900, 1)) === 32
  )
}

console.log("\n== the switch: cellPlaceholder applies a rung, once ==")
{
  // THE SHORT-CIRCUIT IS THE POINT. A cheap rung must never build a raster —
  // a caller that decoded first and discarded would have bought nothing — and
  // this is the single place both call sites go through, so asserting it here
  // covers both.
  const colour = cellPlaceholder(HASH, "colour")
  check(
    "the colour rung answers a bare rgb() and NOT a data URL",
    isPlaceholderColour(colour) && pngBytes(colour) === null,
    String(colour)
  )
  check(
    "the colour rung's answer is the DC term itself",
    colour === blurHashAverageColour(HASH)
  )
  check(
    "the none rung answers nothing at all",
    cellPlaceholder(HASH, "none") === undefined
  )
  for (const size of [8, 16, 32]) {
    const url = cellPlaceholder(HASH, size)
    if (
      !check(
        `a numeric rung (${size}) answers that hash's PNG at ${size}x${size}`,
        !isPlaceholderColour(url)
          && JSON.stringify(pngDims(url)) === `[${size},${size}]`,
        `IHDR ${pngDims(url)?.join("x") ?? "not a PNG"}`
      )
    ) break
  }
  check(
    "no hash is no placeholder, at every rung",
    ["none", "colour", 8, 16, 32].every(
      (rung) =>
        cellPlaceholder(undefined, rung) === undefined
        && cellPlaceholder("", rung) === undefined
    )
  )
}

console.log("\n== the two forms are told apart totally (isPlaceholderColour) ==")
{
  // This predicate is what the paint/clear branch in CellStillImage keys on:
  // true means "an inline background-color, and clear it on load", false means
  // "hand it to next/image's placeholder prop". A wrong answer either way is a
  // silent garbage background in a production build (next/image validates the
  // prop only in dev), so it is asserted over every value the union can hold
  // rather than spot-checked.
  const colours = [HASH, HASH_B, HASH_C, HASH_D].map(blurHashAverageColour)
  const rasters = [8, 16, 32].map((s) => blurHashToDataURL(HASH, s))
  check(
    "every DC colour is recognised as a colour",
    colours.every(isPlaceholderColour),
    colours.join(" ")
  )
  check(
    "no PNG data URL is ever mistaken for a colour",
    rasters.every((url) => !isPlaceholderColour(url))
  )
  check("undefined is not a colour", !isPlaceholderColour(undefined))
}

console.log("\n== the colour is dropped when the picture paints ==")
{
  // WHY IT HAS TO BE: the stored WebP tier keeps an alpha channel, so a colour
  // left standing behind a transparent thumbnail shows through it forever.
  //
  // The clear is a DIRECT STYLE WRITE on the element next/image hands to
  // `onLoad` (`currentTarget`, which next/image sets to the <img> itself — see
  // handleLoading in next/dist/client/image-component.js) rather than a state
  // change, so it costs no re-render at ~330 mounts/s. What can be asserted
  // outside a browser is exactly that: the handler is total over "an object
  // with a currentTarget that has a style", writes only backgroundColor, and
  // is ONE module-scope function shared by both surfaces rather than a closure
  // minted per cell.
  //
  // NEEDS A BROWSER: that next/image really fires it (it does so only after
  // `decode()` resolves and only while the element is still connected), and
  // that the tint is visibly gone behind a transparent PNG afterwards.
  const el = { style: { backgroundColor: "rgb(1,2,3)", opacity: "0.5" } }
  clearPlaceholderColour({ currentTarget: el })
  check(
    "the handler clears the background colour it was painted with",
    el.style.backgroundColor === ""
  )
  check(
    "...and touches nothing else on the element's style",
    el.style.opacity === "0.5"
  )
  check(
    "clearing an already-clear element is a no-op, not a throw",
    (() => {
      const clean = { style: { backgroundColor: "" } }
      clearPlaceholderColour({ currentTarget: clean })
      return clean.style.backgroundColor === ""
    })()
  )
  check(
    "it is one shared function — both surfaces pass the same reference",
    typeof clearPlaceholderColour === "function"
      && clearPlaceholderColour === clearPlaceholderColour
  )
}

console.log("\n== the DC-term average colour (blurHashAverageColour) ==")
{
  // sRGB <-> linear, the two conversions blurhash's own decoder uses. The DC
  // term is the image's average in LINEAR light, stored already sRGB-encoded —
  // so the oracle is the linear-space mean of a decoded raster, not the mean of
  // its sRGB bytes.
  const s2l = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
  const l2s = (v) => { const c = Math.max(0, Math.min(1, v)); return Math.round(c <= 0.0031308 ? c * 12.92 * 255 + 0.5 : (1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255 + 0.5) }
  for (const hash of [HASH, HASH_B, HASH_C, HASH_D]) {
    // 128x128 rather than something smaller: the DC is the CONTINUOUS mean of
    // the basis functions, and a discrete raster mean only converges to it —
    // a 32x32 sample is off by up to 3 on a hash with strong AC terms.
    const N = 128
    const px = decode(hash, N, N)
    let r = 0, g = 0, b = 0
    for (let i = 0; i < N * N; i++) { r += s2l(px[i * 4]); g += s2l(px[i * 4 + 1]); b += s2l(px[i * 4 + 2]) }
    const n = N * N
    const mine = blurHashAverageColour(hash)
    const parsed = mine.slice(4, -1).split(",").map(Number)
    const oracle = [l2s(r / n), l2s(g / n), l2s(b / n)]
    // +/-1 per channel: the oracle rounds a 16,384-sample mean through two
    // transcendental conversions, the rung reads the stored integer directly.
    if (!check(`${hash.slice(0, 8)}… DC matches the decoded linear mean`,
      parsed.every((v, i) => Math.abs(v - oracle[i]) <= 1),
      `${mine} vs rgb(${oracle.join(",")})`)) break
  }
  check("a colour is a bare CSS rgb() triple",
    /^rgb\(\d{1,3},\d{1,3},\d{1,3}\)$/.test(blurHashAverageColour(HASH)),
    blurHashAverageColour(HASH))
  // Malformed input paints the cell's own background rather than a wrong
  // colour: no hash, too short to hold a DC, and a DC with a character outside
  // base83 (space and backslash are the two the alphabet omits).
  check("no hash has no colour", blurHashAverageColour(undefined) === undefined)
  check("a hash too short to hold a DC has no colour",
    blurHashAverageColour("LEHV6") === undefined)
  check("a non-base83 character in the DC has no colour",
    blurHashAverageColour("LE V6nWB2yk8pyo0adR*.7kCMdnj") === undefined)
}

console.log("\n== the encoder honours the requested size ==")
{
  for (const size of [8, 16, 32]) {
    const url = blurHashToDataURL(HASH, size)
    const dims = pngDims(url)
    check(
      `size ${size} produces a valid PNG whose IHDR says ${size}x${size}`,
      dims !== null && dims[0] === size && dims[1] === size,
      `IHDR ${dims ? dims.join("x") : "not a PNG"}, ${pngBytes(url)?.length} bytes`
    )
  }
  check(
    "no hash is still no placeholder",
    blurHashToDataURL(undefined, 8) === undefined
      && blurHashToDataURL("", 8) === undefined
  )
  // The memory claim in the cache's own doc comment, kept honest.
  const bytes = [8, 16, 32].map((s) => blurHashToDataURL(HASH, s).length)
  check(
    "an 8x8 entry is an order of magnitude smaller than a 32x32 one",
    bytes[0] * 8 < bytes[2],
    `data URL chars at 8/16/32: ${bytes.join(" / ")}`
  )
}

console.log("\n== the cache is keyed by hash AND size ==")
{
  const small = blurHashToDataURL(HASH, 8)
  const large = blurHashToDataURL(HASH, 32)
  check(
    "the same hash at two sizes yields two DIFFERENT data URLs",
    small !== large
  )
  check(
    "...and each is a valid PNG carrying its OWN dimensions — neither " +
      "entry was served from the other's cache slot",
    JSON.stringify(pngDims(small)) === "[8,8]"
      && JSON.stringify(pngDims(large)) === "[32,32]"
  )
  check(
    "a repeat call at each size returns the cached value, identical to the first",
    blurHashToDataURL(HASH, 8) === small
      && blurHashToDataURL(HASH, 32) === large
  )
  // Interleave the two sizes: a hash-only key would have the second size
  // evict/overwrite the first on every alternation. The result grid and the
  // gallery strip sit on the same page at different card sizes, so this is a
  // real sequence rather than a synthetic one.
  const interleaved = [8, 32, 8, 32, 8].map((s) => blurHashToDataURL(HASH, s))
  check(
    "alternating sizes never contaminate each other",
    interleaved.every((url, i) => url === (i % 2 === 0 ? small : large))
  )
  check(
    "different hashes at the same size stay distinct",
    new Set([
      blurHashToDataURL(HASH, 16),
      blurHashToDataURL(HASH_B, 16),
      blurHashToDataURL(HASH_C, 16),
    ]).size === 3
  )
}

console.log("\n== the LRU still evicts ==")
{
  // The cache is module-private, so residency is not directly observable. It is
  // observable through TIME: a hit is a `Map.get`, a miss is a blurhash decode
  // plus a PNG encode, and even at the cheapest raster rung that is tens of
  // microseconds against well under one. Two batches of 200 DISTINCT hashes
  // each — never 200 reads of one hash, which would recompute once and then
  // hit 199 times and measure nothing — separate the two by two orders of
  // magnitude, so the 5x threshold below is not a tuned number.
  //
  // Distinct valid hashes come from rewriting the last four base83 payload
  // digits of a known-good 4x3 hash: the leading size and DC digits are what
  // the decoder validates, the AC digits are free, and 83^4 is 47 million
  // variants — far more than the flood needs.
  const DIGITS =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~"
  const variant = (n) => {
    const head = HASH.slice(0, HASH.length - 4)
    let tail = ""
    let v = n
    for (let i = 0; i < 4; i++) {
      tail = DIGITS[v % 83] + tail
      v = Math.floor(v / 83)
    }
    return head + tail
  }
  check(
    "the generated variants really are decodable hashes",
    pngDims(blurHashToDataURL(variant(1), 8))?.[0] === 8
  )

  const timeOf = (fn) => {
    const t0 = process.hrtime.bigint()
    fn()
    return Number(process.hrtime.bigint() - t0) / 1e6
  }
  const readRange = (from, to) => {
    for (let i = from; i < to; i++) blurHashToDataURL(variant(i), 8)
  }

  // Flood well past any plausible cap. If the cache were unbounded every one of
  // these would still be resident afterwards.
  const FLOOD = 4096
  readRange(0, FLOOD)

  // Newest 200 first (they must not have been evicted by anything), oldest 200
  // second (they must have been, by the flood that followed them).
  const hotMs = timeOf(() => readRange(FLOOD - 200, FLOOD))
  const coldMs = timeOf(() => readRange(0, 200))
  check(
    "200 of the NEWEST flooded hashes are hits and 200 of the OLDEST are " +
      "misses — the LRU evicted from the front, so the cache is bounded",
    coldMs > hotMs * 5,
    `200 distinct reads: newest ${hotMs.toFixed(2)}ms, oldest ${coldMs.toFixed(2)}ms`
  )
  check(
    "...and reading them put them BACK, so the same 200 are now hits too",
    timeOf(() => readRange(0, 200)) * 5 < coldMs,
    `re-read ${timeOf(() => readRange(0, 200)).toFixed(2)}ms`
  )
  check(
    "an evicted entry recomputes to the identical data URL",
    blurHashToDataURL(variant(3000), 8) === blurHashToDataURL(variant(3000), 8)
  )
  check(
    "eviction is per KEY, not per hash: the 32x32 form of a hash that only " +
      "ever existed at 8x8 is computed at 32x32",
    JSON.stringify(pngDims(blurHashToDataURL(variant(0), 32))) === "[32,32]"
  )
}

console.log("\n== getLocale is unchanged output ==")
{
  // The form getLocale had before the module-scope formatter, spelled out here
  // so the assertion does not read the implementation it is checking.
  const OPTIONS = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }
  const old = (date) => date.toLocaleString("en", OPTIONS)
  const DATES = [
    "2026-09-03T14:07:00Z",
    "1999-12-31T23:59:00Z",
    "2000-01-01T00:00:00Z",
    "2024-02-29T12:30:00Z",
    "1970-01-01T00:00:00Z",
    "2026-07-04T09:05:00Z",
  ]
  let allMatch = true
  for (const iso of DATES) {
    const date = new Date(iso)
    const got = getLocale(date)
    const want = old(date)
    if (
      !check(
        `${iso} formats identically to the old toLocaleString`,
        got === want,
        `${got} vs ${want}`
      )
    ) {
      allMatch = false
      break
    }
  }
  check("every fixed date matched", allMatch)
  check(
    "the formatter is reused, not rebuilt — repeated calls agree",
    getLocale(new Date(DATES[0])) === getLocale(new Date(DATES[0]))
  )
}

finish()
