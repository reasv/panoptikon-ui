// Assertions for the BLUR PLACEHOLDER RUNG: which square raster a card's
// thumbnail tier asks the blurhash to be decoded at, and the cache that has to
// keep the rungs apart. The profiling that motivated it charged 36% of all busy
// JS during a 140px-cell scroll to this one placeholder. No test runner in this
// repo — run it from the ui root:
//
//   node --experimental-strip-types scripts/blurplaceholder.test.mjs
//
// `placeholderSizeForTier` is pure and lives next to the tier ladder it rides,
// so it executes under plain node like the rest of lib/thumbnailTier.ts.
// `blurHashToDataURL` is not import-free — it pulls the `blurhash` package —
// but that package is plain ESM with no DOM in it, so node loads it and the
// encoder runs here exactly as it does in a browser (it already prefers
// `Buffer` over `btoa` for the base64 step). That is what lets the CACHE be
// asserted rather than described.
//
// Exits non-zero on failure.

import { createChecker } from "./harness.mjs"
import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  TIER_LADDER,
  TIER_PLACEHOLDER_SIZE,
  TIER_SHORT_SIDE,
  placeholderSizeForTier,
  tierForCellWidth,
} = await import("../lib/thumbnailTier.ts")
const { blurHashToDataURL } = await import("../lib/state/blurHashDataURL.ts")

const { check, finish } = createChecker()

// A real 4x3-component hash, and a couple of others so the LRU has distinct
// keys to walk. Base83 never contains ":", which is what makes the "<size>:"
// key prefix unambiguous.
const HASH = "LEHV6nWB2yk8pyo0adR*.7kCMdnj"
const HASH_B = "L6PZfSi_.AyE_3t7t7R**0o#DgR4"
const HASH_C = "LKO2?U%2Tw=w]~RBVZRi};RPxuwH"

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

console.log("\n== the tier -> raster mapping ==")
{
  check(
    "grid-xs decodes at 8, grid-s at 16, grid-m and display at 32",
    placeholderSizeForTier("grid-xs") === 8
      && placeholderSizeForTier("grid-s") === 16
      && placeholderSizeForTier("grid-m") === 32
      && placeholderSizeForTier("display") === 32,
    JSON.stringify(TIER_PLACEHOLDER_SIZE)
  )
  check(
    "an UNKNOWN tier answers the full 32, the conservative direction",
    placeholderSizeForTier(undefined) === 32
  )
  check(
    "every tier the ladder names has a rung — no tier falls through",
    [...TIER_LADDER, "display"].every(
      (tier) => TIER_PLACEHOLDER_SIZE[tier] !== undefined
    )
  )
  check(
    "the rung never grows as the tier shrinks (monotone with the ladder)",
    TIER_LADDER.every((tier, i) =>
      i === 0
        ? true
        : TIER_PLACEHOLDER_SIZE[tier] >= TIER_PLACEHOLDER_SIZE[TIER_LADDER[i - 1]]
    ),
    TIER_LADDER.map((t) => `${t}=${TIER_PLACEHOLDER_SIZE[t]}`).join(" ")
  )
  check(
    "the raster is never larger than the tier's own short side — an 8x8 " +
      "placeholder is upscaled at least 32x inside a grid-xs box",
    TIER_LADDER.every(
      (tier) => TIER_PLACEHOLDER_SIZE[tier] * 32 <= TIER_SHORT_SIDE[tier]
    )
  )
}

console.log("\n== what the two call sites' boxes actually land on ==")
{
  // The result grid at the size slider's 140px minimum — the case the whole
  // measurement was taken at. Any dpr from 1 to 2 stays inside grid-xs.
  check(
    "a 140px grid cell asks for 8x8 at dpr 1, 1.25 and 2",
    [1, 1.25, 2].every(
      (dpr) => placeholderSizeForTier(tierForCellWidth(140, dpr)) === 8
    )
  )
  // The gallery strip's fixed box: STRIP_CARD_CSS_BINDING_EDGE = 320.
  check(
    "the strip's 320px binding edge asks for 16x16 at dpr 1 and 32x32 at dpr 2",
    placeholderSizeForTier(tierForCellWidth(320, 1)) === 16
      && placeholderSizeForTier(tierForCellWidth(320, 2)) === 32
  )
  check(
    "a large grid cell (slider >= 600) keeps the full 32x32",
    placeholderSizeForTier(tierForCellWidth(600, 1.25)) === 32
      && placeholderSizeForTier(tierForCellWidth(900, 1)) === 32
  )
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
  // evict/overwrite the first on every alternation.
  const interleaved = [8, 32, 8, 32, 8].map((s) => blurHashToDataURL(HASH, s))
  check(
    "alternating sizes never contaminate each other",
    interleaved.every((url, i) => url === (i % 2 === 0 ? small : large))
  )
  check(
    "different hashes at the same size stay distinct",
    new Set([
      blurHashToDataURL(HASH, 8),
      blurHashToDataURL(HASH_B, 8),
      blurHashToDataURL(HASH_C, 8),
    ]).size === 3
  )
}

console.log("\n== the LRU still evicts ==")
{
  // The cache is module-private, so residency is not directly observable. It is
  // observable through TIME: a hit is a `Map.get`, a miss is a blurhash decode
  // plus a PNG encode, and even at the cheapest 8x8 rung that is ~21 µs against
  // well under a microsecond. Two batches of 200 DISTINCT hashes each — never
  // 200 reads of one hash, which would recompute once and then hit 199 times
  // and measure nothing — separate the two by two orders of magnitude, so the
  // 5x threshold below is not a tuned number.
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

finish()
