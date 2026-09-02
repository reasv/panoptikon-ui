// ONE PICTURE PLAN PER GRID CARD: which element the card mounts, and every URL
// that element needs, decided in one pass over the row.
//
// IMPORT-FREE apart from lib/thumbnailTier.ts, lib/thumbnailURL.ts and
// lib/gridCellSize.ts, which are themselves pure and bundler-free — that is
// what lets scripts/thumbnailurl.test.mjs and scripts/gridcells.test.mjs
// execute these under plain node, which is the whole reason they are not
// expressions inside components/SearchResultImage.tsx.
//
// WHY IT IS NOT IN THE CARD. The card asked four separate questions (is it
// extreme, does it move, is it above the floor, is it a small video) and then
// combined them again at three different places — the tier arithmetic, the
// `source` object and the JSX ladder — so a fifth case could be added to one
// of them and not the others. That is exactly what happened to the
// extreme-aspect animated strip, whose `display` layer was mounted for months
// against a URL that answers `video/mp4`. Here the combination happens once and
// the card is a `switch`.
//
// TWO FUNCTIONS RATHER THAN ONE, because they have different lifetimes: the
// TIER is latched at mount (the no-flash rule,
// docs/grid-scroll-performance-implementation.md §2 — a changed `src` on a
// mounted `<img>` drops the bitmap it is painting), while the plan is rebuilt
// on every render from the latched tier and the live props.

import {
  EXTREME_ASPECT,
  animatedCellMode,
  exceedsDisplayLoopTrigger,
  isExtremeAspect,
  tierForCellWidth,
  type AnimatedFloor,
  type DisplayLoopTrigger,
  type ThumbnailTier,
} from "./thumbnailTier"
import {
  thumbnailMediaURL,
  thumbnailPictureURL,
  thumbnailStillURL,
  type PictureItem,
  type UrlDbs,
} from "./thumbnailURL"
import { coverBindingEdge } from "./gridCellSize"

/**
 * The crop layer of an extreme-aspect card: a still `<img>`, or the CROPPED
 * LOOP when the item is animated and above the raw floor. The crop rule is the
 * same geometry for both (§2 applies it in the encode), so the only thing that
 * changes is which element paints it.
 */
export type CellCrop =
  | { kind: "image"; src: string }
  | { kind: "loop"; src: string; poster: string }

/**
 * WHAT THIS CARD PAINTS. Exhaustive and mutually exclusive, so the card's JSX
 * is one `switch` with no residual "everything else" branch to drift.
 */
export type CellPicturePlan =
  /** The plain `<img>` every static card has always been. */
  | { kind: "still"; src: string }
  /**
   * An animated item above the raw floor: a grid tier answers `video/mp4`, so
   * only a `<video>` can show it. `poster` is the same request with
   * `still=true` — the picture until the director plays the cell, and the
   * fallback if the response turns out not to be a video after all.
   */
  | { kind: "loop"; src: string; poster: string }
  /**
   * A VIDEO in a small cell (D9): the single frame, with the 2×2 frame mosaic
   * layered over it on hover.
   */
  | { kind: "videoSmall"; frame: string; mosaic: string }
  /**
   * A comic strip or webtoon, whose grid rendition is a CROP: the crop, plus
   * the whole-image rendition its hover swaps to.
   *
   * `displaySrc` NULL means there is no picture to swap to — an animated item
   * past the server's display-loop bounds, whose `display` request answers
   * `video/mp4`. Null mounts no layer, binds no listeners and requests nothing.
   */
  | { kind: "extreme"; crop: CellCrop; displaySrc: string | null }

/** The row fields a plan reads. The search payload carries all of them. */
export interface CellRow extends PictureItem {
  sha256: string
}

/** What the plan needs from the HOST, read once per grid and handed down. */
export interface CellPictureEnv {
  animatedFloor: AnimatedFloor | null | undefined
  displayLoopTrigger: DisplayLoopTrigger | null | undefined
  /** Is this cell in the SMALL range (lib/gridCellSize.ts `isSmallCell`)? */
  smallCell: boolean
}

