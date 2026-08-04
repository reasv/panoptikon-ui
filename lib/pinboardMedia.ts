// Where a pin's pixels come from when something composites it.
//
// The board itself always renders the THUMBNAIL endpoint, which is either
// the original file (images at or below 4096px and 24MB are served
// untouched) or a 4096px-max JPEG. That is the right source for a mosaic:
// every cell is a fraction of the canvas, and pulling full originals for a
// board of a hundred pins would move gigabytes to draw thumbnails' worth of
// detail.
//
// Two cases want something else:
//
//   ORIGINAL — a single item exported on its own is an image editor's
//   output, not a card in a collage, so it loads the file endpoint and
//   keeps every pixel the source has. Only ever asked for on items known to
//   be images: pointing an <img> at a video URL downloads the video to fail
//   decoding it.
//
//   LIVE FRAME — a video that is on screen has a <video> element holding
//   the frame the user is looking at, and canvas can draw from it directly.
//   That is the whole video-support story client-side: what plays is what
//   exports, at the video's own resolution, with the pin's crop and
//   orientation applied like any other source. Everything else about video
//   frames (seeking to a trim point, exporting a video that isn't mounted,
//   picking a frame without playing it) needs the server and is out of
//   scope — those pins fall back to the stored thumbnail, exactly as the
//   board mosaic has always done.
//
// Every source is same-origin (the /api paths the app already serves
// through), so nothing here taints the canvas and toBlob keeps working.

import { PinSource, imageSource, loadImage } from "@/lib/pinboardPreview"
import { getFileURL } from "@/lib/utils"

type Dbs = { index_db: string | null; user_data_db: string | null }

// HTMLMediaElement.HAVE_CURRENT_DATA: there is a frame at the current
// position. Anything below it would draw a blank rectangle.
const HAVE_CURRENT_DATA = 2

/**
 * The frame a pin's <video> is showing right now, or null when the pin
 * isn't rendering video (not playable, not started, not mounted) or hasn't
 * decoded a frame yet.
 *
 * Probed from the DOM rather than published through the board API for the
 * same reason findBoardElement is: the export surfaces are menus that
 * outlive any particular pin's React tree, and a registry of live video
 * elements would be one more thing to keep in sync with mount order.
 */
export function findPinVideoFrame(key: string): PinSource | null {
  const video = document.querySelector<HTMLVideoElement>(
    `[data-pin-key="${CSS.escape(key)}"] video`
  )
  if (!video || video.readyState < HAVE_CURRENT_DATA) return null
  if (!(video.videoWidth > 0) || !(video.videoHeight > 0)) return null
  return { source: video, width: video.videoWidth, height: video.videoHeight }
}

export interface PinSourceRequest {
  /** Layout key, for the live-frame probe. */
  key: string
  sha256: string
  dbs: Dbs
  /**
   * Load the file endpoint instead of the thumbnail. Callers must only set
   * this for items whose mime type is an image (see the header).
   */
  original?: boolean
}

/**
 * A pin's best available draw source: its live video frame if it has one,
 * otherwise the requested still.
 *
 * An original that fails to load falls back to the thumbnail rather than
 * failing the export — the file endpoint serves whatever is on disk, and
 * browsers decode fewer formats than the indexer accepts (TIFF, JXL, some
 * AVIF profiles), while the thumbnail is always a JPEG. A thumbnail that
 * fails too returns null, which drawPin renders as the placeholder tile.
 */
export async function loadPinSource(
  req: PinSourceRequest
): Promise<PinSource | null> {
  const frame = findPinVideoFrame(req.key)
  if (frame) return frame
  if (req.original) {
    try {
      return imageSource(
        await loadImage(getFileURL(req.dbs, "file", "sha256", req.sha256))
      )
    } catch {
      /* fall through to the thumbnail */
    }
  }
  try {
    return imageSource(
      await loadImage(getFileURL(req.dbs, "thumbnail", "sha256", req.sha256))
    )
  } catch {
    return null
  }
}
