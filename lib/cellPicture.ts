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
  originalFileURL,
  thumbnailMediaURL,
  thumbnailPictureURL,
  thumbnailStillURL,
  type PictureItem,
  type UrlDbs,
} from "./thumbnailURL"
import { coverBindingEdge } from "./gridCellSize"
// Type-only, so this module keeps the runtime-import list its header names:
// lib/videoPreview.ts reaches for the playability ladder and the transcode
// store, neither of which belongs in a function that decides URLs.
import { NO_PREVIEW_RUNGS, type PreviewRung } from "./videoPreview"

/**
 * The picture of a VIDEO cell that may hover-preview
 * (docs/video-hover-preview-implementation.md V12), shared by the plain card
 * and by the extreme-aspect crop because both paint the same three layers.
 *
 * TWO POSTERS, and the difference between them is the whole of V12. `poster`
 * is the cell's BASE picture — a small cell's single frame, a large one's 2×2
 * mosaic — and `frame` is the single frame the hover shows while the preview
 * loads. They are the SAME URL in a small cell, which is what makes "a small
 * cell never swaps to the 2×2 while previews are on" a property of the plan
 * rather than a branch in the card.
 *
 * `directSrc` is the ORIGINAL FILE, non-null only when the `"direct"` rung is
 * on the ladder — nothing requests it until the dwell fires, and no `<video>`
 * exists in the grid before then.
 *
 * `rungs` is the LADDER, in order (lib/videoPreview.ts): what this cell tries
 * first, and what it falls to if that rung fails. A list rather than one
 * answer because a decode error or a refused mux is only knowable by trying,
 * and the picture is the thing that finds out.
 */
export interface CellVideoPicture {
  poster: string
  frame: string
  directSrc: string | null
  rungs: readonly PreviewRung[]
}

/**
 * The crop layer of an extreme-aspect card: a still `<img>`, the CROPPED LOOP
 * when the item is animated and above the raw floor, or a hover-previewing
 * VIDEO. The crop rule is the same geometry for all three (§2 applies it in
 * the encode), so the only thing that changes is which element paints it.
 */
export type CellCrop =
  | { kind: "image"; src: string }
  | { kind: "loop"; src: string; poster: string }
  | ({ kind: "video" } & CellVideoPicture)

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
   * A VIDEO in a small cell (D9), with previews OFF: the single frame, with
   * the 2×2 frame mosaic layered over it on hover. Byte for byte the cell that
   * shipped before hover previews existed.
   */
  | { kind: "videoSmall"; frame: string; mosaic: string }
  /**
   * A VIDEO whose cell may hover-preview (V12). Replaces BOTH of the plans a
   * video card had before — the small cell's `videoSmall` swap and the large
   * cell's plain `still` — because the hover gesture now belongs to the
   * preview: a small cell holds its single frame and fades the video in over
   * it, a large one swaps its mosaic for the single frame at the moment of the
   * zoom-out and fades the video in over THAT.
   */
  | ({ kind: "video" } & CellVideoPicture)
  /**
   * A comic strip or webtoon, whose grid rendition is a CROP: the crop, plus
   * the whole-image rendition its hover swaps to.
   *
   * `displaySrc` NULL means there is no picture to swap to — an animated item
   * past the server's display-loop bounds, whose `display` request answers
   * `video/mp4`. Null mounts no layer, binds no listeners and requests nothing.
   */
  | { kind: "extreme"; crop: CellCrop; displaySrc: string | null }

/**
 * DOES AN EXTREME-ASPECT CARD'S CROP ARM ITS OWN HOVER PLAY? (D6/D7)
 *
 * Only a LOOP crop can — a still one has nothing to play — and only when the
 * card has NO whole-image swap. A card that has one spends its single hover
 * gesture there: the swap paints the `display` rendition, which is the
 * ORIGINAL FILE and animates natively in its `<img>`, so arming as well would
 * fetch a loop, mount it, and unmount it again the moment the swap landed.
 *
 * Past the display-loop trigger there is no swap (`displaySrc` is null above),
 * and the gesture is free: the crop loop then arms like any other loop cell,
 * which is the only motion such a card can show in hover mode.
 *
 * HERE RATHER THAN INLINE IN THE CARD because it is a question about the PLAN
 * — the two fields together, not either alone — and because pure and
 * element-free is what lets scripts/hoveranimate.test.mjs pin it against plans
 * `planCellPicture` actually produces.
 */
