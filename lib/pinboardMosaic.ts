// Client-side mosaic export: the board as one downloadable image.
//
// Same compositor as the saved-board preview (pinboardPreview.ts) — same
// cell geometry, same D4 orientation, same manual-then-auto crop fit, same
// thumbnail sources, same placeholder for missing items — with four
// differences, all of them the point of the feature:
//
//   1. The width is a preset, not PREVIEW_WIDTH, and upscaling is allowed:
//      the composite is laid out AT the target width, so every fit and
//      crop is solved at final resolution rather than drawn small and
//      blown up.
//   2. No screenful cap. "visible" cuts at the board's fill line (the
//      fold or the layout ratchet, whichever is deeper — the rows the
//      board is meant to show); "full" takes the whole content box.
//   3. Seamless mode tiles on the step lattice: no padding, no gutters,
//      no rounded corners, canvas cropped to the content box.
//   4. JPEG q0.92, or PNG on the lossless option — which also leaves the
//      background unpainted, so everything the pins don't cover is alpha
//      (previews stay WebP q0.82 over the page background, always).
//
// The scale question the preset raises: laying the board out at 3840px
// with the base grid would widen every column while row height stayed put,
// turning square cells into strips. So the mosaic scales the whole grid by
// targetWidth/boardWidth on top of whatever scale the board is rendering
// with — which for a "Scale With Window" board is exactly
// gridScale(refWidth -> targetWidth), and for every other board is the
// uniform zoom that makes the export look like the screen.
//
// Videos draw the frame they are showing when one is on screen and their
// thumbnail otherwise (see pinboardMedia.ts): seeking, trims and unmounted
// pins would need the server (see the design doc's deferred section).
//
// A SELECTION mosaic is the same compositor restricted to a set of layout
// keys: same arrangement, same cell rects, capture box shrunk to the
// selection's bounding box. Items the user did not select leave holes —
// their background shows through — because packing the selection would
// export a composition that is not the one on screen, and the board
// already has verbs (Arrange, Compress, Send to Region) for the user to
// close those gaps first if that is what they wanted.

import {
  MosaicExtent,
  MosaicFailure,
  fitLayoutWidthToOutput,
  foldRows,
  mosaicGeometry,
  solveWithinCanvasLimits,
} from "@/lib/pinboardGeometry"
import { effectiveGrid, gridScale, parseBoard } from "@/lib/pinboardGrid"
import { loadPinSource } from "@/lib/pinboardMedia"
import {
  PIN_CORNER_RADIUS_PX,
  canvasToBlob,
  drawPin,
} from "@/lib/pinboardPreview"

const JPEG_QUALITY = 0.92

export interface MosaicOptions {
  /** The raw `pinboard` URL param array — the LIVE board, unsaved edits included. */
  layout: string[]
  dbs: { index_db: string | null; user_data_db: string | null }
  /** The rendered board's pixel width (window.innerWidth when unmounted). */
  boardWidth: number
  /** The board scroll viewport's height, for the fold line. */
  boardHeight: number
  /** Preset width in px. */
  targetWidth: number
  /**
   * What `targetWidth` measures. "layout" lays the BOARD out at it — the
   * whole-board export's historical meaning, where a board whose content
   * doesn't span the full width composites narrower than the preset.
   * "output" makes the saved image itself come out that wide, which is the
   * only reading that means anything for a selection occupying a corner of
   * the board.
   */
  widthMode?: "layout" | "output"
  seamless: boolean
  extent: MosaicExtent
  /**
   * Layout keys to capture; absent means the whole board. A selection
   * always captures in full — see mosaicGeometry's `only`.
   */
  only?: ReadonlySet<string>
  /** The board's "Scale With Window" flag (pbp). */
  proportional: boolean
  /**
   * Encode PNG instead of JPEG, and leave the background UNPAINTED.
   *
   * The transparency is the point, more than the missing re-encode: a
   * mosaic is mostly not pins. The gutters between cells, the letterbox
   * inside a cell whose picture doesn't fill it, the corners the rounded
   * clip cuts away, and every hole a selection leaves behind all get the
   * page background painted into them today, which is a black slab that
   * has to be keyed back out anywhere the image is used over something
   * else. PNG makes all of it alpha instead.
   */
  lossless?: boolean
  /** Page background, painted under the pins unless `lossless`. */
  background: string
}

export interface ComposedMosaic {
  blob: Blob
  width: number
  height: number
  mime: string
  /** Filename extension for `mime`, without the dot. */
  extension: string
  /**
   * The width actually composited when the canvas guard had to shrink the
   * request, or null when the preset was honored — the caller says so.
   */
  clampedWidth: number | null
}

