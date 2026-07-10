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
// it exists. The library crops cards to the first screenful (screenfulH)
// and lets the rest be panned.

import { composeCrops, parseHField } from "@/lib/pinboardCrop"
import { GridParams, parseBoard, rowStep } from "@/lib/pinboardGrid"
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
const PIN_CORNER_RADIUS_PX = 4

export interface ComposedPreview {
  blob: Blob
  width: number
  height: number
  /** One save-time screenful, in preview-image pixels. */
  screenfulH: number
}

interface PinPlacement {
  sha256: string
  // Cell rect in board pixels
  left: number
  top: number
  width: number
  height: number
  crop: ReturnType<typeof composeCrops>
}

// react-grid-layout's cell-to-pixel mapping, as used by GalleryPinBoard
function cellRect(
  grid: GridParams,
  boardWidth: number,
  x: number,
  y: number,
  w: number,
  h: number
): { left: number; top: number; width: number; height: number } {
  const colWidth =
    (boardWidth - 2 * grid.padding - (grid.columns - 1) * grid.margin) /
    grid.columns
  return {
    left: grid.padding + x * (colWidth + grid.margin),
    top: grid.padding + y * rowStep(grid),
    width: w * colWidth + (w - 1) * grid.margin,
    height: h * grid.rowHeight + (h - 1) * grid.margin,
  }
}

function parsePlacements(
  records: string[],
  grid: GridParams,
  boardWidth: number
): PinPlacement[] {
  const placements: PinPlacement[] = []
  for (let i = 0; i + 4 < records.length; i += 5) {
    const [sha256, x, y, w, hField] = records.slice(i, i + 5)
    if (sha256 === "__preview") continue
    const { h, crop, autoCrop } = parseHField(hField)
    placements.push({
      sha256,
      ...cellRect(
        grid,
        boardWidth,
        parseInt(x),
        parseInt(y),
        parseInt(w),
        h
      ),
      crop: composeCrops(crop, autoCrop),
    })
  }
  return placements
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`failed to load ${src}`))
    img.src = src
  })
}

function canvasToWebP(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // toBlob falls back to PNG when the browser can't encode WebP; the
    // gateway sniffs the actual format on serve, so that's fine.
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("canvas export failed")),
      "image/webp",
      WEBP_QUALITY
    )
  })
}

/** The rendered pinboard grid element, when the board is on screen. */
export function findBoardElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".react-grid-layout.layout")
}

/**
 * Composites a preview of the given board state (the raw `pinboard` URL
 * param array). `boardWidth` is the rendered board's pixel width; when the
 * board isn't currently rendered, callers fall back to window.innerWidth,
 * which is what the expanded view would give it.
 */
export async function composeBoardPreview(
  savedLayout: string[],
  dbs: { index_db: string | null; user_data_db: string | null },
  boardWidth: number,
  background: string
): Promise<ComposedPreview | null> {
  const { grid, records } = parseBoard(savedLayout)
  const placements = parsePlacements(records, grid, boardWidth)
  if (placements.length === 0 || boardWidth <= 0) return null

  const contentHeight =
    Math.max(...placements.map((p) => p.top + p.height)) + grid.padding
  const screenful = window.innerHeight
  const captureHeight = Math.min(
    contentHeight,
    CAPTURE_SCREENFULS * screenful
  )

  const scale = Math.min(1, PREVIEW_WIDTH / boardWidth)
  const outWidth = Math.round(boardWidth * scale)
  const outHeight = Math.round(captureHeight * scale)
  const screenfulH = Math.round(Math.min(screenful, captureHeight) * scale)

  const canvas = document.createElement("canvas")
  canvas.width = outWidth
  canvas.height = outHeight
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.fillStyle = background
  ctx.fillRect(0, 0, outWidth, outHeight)

  const visible = placements.filter((p) => p.top * scale < outHeight)
  const images = await Promise.allSettled(
    visible.map((p) =>
      loadImage(getFileURL(dbs, "thumbnail", "sha256", p.sha256))
    )
  )

  for (let i = 0; i < visible.length; i++) {
    const p = visible[i]
    const cellLeft = p.left * scale
    const cellTop = p.top * scale
    const cellW = p.width * scale
    const cellH = p.height * scale

    ctx.save()
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath()
      ctx.roundRect(cellLeft, cellTop, cellW, cellH, PIN_CORNER_RADIUS_PX)
      ctx.clip()
    }

    const loaded = images[i]
    if (loaded.status === "fulfilled") {
      const img = loaded.value
      const nw = img.naturalWidth
      const nh = img.naturalHeight
      if (nw > 0 && nh > 0) {
        const c = p.crop ?? { x: 0, y: 0, w: 1, h: 1 }
        const geo = computeRestGeometry(cellW, cellH, c, nw, nh)
        ctx.drawImage(
          img,
          c.x * nw,
          c.y * nh,
          c.w * nw,
          c.h * nh,
          cellLeft + geo.visL,
          cellTop + geo.visT,
          geo.visW,
          geo.visH
        )
      }
    } else {
      // Missing item (deleted from the index, network failure): a flat
      // placeholder tile in the pin's spot rather than a hole.
      ctx.fillStyle = "rgba(127, 127, 127, 0.35)"
      ctx.fillRect(cellLeft, cellTop, cellW, cellH)
    }
    ctx.restore()
  }

  const blob = await canvasToWebP(canvas)
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
