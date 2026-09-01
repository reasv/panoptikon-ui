// Which stored rendition a picture surface asks the thumbnail endpoint for,
// and the one aspect test the crop rule turns on.
//
// IMPORT-FREE on purpose, like lib/scrollMode.ts and lib/searchDefaults.ts and
// for the same reason: every function here is pure, which is what lets
// scripts/gridcells.test.mjs execute them under plain node. The React side is
// a handful of call sites that pass a measured CSS width in.
//
// The contract (docs/grid-scroll-performance-implementation.md §2, frozen):
//
//   GET /api/items/item/thumbnail?…&size=display|grid-m|grid-s
//
// `display` is what omitting the parameter has always meant — gallery quality,
// long side bounded. `grid-m` and `grid-s` cap the SHORT side at 1024 and 512,
// which is the dimension an `object-cover` cell's crispness is actually bound
// by. A tier an item has no stored rendition for falls UP the ladder
// server-side, so every request is answerable and no call site needs a
// fallback.

/** The frozen `size=` wire values. */
export type ThumbnailTier = "display" | "grid-m" | "grid-s"

/** The short-side cap each grid tier stores, in image pixels. */
export const TIER_SHORT_SIDE = {
  "grid-s": 512,
  "grid-m": 1024,
} as const

/**
 * How much smaller than the box a tier may be before the next one up is
 * requested. 1.125 buys one tier's worth of headroom against the exact
 * threshold — a 580px cell at DPR 1 is served the 512 rendition and upscaled
 * by 13%, which is invisible on a photograph, where jumping it to `grid-m`
 * would double the decoded pixels for the whole screenful.
 */
export const TIER_SLACK = 1.125

/**
 * The smallest tier whose short side covers a cell of `cssWidth` at `dpr`,
 * i.e. `grid-s` up to 576 device pixels, `grid-m` up to 1152, `display` past
 * that. This is what keeps decoded megapixels per screenful roughly constant
 * as the size slider shrinks cells: fewer, bigger cells and more, smaller ones
 * both land on a tier sized for the box.
 *
 * A non-positive or non-finite width answers `display` — the conservative
 * direction. It means "not measured yet", and a surface that has not measured
 * itself must not be handed a rendition that could be too small for it.
 */
export function tierForCellWidth(cssWidth: number, dpr: number): ThumbnailTier {
  if (!Number.isFinite(cssWidth) || cssWidth <= 0) return "display"
  const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  const needed = cssWidth * scale
  if (needed <= TIER_SHORT_SIDE["grid-s"] * TIER_SLACK) return "grid-s"
  if (needed <= TIER_SHORT_SIDE["grid-m"] * TIER_SLACK) return "grid-m"
  return "display"
}

/**
 * The aspect past which a grid tier is a CROP rather than the whole picture
 * (§2). Comic strips and webtoons are real content in the target datasets and
 * cluster in search results, so the stored grid renditions bound them at
 * `2 × tier` on the long side and crop to what the cover cell displays.
 */
export const EXTREME_ASPECT = 2

/**
 * Is this item's stored rendition a crop rather than the whole picture?
 *
 * ONE COMPARISON ON ROW DATA — no hook, no measurement, no request. That is
 * the zero-cost-for-normal invariant (§2): the URL scheme is
 * aspect-independent, so this test decides only whether a cell mounts the
 * hover-swap machinery, and a normal-aspect cell keeps today's CSS-only hover
 * with no listeners and no state.
 *
 * Missing dimensions are NORMAL, deliberately. A row with no width/height is
 * either a pre-backfill record or a non-image, and treating an unknown as
 * extreme would mount the swap on every such cell — the exact cost this test
 * exists to avoid. The consequence for a genuinely extreme item with no
 * dimensions on record is that its hover shows the crop contained rather than
 * the whole picture, which is what today already does.
 *
 * Dimensions are the DISPLAY dimensions (items.rotation is applied at scan
 * time), so this agrees with what the server cropped and what the browser
 * paints.
 */
export function isExtremeAspect(
  width: number | null | undefined,
  height: number | null | undefined
): boolean {
  if (!width || !height) return false
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false
  if (width <= 0 || height <= 0) return false
  const ratio = width >= height ? width / height : height / width
  return ratio > EXTREME_ASPECT
}

// ---------------------------------------------------------------------------
// Animated items (F6)
// ---------------------------------------------------------------------------

/**
 * The raw floor an animated item has to clear before the scan stores an H.264
 * loop for it. Served by `GET /api/client-config` as `animated_floor` and
 * carried here as a plain pair of numbers — NEVER hardcoded on this side. It
 * is the same arithmetic the scan used to decide what to write, so surfacing
 * it is what keeps the two from drifting.
 */
export interface AnimatedFloor {
  /** Bytes. An item at or below this AND within `maxSide` serves raw. */
  maxFileSize: number
  /** Pixels. BOTH sides must be within it. */
  maxSide: number
}

