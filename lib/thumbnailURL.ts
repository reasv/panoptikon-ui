// The thumbnail endpoint's URLs, ONE BUILDER PER KIND OF ELEMENT.
//
// IMPORT-FREE apart from lib/thumbnailTier.ts, which is itself import-free and
// nothing but pure functions: scripts/thumbnailurl.test.mjs runs these under
// plain node, and the components that call them pull in React and next/image,
// neither of which resolves outside a bundler.
//
// WHY THE SPLIT. `getFileURL` below takes `still` and `big` as booleans, so
// every call site decided for itself whether the response could be video — and
// the SAME row-data rule was written out at eight of them, in three different
// shapes, with the two that got it wrong showing a broken picture. The rule is
// not a call site's business; the ELEMENT is:
//
//   - `originalFileURL` — the bytes on disk. No tiers, no flags.
//   - `thumbnailMediaURL` — the rendition, whatever it turns out to be. ONLY
//     for an element that can play video (the gallery's display `<video>`, a
//     loop cell's `<video>`), or a caller that has PROVEN the answer is an
//     image by some other route.
//   - `thumbnailStillURL` — `still=true`, always. The poster of a loop, a
//     canvas draw source, the pinboard's carry ghost, a `<video poster>`: every
//     place that must have an image and has no row to reason from.
//   - `thumbnailPictureURL` — what an `<img>` MAY paint for a KNOWN item. It
//     takes the ROW and the TRIGGER by type, so a caller holding only a sha
//     cannot reach it and will pick one of the two above deliberately.
//
// THE PICTURE RULE, in one place (docs/thumbnail-format-implementation.md
// R3): at a GRID tier the endpoint answers an animated item above the raw
// floor with `video/mp4`, so an `<img>` needs `still=true` whenever the item
// moves at all — `isAnimatedItem` alone, because the flag is a documented
// no-op below the floor. At the DISPLAY size the same question has a different
// answer: only an item past `display_loop_trigger` is a loop there, and
// `still=true` on the ones below it would swap the item's own animating file
// for a static poster and cost a second cache entry for nothing.

import {
  exceedsDisplayLoopTrigger,
  isAnimatedItem,
  type DisplayLoopTrigger,
  type ThumbnailTier,
} from "./thumbnailTier"

/** The selected databases, as `useSelectedDBs` hands them out. */
export interface UrlDbs {
  index_db: string | null
  user_data_db: string | null
}

/**
 * The row fields the picture rule reads. A structural type rather than
 * `SearchResult` so the pinboard's `/api/items/item` row and the grid's search
 * row both satisfy it — they carry the same five fields under the same names.
 */
export interface PictureItem {
  sha256: string
  type: string | null | undefined
  duration?: number | null
  size?: number | null
  width?: number | null
  height?: number | null
}

/**
 * THE SERIALIZER, and the only thing in the app that knows the query string's
 * shape. Private: everything outside this module goes through one of the four
 * builders below, which is what makes the picture rule unforgettable.
 *
 * `size` selects a stored rendition tier (`lib/thumbnailTier.ts`) and applies
 * to `file_type: "thumbnail"` only — the original file has no tiers.
 *
 * OMITTING it is the bare URL, which the endpoint answers with the display
 * rendition. Passing `"display"` explicitly is therefore the same BYTES and a
 * DIFFERENT URL, which one caller needs and no other should want: a GRID card
 * whose own rendition is a grid tier has to name the display tier to swap to
 * it. A surface whose default is already the display rendition must NOT spell
 * it out — the two spellings would then be two cache entries for one picture,
 * split across surfaces that are meant to share (see PreviewSurface's note).
 *
 * `still` forces the STATIC rendition of an animated item — at a grid tier an
 * animated item above the raw floor otherwise answers `video/mp4`, which an
 * `<img>` cannot show. AT A GRID TIER it is a no-op for everything else
 * (static items, and animated items at or below the raw floor, are served the
 * same bytes either way), which is what lets a surface with no floor to test
 * against set it from `isAnimatedItem` alone. AT THE DISPLAY SIZE IT IS NOT A
 * NO-OP: an animated item above the raw floor is answered there with the
 * stored ≤1024 grid-m poster rather than with its own file, so a caller that
 * sets it speculatively downgrades exactly the pictures it was trying to
 * protect. Either way it is a distinct URL, hence a distinct cache entry.
 *
 * `big` selects between a VIDEO item's two stored thumbnails: the 2×2 frame
 * mosaic (the default, and what omitting the parameter has always meant) and
 * the single frame at index 1, which carries its own grid tiers. Only `false`
 * is ever spelled out — a small grid cell asking for the single frame (D9) —
 * so every other call site produces the URL it always did, byte for byte, and
 * no cache entry moves for the sake of a parameter that changes nothing.
 *
 * `r` is the DISPLAY REVISION, added here and never by a call site — see
 * `DISPLAY_REVISION`.
 */