export function extremeCropArmsHover(
  crop: CellCrop,
  displaySrc: string | null
): boolean {
  return crop.kind === "loop" && displaySrc === null
}

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
  env: CellPictureEnv,
  /**
   * THE PREVIEW LADDER for this cell's item (lib/videoPreview.ts), decided by
   * the card from the row, the playability ladder, the file's size and the
   * host's one resolved capability — and handed in for the reason `tier` is:
   * this file must not reach for a media element, and the answer depends on
   * what the BROWSER can decode, which is not a property of any URL.
   *
   * EMPTY — the default, and what every surface that knows nothing about
   * previews passes — reproduces the plans that shipped before this existed,
   * URL for URL.
   */
  rungs: readonly PreviewRung[] = NO_PREVIEW_RUNGS
): CellPicturePlan {
  const extreme = isExtremeAspect(row.width, row.height)
  const animated = animatedCellMode(row, env.animatedFloor)
  const video = !!row.type?.startsWith("video/")
  // Is the hover gesture this card's PREVIEW's? Everything V12 changes hangs
  // off this one boolean, and with it false every branch below is the branch
  // that shipped before hover previews existed.
  const previews = video && rungs.length > 0
  // D9: at small sizes a video's 2×2 frame mosaic is four thumbnails' worth of
  // detail in a box too small to read any of them, so the cell asks for the
  // single frame instead and swaps to the mosaic on hover. NOT applied to an
  // extreme-aspect video, whose card already owns a hover swap of its own — two
  // layers competing for the same gesture is one too many, and a strip-shaped
  // video is rare enough that keeping today's rendition there costs nothing.
  //
  // NOR with previews on (V12): the swap the small cell would make is TO the
  // 2×2, and the preview is about to fade in over the picture — so the mosaic
  // would arrive, be looked at for as long as the dwell takes, and be covered.
  // The single frame stays, and the video plays over it.
  const smallVideo = env.smallCell && !extreme && video && !previews
  const src =
    animated === "loop"
      ? thumbnailMediaURL(dbs, row.sha256, tier)
      : animated === "still"
        ? thumbnailStillURL(dbs, row.sha256, tier)
        : thumbnailPictureURL(dbs, row, env.displayLoopTrigger, tier,
            smallVideo ? false : undefined)
  // The three layers of a previewing video cell, spelled once for the plain
  // card and the extreme-aspect crop.
  const videoPicture = (poster: string, frame: string): CellVideoPicture => ({
    poster,
    frame,
    // The direct rung mounts the item's OWN bytes; the two job rungs have no
    // URL until their job is done, and the cell asks the transcode store for
    // one when the dwell fires.
    directSrc: rungs.includes("direct")
      ? originalFileURL(dbs, row.sha256)
      : null,
    rungs,
  })
  if (extreme) {
    return {
      kind: "extreme",
      crop: animated === "loop"
        ? {
            kind: "loop",
            src,
            poster: thumbnailStillURL(dbs, row.sha256, tier),
          }
        : previews
          // A STRIP-SHAPED VIDEO WITH PREVIEWS ON. The crop is the picture it
          // has always been (no `big=false` here — a crop of the mosaic is
          // what the encode stored, and there is no single-frame rendition of
          // it), so `poster` and `frame` are the same URL and no swap layer
          // is mounted. What changes is that the preview owns the hover and
          // the whole-image swap stands down — see `displaySrc` below.
          ? { kind: "video", ...videoPicture(src, src) }
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
      //
      // The BARE URL, not `size=display`: bare IS the display rendition, and
      // it is the spelling the peek layer, the gallery and the similarity
      // header use — so a strip hovered here and then peeked is one cache
      // entry, not two downloads of the same bytes.
      //
      // AND NULL FOR A PREVIEWING VIDEO, on exactly the rule
      // `extremeCropArmsHover` states in the other direction: one hover, one
      // owner. Such a card's swap paints the whole 2×2 mosaic as a still, and
      // a moving preview of the file itself is strictly the better answer to
      // the same gesture — so with previews ON the swap stands down, and with
      // them off (preference, policy, or an item this browser cannot show)
      // the card is byte for byte the one that shipped.
      displaySrc:
        previews || exceedsDisplayLoopTrigger(row, env.displayLoopTrigger)
          ? null
          : thumbnailPictureURL(dbs, row, env.displayLoopTrigger),
    }
  }
  if (animated === "loop") {
    return {
      kind: "loop",
      src,
      poster: thumbnailStillURL(dbs, row.sha256, tier),
    }
  }
  if (previews) {
    // The single frame, which is the base picture in a small cell and the
    // hover placeholder in a large one (V12). `src` is already the frame in
    // the small case and the mosaic in the large one, so the two spellings
    // below cover both without a second branch.
    const frame = thumbnailPictureURL(
      dbs, row, env.displayLoopTrigger, tier, false)
    return {
      kind: "video",
      ...videoPicture(env.smallCell ? frame : src, frame),
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
