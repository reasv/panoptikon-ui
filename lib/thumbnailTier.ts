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