function getFileURL(
  dbs: UrlDbs,
  file_type: "file" | "thumbnail",
  id: string,
  size?: ThumbnailTier,
  still?: boolean,
  big?: boolean
): string {
  const index_db_param = dbs.index_db ? `&index_db=${dbs.index_db}` : ""
  const size_param = size ? `&size=${size}` : ""
  const still_param = still ? `&still=true` : ""
  const big_param = big === false ? `&big=false` : ""
  const revision_param = isDisplayRequest(file_type, size)
    ? `&r=${DISPLAY_REVISION}`
    : ""
  return `/api/items/item/${file_type}?id=${id}&id_type=sha256${index_db_param}${size_param}${still_param}${big_param}${revision_param}`
}

/**
 * THE DISPLAY REVISION, bumped by hand exactly when a release changes what the
 * display rendition's BYTES are and the endpoint cannot express that in an
 * ETag the client already holds.
 *
 * Why it exists (docs/thumbnail-format-implementation.md §5): the display
 * rendition used to be served `immutable` under the ETag `sha-thumb{idx}`,
 * which carries no format and no geometry. The format work changes those bytes
 * — a PNG's display rendition becomes WebP, geometry re-caps at 2560 — and
 * every browser that ever loaded the old JPEG holds it at the bare URL for a
 * year. The new ETag fixes the FUTURE; only a different URL fixes the caches
 * already out there, and this is that URL, once, deterministically, instead of
 * "until eviction". `2` because revision 1 is every URL ever issued without
 * this parameter.
 *
 * It rides in the serializer rather than at the call sites so that no surface
 * can be missed and none can disagree: the peek layer, the gallery and the
 * similarity header must produce the SAME string for the same item or they
 * stop sharing a cache entry (see PreviewSurface's note on that).
 */
const DISPLAY_REVISION = 2

/**
 * Which requests carry it: `thumbnail` at the DISPLAY size, spelled or
 * omitted, and nothing else.
 *
 * The grid tiers are excluded DELIBERATELY and must stay excluded. Their bytes
 * are versioned inside their own ETag (`TIER_PROCESS_VERSION`), so a format or
 * encoder change already invalidates them; adding a parameter here would move
 * every grid URL in the app for no gain and cost a cold cache for the surface
 * that is most sensitive to one. `file` requests serve the bytes on disk,
 * which no release changes.
 */
function isDisplayRequest(
  file_type: "file" | "thumbnail",
  size: ThumbnailTier | undefined
): boolean {
  return file_type === "thumbnail" && (size === undefined || size === "display")
}

/**
 * Is this a GRID rendition rather than the display one? The two sizes answer
 * "may an `<img>` paint this?" from different fields, which is the whole of
 * `thumbnailPictureURL`'s branch.
 */
function isGridTier(size: ThumbnailTier | undefined): boolean {
  return size !== undefined && size !== "display"
}

/** The bytes on disk, exactly as indexed. No tiers, no flags, no revision. */
export function originalFileURL(dbs: UrlDbs, sha256: string): string {
  return getFileURL(dbs, "file", sha256)
}

/**
 * The rendition, WHATEVER IT TURNS OUT TO BE — image bytes or `video/mp4`.
 *
 * ONLY for an element that can play video, or for a caller that has proven by
 * some other route that this item's answer is an image. An `<img>` pointed
 * here for an animated item shows a broken picture, silently, because an
 * `<img>` has no error state a user can read — which is why the builder that
 * an `<img>` should use demands the row.
 */
export function thumbnailMediaURL(
  dbs: UrlDbs,
  sha256: string,
  size?: ThumbnailTier
): string {
  return getFileURL(dbs, "thumbnail", sha256, size)
}

/**
 * The rendition WITH `still=true`, unconditionally: the one request the
 * endpoint guarantees answers an image at any size (§5).
 *
 * For a caller with no row to reason from — a canvas draw source, the
 * pinboard's 80×80 carry ghost — and for the poster of a loop, where the
 * element already knows it wants the still frame. A caller that HAS the row
 * should use `thumbnailPictureURL` instead: at the display size this flag is
 * not free (see the serializer's note on `still`).
 */
export function thumbnailStillURL(
  dbs: UrlDbs,
  sha256: string,
  size?: ThumbnailTier,
  big?: boolean
): string {
  return getFileURL(dbs, "thumbnail", sha256, size, true, big)
}

/**
 * WHAT AN `<img>` MAY PAINT for this item: the rendition, with `still=true`
 * exactly when the endpoint would otherwise answer this size with video.
 *
 * The row and the trigger are REQUIRED BY TYPE, and that is the point — a
 * caller holding only a sha cannot reach this function and has to choose
 * between the two builders above on purpose. Both tests are one comparison on
 * fields the row already carries: no request, no probe, no error latch.
 *
 * `trigger` null (an older Server, the config still in flight) reads as "the
 * display size is always an image", which is what it was before display loops
 * existed.
 */
export function thumbnailPictureURL(
  dbs: UrlDbs,
  item: PictureItem,
  trigger: DisplayLoopTrigger | null | undefined,
  size?: ThumbnailTier,
  big?: boolean
): string {
  const still = isGridTier(size)
    ? isAnimatedItem(item.type, item.duration)
    : exceedsDisplayLoopTrigger(item, trigger)
  return getFileURL(dbs, "thumbnail", item.sha256, size, still, big)
}