/**
 * THE TIER THIS CARD ASKS FOR — one comparison on row data, and the reason the
 * host hands down its box instead of an answer.
 *
 * The binding edge of an `object-cover` box is a property of the PICTURE in it,
 * not of the box alone: a PORTRAIT image in the 5xl band's 500×608 box only
 * needs its short side to cover the 500, while the worst case (`max` of the two
 * edges, which is all a grid-level answer can be) escalated every cell in that
 * band to `grid-m` — four times the decoded pixels, for the majority of cells
 * that never needed them.
 *
 * PAST ASPECT 2 THE SHAPE IS NOT THE ITEM'S. The stored grid rendition there is
 * a CROP, short side ≤ the tier and long side exactly 2× it (§2), and it is the
 * crop the cell paints — so the cover arithmetic runs against `EXTREME_ASPECT`:1
 * in the item's orientation, the same constant the crop rule itself turns on,
 * which is what keeps the two from drifting. `isExtremeAspect` is false whenever
 * a dimension is missing, so the substitution only ever runs on a row that has
 * both.
 *
 * NO HOOK AND NO MEASUREMENT: `cellWidth`/`boxHeightPx`/`dpr` are the host's one
 * layout answer, and this is arithmetic over them and two fields the row already
 * carries. A host that hands no numbers keeps its own `hostTier`, unchanged.
 */
export function cellTierForRow(
  row: { width?: number | null; height?: number | null },
  cellWidth?: number,
  boxHeightPx?: number,
  dpr?: number,
  hostTier?: ThumbnailTier
): ThumbnailTier | undefined {
  if (cellWidth === undefined) return hostTier
  const extreme = isExtremeAspect(row.width, row.height)
  const cropWide = extreme && (row.width ?? 0) >= (row.height ?? 0)
  const renditionWidth = extreme ? (cropWide ? EXTREME_ASPECT : 1) : row.width
  const renditionHeight = extreme ? (cropWide ? 1 : EXTREME_ASPECT) : row.height
  return tierForCellWidth(
    coverBindingEdge(cellWidth, boxHeightPx, renditionWidth, renditionHeight),
    dpr ?? 1
  )
}

/**
 * THE CARD'S PICTURE, in one pass.
 *
 * `tier` is the LATCHED answer from `cellTierForRow` — this function never
 * re-derives it, because the latch is the no-flash rule and a plan that could
 * disagree with the mounted element's `src` is the flash.
 *
 * ONE BUILDER PER MODE (lib/thumbnailURL.ts), which is what keeps the `still`
 * flag out of this file: a loop's picture is a `<video>` and asks for the
 * rendition whatever it is; a `"still"` cell is the one that must never be
 * handed `video/mp4`; a static cell has nothing to decide.
 */
export function planCellPicture(
  row: CellRow,
  dbs: UrlDbs,
  tier: ThumbnailTier | undefined,
  env: CellPictureEnv
): CellPicturePlan {
  const extreme = isExtremeAspect(row.width, row.height)
  const animated = animatedCellMode(row, env.animatedFloor)
  // D9: at small sizes a video's 2×2 frame mosaic is four thumbnails' worth of
  // detail in a box too small to read any of them, so the cell asks for the
  // single frame instead and swaps to the mosaic on hover. NOT applied to an
  // extreme-aspect video, whose card already owns a hover swap of its own — two
  // layers competing for the same gesture is one too many, and a strip-shaped
  // video is rare enough that keeping today's rendition there costs nothing.
  const smallVideo =
    env.smallCell && !extreme && !!row.type?.startsWith("video/")
  const src =
    animated === "loop"
      ? thumbnailMediaURL(dbs, row.sha256, tier)
      : animated === "still"
        ? thumbnailStillURL(dbs, row.sha256, tier)
        : thumbnailPictureURL(dbs, row, env.displayLoopTrigger, tier,
            smallVideo ? false : undefined)
  if (extreme) {
    return {
      kind: "extreme",
      crop: animated === "loop"
        ? {
            kind: "loop",
            src,
            poster: thumbnailStillURL(dbs, row.sha256, tier),
          }
        : { kind: "image", src },
      // NO DISPLAY LAYER for an animated strip past the server's display-loop
      // bounds: `?size=display` answers such an item with `video/mp4`
      // (docs/thumbnail-format-implementation.md R3), so the `<Image>` this URL
      // used to feed never fired `load`, the swap was silently dead, and every
      // re-hover re-requested a multi-megabyte loop into an element that could
      // not show it.
      //
      // Null rather than the `still=true` poster: what such a card already
      // paints IS the item moving — the cropped H.264 loop — so the only thing
      // a still whole-image layer would add on hover is stopping it.
      displaySrc: exceedsDisplayLoopTrigger(row, env.displayLoopTrigger)
        ? null
        : thumbnailPictureURL(dbs, row, env.displayLoopTrigger, "display"),
    }
  }
  if (animated === "loop") {
    return {
      kind: "loop",
      src,
      poster: thumbnailStillURL(dbs, row.sha256, tier),
    }
  }
  if (smallVideo) {
    return {
      kind: "videoSmall",
      frame: src,
      // The 2×2 mosaic: the same tier with the parameter left off.
      mosaic: thumbnailPictureURL(dbs, row, env.displayLoopTrigger, tier),
    }
  }
  return { kind: "still", src }
}
