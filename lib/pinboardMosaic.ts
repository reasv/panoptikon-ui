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
//   4. JPEG q0.92 (previews stay WebP q0.82).
//
// The scale question the preset raises: laying the board out at 3840px
// with the base grid would widen every column while row height stayed put,
// turning square cells into strips. So the mosaic scales the whole grid by
// targetWidth/boardWidth on top of whatever scale the board is rendering
// with — which for a "Scale With Window" board is exactly
// gridScale(refWidth -> targetWidth), and for every other board is the
// uniform zoom that makes the export look like the screen.
//
// Videos draw their thumbnails, as in previews: trims and freeze frames
// would need the server (see the design doc's deferred section).

import {
  MosaicExtent,
  canvasClampFactor,
  foldRows,
  mosaicGeometry,
} from "@/lib/pinboardGeometry"
import { effectiveGrid, gridScale, parseBoard } from "@/lib/pinboardGrid"
import {
  PIN_CORNER_RADIUS_PX,
  canvasToBlob,
  drawPin,
  loadImage,
} from "@/lib/pinboardPreview"
import { getFileURL } from "@/lib/utils"

const JPEG_QUALITY = 0.92
export const MOSAIC_MIME = "image/jpeg"

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
  seamless: boolean
  extent: MosaicExtent
  /** The board's "Scale With Window" flag (pbp). */
  proportional: boolean
  /** Page background, painted under the pins (JPEG has no alpha). */
  background: string
}

export interface ComposedMosaic {
  blob: Blob
  width: number
  height: number
  /**
   * The width actually composited when the canvas guard had to shrink the
   * request, or null when the preset was honored — the caller says so.
   */
  clampedWidth: number | null
}

export async function composeBoardMosaic(
  opts: MosaicOptions
): Promise<ComposedMosaic | null> {
  const {
    layout,
    dbs,
    boardWidth,
    boardHeight,
    seamless,
    extent,
    proportional,
    background,
  } = opts
  const parsed = parseBoard(layout)
  if (parsed.records.length === 0 || boardWidth <= 0) return null

  // What the board is rendering with right now: the fold is measured
  // against THIS grid (it is a property of the window the user is looking
  // at), and the target-width zoom is layered on top of it.
  const liveScale = gridScale(proportional, parsed.refWidth, boardWidth)
  const liveGrid = effectiveGrid(parsed.grid, liveScale)
  const visibleRows = Math.max(
    foldRows(liveGrid, boardHeight),
    parsed.highWater
  )

  // Canvas guard: the geometry is pure math, so an oversized request is
  // resolved by re-solving at a smaller width — never by allocating a
  // canvas the browser would hand back blank. The loop is a formality
  // (one pass is exact up to rounding); it terminates on the iteration
  // count either way.
  let width = Math.max(1, Math.round(opts.targetWidth))
  let clampedWidth: number | null = null
  let solved: ReturnType<typeof mosaicGeometry> = null
  for (let i = 0; i < 4; i++) {
    solved = mosaicGeometry({
      records: parsed.records,
      grid: effectiveGrid(parsed.grid, liveScale * (width / boardWidth)),
      layoutWidth: width,
      seamless,
      extent,
      visibleRows,
    })
    if (!solved) return null
    const factor = canvasClampFactor(solved.width, solved.height)
    if (factor >= 1) break
    width = Math.max(1, Math.floor(width * factor * 0.999))
    clampedWidth = width
  }
  if (!solved) return null
  const geo = solved

  const canvas = document.createElement("canvas")
  canvas.width = geo.width
  canvas.height = geo.height
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.fillStyle = background
  ctx.fillRect(0, 0, geo.width, geo.height)

  // Items starting past the bottom cut are not drawn at all; the ones the
  // cut crosses are clipped by the canvas edge, like the preview's cap.
  const bottom = geo.cropTop + geo.height
  const visible = geo.placements.filter((p) => p.top < bottom)
  const images = await Promise.allSettled(
    visible.map((p) =>
      loadImage(getFileURL(dbs, "thumbnail", "sha256", p.sha256))
    )
  )

  // Cards are `rounded` (4px) at board scale, so the corner has to grow
  // with the export or a 3840px mosaic would look square-cornered anyway.
  const radius = seamless
    ? 0
    : PIN_CORNER_RADIUS_PX * Math.max(1, width / boardWidth)
  for (let i = 0; i < visible.length; i++) {
    const p = visible[i]
    const loaded = images[i]
    drawPin(
      ctx,
      p,
      loaded.status === "fulfilled" ? loaded.value : null,
      p.left - geo.cropLeft,
      p.top - geo.cropTop,
      p.width,
      p.height,
      radius
    )
  }

  const blob = await canvasToBlob(canvas, MOSAIC_MIME, JPEG_QUALITY)
  return { blob, width: geo.width, height: geo.height, clampedWidth }
}
