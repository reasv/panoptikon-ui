// Client-side pinboard preview compositor.
//
// At save time the board's geometry is fully known (grid params + records),
// so the preview is drawn from the same math the board renders with — no
// DOM screenshotting. Each pin's effective crop (manual ∘ auto) is placed
// with computeRestGeometry, the exact contain-fit CropView uses at rest, so
// previews cannot drift from what the board displays. Videos draw their
// thumbnail (the same frame the board shows when not playing); trims and
// freeze frames are not sought — best-effort by design.
//
// Capture extends from row 0 down to CAPTURE_SCREENFULS window-heights
// ("screenful" = window.innerHeight, deliberately NOT the scroll area's
// clientHeight: boards are used in the expanded view, and a window-derived
// screenful keeps re-saves from reflowing the crop line with whatever
// chrome happened to be open). Content below the cap — typically scratch
// stacks — is simply not part of the preview; the item count still says
// it exists.
//
// The capture is then cropped to the content bounding box (keeping
// grid.padding as a margin): a one-pin board previews as the pin, not as
// a screen-wide strip of background. This trades save-time-screen
// fidelity for legible thumbnails — the deliberate choice here.
// screenfulH still marks one save-time screenful measured from the top of
// the (cropped) image, for consumers that want the above-the-fold cut.
//
// The cell mapping this draws with lives in pinboardGeometry.ts, and the
// per-pin draw step (drawPin) is exported from here: the mosaic export
// (pinboardMosaic.ts) is the same compositor at a chosen width, and the
// two must not be able to drift into two different pictures of one board.

import {
  PinOrientation,
  isIdentityOrientation,
  orientedSize,
  sourceRect,
} from "@/lib/pinboardCrop"
import { effectiveGrid, gridScale, parseBoard } from "@/lib/pinboardGrid"
import { PinPlacement, parsePlacements } from "@/lib/pinboardGeometry"
import { computeRestGeometry } from "@/components/gallery/CropView"
import { getFileURL } from "@/lib/utils"

// Output width of the composited preview in pixels. One constant, tunable
// without schema or API changes: preview_w/preview_h record what each
// version was actually rendered at, and the serving endpoint downscales.
export const PREVIEW_WIDTH = 1024
// How many window-heights of board (from the top) the preview captures.
export const CAPTURE_SCREENFULS = 2
const WEBP_QUALITY = 0.82
// Pin cards render with `rounded` (0.25rem); scaled into preview space.
export const PIN_CORNER_RADIUS_PX = 4

export interface ComposedPreview {
  blob: Blob
  width: number
  height: number
  /** One save-time screenful, in preview-image pixels. */
  screenfulH: number
}

// Set up the canvas so a source-proportioned drawImage lands with its
// ORIENTED bounding box exactly filling (L,T,W,H); returns the destination
// rect to draw at. Canvas transforms post-multiply, so the calls read in
// the same order as the codec's composition
// (display = flipH^flipped o rotateCW^quarterTurns) and as CropView's CSS
// transform list: the mirror acts on the already-rotated box, and each
// piece carries the translate that brings the result back into the
// positive quadrant. Identity never touches the matrix, so unoriented pins
// keep the exact draw call they had before orientation existed.
function orientDraw(
  ctx: CanvasRenderingContext2D,
  L: number,
  T: number,
  W: number,
  H: number,
  o: PinOrientation | null
): [number, number, number, number] {
  if (isIdentityOrientation(o)) return [L, T, W, H]
  ctx.translate(L, T)
  if (o!.flipped) {
    ctx.translate(W, 0)
    ctx.scale(-1, 1)
  }
  if (o!.quarterTurns === 1) {
    ctx.translate(W, 0)
    ctx.rotate(Math.PI / 2)
  } else if (o!.quarterTurns === 2) {
    ctx.translate(W, H)
    ctx.rotate(Math.PI)
  } else if (o!.quarterTurns === 3) {
    ctx.translate(0, H)
    ctx.rotate(-Math.PI / 2)
  }
  return o!.quarterTurns % 2 ? [0, 0, H, W] : [0, 0, W, H]
}

// One pin onto the canvas, at a rect already in canvas coordinates: the
// step both compositors share. `img` null (or a load failure the caller
// turned into null) draws the placeholder tile instead of leaving a hole;
// a loaded image with no intrinsic size draws nothing, which is what the
// preview has always done. `cornerRadius` 0 draws square (seamless
// mosaics, where rounded corners would punch holes in the tiling).
export function drawPin(
  ctx: CanvasRenderingContext2D,
  p: PinPlacement,
  img: HTMLImageElement | null,
  cellLeft: number,
  cellTop: number,
  cellW: number,
  cellH: number,
  cornerRadius: number
): void {
  ctx.save()
  if (cornerRadius > 0 && typeof ctx.roundRect === "function") {
    ctx.beginPath()
    ctx.roundRect(cellLeft, cellTop, cellW, cellH, cornerRadius)
    ctx.clip()
  }

  if (img) {
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    if (nw > 0 && nh > 0) {
      const c = p.crop ?? { x: 0, y: 0, w: 1, h: 1 }
      // Crops are stored in display space, so the fit runs on the
      // ORIENTED dimensions — exactly as CropView computes it — while
      // drawImage's source rect has to be mapped back to source space.
      const [ow, oh] = orientedSize(nw, nh, p.orient)
      const geo = computeRestGeometry(cellW, cellH, c, ow, oh)
      const s = sourceRect(c, p.orient)
      ctx.save()
      const [dx, dy, dw, dh] = orientDraw(
        ctx,
        cellLeft + geo.visL,
        cellTop + geo.visT,
        geo.visW,
        geo.visH,
        p.orient
      )
      ctx.drawImage(img, s.x * nw, s.y * nh, s.w * nw, s.h * nh, dx, dy, dw, dh)
      ctx.restore()
    }
  } else {
    // Missing item (deleted from the index, network failure): a flat
    // placeholder tile in the pin's spot rather than a hole.
    ctx.fillStyle = "rgba(127, 127, 127, 0.35)"
    ctx.fillRect(cellLeft, cellTop, cellW, cellH)
  }
  ctx.restore()
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`failed to load ${src}`))
    img.src = src
  })
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // toBlob falls back to PNG when the browser can't encode the requested
    // format; the gateway sniffs the actual format on serve, so that's fine
    // for previews, and a download just gets a bigger file.
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("canvas export failed")),
      mime,
      quality
    )
  })
}