/**
 * Does this item's picture MOVE?
 *
 * ONE COMPARISON ON ROW DATA, like `isExtremeAspect` and for the same reason
 * (§2's zero-cost-for-normal invariant): a static card must not gain a hook, a
 * listener or a second request from this feature existing, so the test that
 * decides which picture component it renders reads two fields it already has.
 *
 * A TRANSCRIPTION of the backend's `visual_tiers::is_animated_image`, prefix
 * tests included. The two sides must answer this identically or a stored
 * rendition becomes unreachable — a cell asking for an `<img>` where the
 * endpoint holds a loop, or the reverse — so this deliberately mirrors that
 * function's shape rather than restating it in nicer terms.
 *
 * The two container families get opposite defaults, because their UNKNOWN
 * cases are opposite:
 *
 * - **GIF is animated unless it was MEASURED still.** `duration` is the scan's
 *   animation sentinel on image rows (docs/animated-image-spans-design.md):
 *   NULL unmeasured, 0 measured-still, >0 animated. The overwhelming majority
 *   of GIFs move, and a GIF indexed before that measurement existed reads NULL
 *   here — so unmeasured stays animated, which is also what today's endpoint
 *   does for every GIF. Only an explicit 0 takes the static path.
 * - **Every other image container is animated only when measured so** (WebP
 *   today, AVIF when importing lands, APNG by the same rule). For those the
 *   still case is the common one, so an unmeasured row must not be guessed
 *   into the animated path.
 *
 * Video items are never animated *pictures*: they have their own thumbnail
 * machinery, and a `video/*` type fails the image prefix here.
 */
export function isAnimatedItem(
  type: string | null | undefined,
  duration: number | null | undefined
): boolean {
  if (!type) return false
  const measured = duration != null && Number.isFinite(duration)
  if (type.startsWith("image/gif")) {
    // Measured STILL (an explicit 0 or less) is the only thing that makes a
    // GIF a static picture. NULL is "not measured", which stays animated.
    return !(measured && duration! <= 0)
  }
  return type.startsWith("image") && measured && duration! > 0
}

/**
 * Does a stored LOOP exist for this animated item — i.e. is it above the raw
 * floor? Only meaningful for an item `isAnimatedItem` already accepted.
 *
 * The floor is `bytes ≤ maxFileSize AND both sides ≤ maxSide`; clearing EITHER
 * half puts the item above it. That asymmetry is worth spelling out because it
 * decides the answer for incomplete rows:
 *
 * - `size` alone can settle it: past `maxFileSize` the item is above the floor
 *   no matter what its dimensions turn out to be.
 * - Within `maxFileSize` and with no dimensions on record, it genuinely CANNOT
 *   be settled. The answer is then `false` — the conservative direction, which
 *   `animatedCellMode` turns into a poster request rather than a `<video>`.
 *   A cell that guessed `true` here and guessed wrong would point a `<video>`
 *   at the item's own GIF bytes; one that guesses `false` and guesses wrong
 *   shows a correct still picture. Missing dimensions are a pre-backfill row,
 *   exactly as in `isExtremeAspect`.
 *
 *   This is the ONE deliberate divergence from the backend's
 *   `animated_serves_original`, which answers the opposite way for unknown
 *   dimensions — it is asked at the endpoint, where "unknown" must never
 *   become "immutable forever". Both sides are conservative for their own
 *   question, and they do not conflict: a cell that answers `"still"` for a
 *   row the server considers above the floor is served that item's poster,
 *   which is a correct picture either way. Unlike `isAnimatedItem`, this is
 *   not a transcription and must not be "corrected" into one.
 *
 * Clearing the floor is NECESSARY BUT NOT SUFFICIENT for a loop to exist: the
 * backfill may not have written one yet, and the settled keep-the-original edge
 * (no H.264 encode came out smaller than the source) means some items above the
 * floor will never have one. Both answer a grid-tier request with image bytes,
 * which is why the `<video>` → poster fallback is required rather than
 * defensive.
 */
export function isAboveAnimatedFloor(
  size: number | null | undefined,
  width: number | null | undefined,
  height: number | null | undefined,
  floor: AnimatedFloor | null | undefined
): boolean {
  if (!floor) return false
  if (size == null || !Number.isFinite(size)) return false
  if (size > floor.maxFileSize) return true
  if (!width || !height) return false
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false
  return width > floor.maxSide || height > floor.maxSide
}

/**
 * What a grid-sized picture surface should render for this item.
 *
 * - `"static"` — not an animated picture. TODAY'S PATH, byte for byte: the same
 *   `<img>`, the same URL, no `still` parameter. This is the case that must
 *   stay free, and every branch below is reached only after it is ruled out.
 * - `"loop"` — animated and above the floor, so a grid tier answers `video/mp4`
 *   and a `<video>` is the only element that can show it. Poster comes from the
 *   same URL with `still=true`.
 * - `"still"` — animated, but this cell is not going to play it: at or below the
 *   floor, or a row too incomplete to tell. Request the tier with `still=true`,
 *   which the endpoint documents as a NO-OP for a below-floor item (it answers
 *   with the original file either way, and that animates natively in an `<img>`)
 *   and as the poster for an above-floor one. One flag covers both, so an
 *   ambiguous row can never put `video/mp4` into an `<img>`.
 *
 * A surface that renders pictures but never plays them — the gallery filmstrip
 * — does not call this at all: it needs no floor, because `isAnimatedItem`
 * alone tells it to add `still=true`.
 */
export type AnimatedCellMode = "static" | "still" | "loop"

export function animatedCellMode(
  item: {
    type: string | null | undefined
    duration?: number | null
    size?: number | null
    width?: number | null
    height?: number | null
  },
  floor: AnimatedFloor | null | undefined
): AnimatedCellMode {
  if (!isAnimatedItem(item.type, item.duration)) return "static"
  return isAboveAnimatedFloor(item.size, item.width, item.height, floor)
    ? "loop"
    : "still"
}