/**
 * Why no image came back. The geometry's own failures pass through, plus:
 *   "too-large" — the clamp loop never converged on a drawable canvas.
 *   "no-canvas" — the browser refused a 2D context.
 */
export type MosaicComposeFailure = MosaicFailure | "too-large" | "no-canvas"

export type MosaicComposeResult =
  | { ok: true; mosaic: ComposedMosaic }
  | { ok: false; failure: MosaicComposeFailure }

export async function composeBoardMosaic(
  opts: MosaicOptions
): Promise<MosaicComposeResult> {
  const {
    layout,
    dbs,
    boardWidth,
    boardHeight,
    seamless,
    only,
    proportional,
    background,
  } = opts
  // The chosen items are the extent: a fold cut on top of a selection would
  // silently drop pins the user pointed at.
  const extent: MosaicExtent = only ? "full" : opts.extent
  const parsed = parseBoard(layout)
  if (parsed.records.length === 0) return { ok: false, failure: "no-pins" }
  if (boardWidth <= 0) return { ok: false, failure: "degenerate" }

  // What the board is rendering with right now: the fold is measured
  // against THIS grid (it is a property of the window the user is looking
  // at), and the target-width zoom is layered on top of it.
  const liveScale = gridScale(proportional, parsed.refWidth, boardWidth)
  const liveGrid = effectiveGrid(parsed.grid, liveScale)
  const visibleRows = Math.max(
    foldRows(liveGrid, boardHeight),
    parsed.highWater
  )

  const solveAt = (width: number) =>
    mosaicGeometry({
      records: parsed.records,
      grid: effectiveGrid(parsed.grid, liveScale * (width / boardWidth)),
      layoutWidth: width,
      seamless,
      extent,
      visibleRows,
      only,
    })

  // "output" width first: find the layout width that makes the capture box
  // itself the requested size, then hand THAT to the canvas guard.
  let layoutTarget = opts.targetWidth
  if (opts.widthMode === "output") {
    const fitted = fitLayoutWidthToOutput(opts.targetWidth, solveAt)
    if (!fitted.ok) return { ok: false, failure: fitted.failure }
    layoutTarget = fitted.layoutWidth
  }

  // Canvas guard: an oversized request is re-solved smaller, and a request
  // that never fits fails here rather than allocating (see
  // solveWithinCanvasLimits).
  const solved = solveWithinCanvasLimits(layoutTarget, solveAt)
  if (!solved.ok) return { ok: false, failure: solved.failure }
  const { geometry: geo, layoutWidth: width, clampedWidth } = solved

  const canvas = document.createElement("canvas")
  canvas.width = geo.width
  canvas.height = geo.height
  const ctx = canvas.getContext("2d")
  if (!ctx) return { ok: false, failure: "no-canvas" }
  // A lossless mosaic keeps the canvas's own transparency: everything the
  // pins don't cover stays alpha instead of becoming a slab of page
  // background.
  if (!opts.lossless) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, geo.width, geo.height)
  }

  // Items starting past the bottom cut are not drawn at all; the ones the
  // cut crosses are clipped by the canvas edge, like the preview's cap.
  const bottom = geo.cropTop + geo.height
  const visible = geo.placements.filter((p) => p.top < bottom)
  // A playing pin contributes the frame it is showing when the canvas is
  // drawn, not when the export was clicked: the source is the live <video>
  // element, so a video left running advances by however long the stills
  // took to download. Within a beat of the click either way, and the
  // alternative (snapshotting every video at click time) costs a
  // full-resolution canvas per playing pin.
  const images = await Promise.all(
    visible.map((p) => loadPinSource({ key: p.key, sha256: p.sha256, dbs }))
  )

  // Cards are `rounded` (4px) at board scale, so the corner has to grow
  // with the export or a 3840px mosaic would look square-cornered anyway.
  const radius = seamless
    ? 0
    : PIN_CORNER_RADIUS_PX * Math.max(1, width / boardWidth)
  for (let i = 0; i < visible.length; i++) {
    const p = visible[i]
    drawPin(
      ctx,
      p,
      images[i],
      p.left - geo.cropLeft,
      p.top - geo.cropTop,
      p.width,
      p.height,
      radius
    )
  }

  const mime = opts.lossless ? "image/png" : "image/jpeg"
  const blob = await canvasToBlob(canvas, mime, JPEG_QUALITY)
  return {
    ok: true,
    mosaic: {
      blob,
      width: geo.width,
      height: geo.height,
      mime,
      extension: opts.lossless ? "png" : "jpg",
      clampedWidth,
    },
  }
}