/** The rendered pinboard grid element, when the board is on screen. */
export function findBoardElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".react-grid-layout.layout")
}

/**
 * The board's scroll viewport, when the board is on screen: the element
 * whose clientHeight the fill verbs measure the fold against (see
 * usePinboardLayoutActions.foldRows — it is handed this same node as
 * `pinboardRef`). Probed from the DOM rather than published through the
 * board API because the export surfaces (tab chevron, fullscreen bar) also
 * run with the board unmounted, exactly like findBoardElement.
 */
export function findBoardViewport(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-pinboard-area]")
}

/**
 * Composites a preview of the given board state (the raw `pinboard` URL
 * param array). `boardWidth` is the rendered board's pixel width; when the
 * board isn't currently rendered, callers fall back to window.innerWidth,
 * which is what the expanded view would give it.
 *
 * `proportional` is the board's "Scale With Window" flag (pbp). With it on,
 * the board on screen is drawn on the token's reference width scaled to
 * boardWidth, so the composite has to use the same effective grid or the
 * saved preview would not match what the user is looking at.
 */
export async function composeBoardPreview(
  savedLayout: string[],
  dbs: { index_db: string | null; user_data_db: string | null },
  boardWidth: number,
  background: string,
  proportional = false
): Promise<ComposedPreview | null> {
  const parsed = parseBoard(savedLayout)
  const records = parsed.records
  const grid = effectiveGrid(
    parsed.grid,
    gridScale(proportional, parsed.refWidth, boardWidth)
  )
  const placements = parsePlacements(records, grid, boardWidth)
  if (placements.length === 0 || boardWidth <= 0) return null

  const contentHeight =
    Math.max(...placements.map((p) => p.top + p.height)) + grid.padding
  const screenful = window.innerHeight
  const captureHeight = Math.min(
    contentHeight,
    CAPTURE_SCREENFULS * screenful
  )

  // Content bounding box, padded by grid.padding and clamped to the board
  const cropLeft = Math.max(
    0,
    Math.min(...placements.map((p) => p.left)) - grid.padding
  )
  const cropTop = Math.max(
    0,
    Math.min(...placements.map((p) => p.top)) - grid.padding
  )
  const cropRight = Math.min(
    boardWidth,
    Math.max(...placements.map((p) => p.left + p.width)) + grid.padding
  )
  const cropW = cropRight - cropLeft
  const cropH = captureHeight - cropTop
  if (cropW <= 0 || cropH <= 0) return null

  const scale = Math.min(1, PREVIEW_WIDTH / cropW)
  const outWidth = Math.round(cropW * scale)
  const outHeight = Math.round(cropH * scale)
  // First-screen cut in cropped-image coordinates; if the content starts
  // below the first screen entirely, the whole image is the screenful.
  const firstScreenH = Math.min(cropH, screenful - cropTop)
  const screenfulH = Math.round(
    (firstScreenH > 0 ? firstScreenH : cropH) * scale
  )

  const canvas = document.createElement("canvas")
  canvas.width = outWidth
  canvas.height = outHeight
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.fillStyle = background
  ctx.fillRect(0, 0, outWidth, outHeight)

  const visible = placements.filter(
    (p) => (p.top - cropTop) * scale < outHeight
  )
  const images = await Promise.allSettled(
    visible.map((p) =>
      loadImage(getFileURL(dbs, "thumbnail", "sha256", p.sha256))
    )
  )

  for (let i = 0; i < visible.length; i++) {
    const p = visible[i]
    const loaded = images[i]
    drawPin(
      ctx,
      p,
      loaded.status === "fulfilled" ? loaded.value : null,
      (p.left - cropLeft) * scale,
      (p.top - cropTop) * scale,
      p.width * scale,
      p.height * scale,
      PIN_CORNER_RADIUS_PX
    )
  }

  const blob = await canvasToBlob(canvas, "image/webp", WEBP_QUALITY)
  return { blob, width: outWidth, height: outHeight, screenfulH }
}

/** URL of a stored version preview (immutable; browser-cacheable per size). */
export function pinboardPreviewURL(
  dbs: { index_db: string | null; user_data_db: string | null },
  pinboardId: number,
  versionId: number,
  maxw?: number
): string {
  const params = new URLSearchParams()
  if (dbs.index_db) params.set("index_db", dbs.index_db)
  if (dbs.user_data_db) params.set("user_data_db", dbs.user_data_db)
  if (maxw) params.set("maxw", maxw.toString())
  const query = params.toString()
  return `/api/pinboards/${pinboardId}/versions/${versionId}/preview${query ? `?${query}` : ""}`
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = reader.result as string
      resolve(url.slice(url.indexOf(",") + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
