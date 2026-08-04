// Client-side export of ONE pinned item as an image file.
//
// The mosaic composites cells; this composites a picture. Same crop, same
// orientation, same draw step (drawPin, so the two can never disagree about
// what a pin looks like) — but the canvas IS the crop region rather than
// the item's cell, so nothing letterboxes and no page background surrounds
// the result. That makes the pinboard's crop/rotate/flip tools an image
// editor whose output leaves the app: pin something, frame it, save it.
//
// Resolution comes from the source, not the board. An item on screen at
// 300px exports at whatever the file holds, because the file endpoint is
// loaded in preference to the thumbnail for images (see pinboardMedia.ts) —
// the on-screen size is available as an explicit choice, not the ceiling.
//
// Videos export the frame they are showing, at the video's own resolution.
// A video that isn't playing has no frame to read and falls back to its
// stored thumbnail; picking a frame without playing it needs the server.

import { CropRect, PinOrientation, orientedSize } from "@/lib/pinboardCrop"
import { itemOutputSize } from "@/lib/pinboardGeometry"
import { loadPinSource } from "@/lib/pinboardMedia"
import { canvasToBlob, drawPin } from "@/lib/pinboardPreview"
import { computeRestGeometry } from "@/components/gallery/CropView"

export const ITEM_JPEG_QUALITY = 0.92

/** How big the exported picture is. */
export type ItemImageTarget =
  /** The crop region at the source's own resolution — the default. */
  | { kind: "native" }
  /** Exactly the width the picture has on the board right now. */
  | { kind: "cell"; cellW: number; cellH: number }
  /** A preset width in px; upscales when the source is smaller. */
  | { kind: "width"; px: number }

export interface ItemImageOptions {
  /** Layout key, for the live-video-frame probe. */
  key: string
  sha256: string
  dbs: { index_db: string | null; user_data_db: string | null }
  /** The EFFECTIVE crop (manual ∘ auto), in display space. */
  crop: CropRect | null
  orient: PinOrientation | null
  target: ItemImageTarget
  /** True for items whose mime is an image: load the file, not the thumbnail. */
  original: boolean
  lossless: boolean
  /**
   * Painted under the picture. Only ever visible through a source with
   * alpha flattened into JPEG (which has none) — a lossless export keeps
   * the transparency instead.
   */
  background: string
}

export interface ComposedItemImage {
  blob: Blob
  width: number
  height: number
  mime: string
  extension: string
  /** Intrinsic size of what was actually drawn, for the "from" half of a report. */
  sourceWidth: number
  sourceHeight: number
}

export type ItemImageFailure =
  /** Neither the file nor the thumbnail could be decoded. */
  | "no-source"
  /** The source decoded to nothing usable (zero-size, degenerate crop). */
  | "degenerate"
  | "no-canvas"

export type ItemImageResult =
  | { ok: true; image: ComposedItemImage }
  | { ok: false; failure: ItemImageFailure }

export async function composeItemImage(
  opts: ItemImageOptions
): Promise<ItemImageResult> {
  const { key, sha256, dbs, crop, orient, target, lossless, background } = opts
  const src = await loadPinSource({ key, sha256, dbs, original: opts.original })
  if (!src) return { ok: false, failure: "no-source" }

  // "cell" asks for the picture at the size it occupies on the board, which
  // is the contain-fitted crop inside the cell — NOT the cell itself, whose
  // extra width is letterbox this export doesn't draw.
  let targetWidth: number | null = null
  if (target.kind === "width") {
    targetWidth = target.px
  } else if (target.kind === "cell") {
    const [ow, oh] = orientedSize(src.width, src.height, orient)
    const c = crop ?? { x: 0, y: 0, w: 1, h: 1 }
    targetWidth = computeRestGeometry(
      target.cellW,
      target.cellH,
      c,
      ow,
      oh
    ).visW
  }
  const size = itemOutputSize(crop, src.width, src.height, orient, targetWidth)
  if (!size) return { ok: false, failure: "degenerate" }

  const canvas = document.createElement("canvas")
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext("2d")
  if (!ctx) return { ok: false, failure: "no-canvas" }
  if (!lossless) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, size.width, size.height)
  }

  // The canvas has the crop's own aspect, so drawPin's contain fit is the
  // identity here (up to the half-pixel the integer canvas rounds away) and
  // the picture lands edge to edge. Square corners: this is a picture, not
  // a card.
  drawPin(
    ctx,
    { key, sha256, left: 0, top: 0, width: size.width, height: size.height, crop, orient },
    src,
    0,
    0,
    size.width,
    size.height,
    0
  )

  const mime = lossless ? "image/png" : "image/jpeg"
  const blob = await canvasToBlob(canvas, mime, ITEM_JPEG_QUALITY)
  return {
    ok: true,
    image: {
      blob,
      width: size.width,
      height: size.height,
      mime,
      extension: lossless ? "png" : "jpg",
      sourceWidth: src.width,
      sourceHeight: src.height,
    },
  }
}
