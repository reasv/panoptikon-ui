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

// Type-only where it is a type: node's --experimental-strip-types (the state
// rules below are asserted from scripts/compose.test.mjs) cannot erase a type
// hiding in a value import list.
import type { PinSource } from "@/lib/pinboardPreview"
import { imageSource, loadImage } from "@/lib/pinboardPreview"
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

/**
 * What a pin's video element is DOING, as the composition document needs to
 * know it: is it playing (so the item composes as a span), and is it muted (so
 * its audio is mixed in or not).
 *
 * `duration` rides along because this probe is the only place it can be read
 * for an element whose item metadata has no recorded length — a span needs an
 * end bound, and the server refuses one without it. The metadata's duration
 * wins where both exist; this is the fallback, not the authority.
 *
 * The playhead position rides along too, but it is only ever COMPOSED for a
 * stopped element: a paused or ended player's playhead IS the picture on the
 * board, exactly as the static mosaic draws it, so a still keyed on it is the
 * same-picture rule at work. A PLAYING pin's span stays keyed on its trim,
 * never on where the playhead happens to be a moment after the click — a
 * document keyed on a moving number would mint a fresh artifact for every
 * export of an unchanged board.
 */
export interface PinVideoState {
  playing: boolean
  muted: boolean
  /** The element's own duration in seconds, when it is a finite number. */
  duration: number | null
  /**
   * The element's playhead in seconds, null when it is not a finite number.
   * Read for the paused/ended freeze frame (see above); never composed for a
   * playing element.
   */
  currentTime: number | null
  /**
   * The element's NATURAL pixel size (`videoWidth`/`videoHeight`), null until
   * it has metadata.
   *
   * The same numbers `findPinVideoFrame` hands the canvas compositor, carried
   * so the composition document can be written in them too. A browser reports
   * a rotated video already rotated and a non-square-pixel one already
   * corrected, where the index records the container's coded dimensions — and
   * the server's compositor assumes the browser's reading, so a document built
   * on the index's would place a rect the canvas mosaic never drew.
   */
  width: number | null
  height: number | null
}

/**
 * The subset of an `HTMLVideoElement` the state rules read. Structural on
 * purpose: the resolution table below is pure, so it can be asserted against a
 * plain object in a node script (scripts/compose.test.mjs) rather than only
 * against a browser.
 */
export interface VideoStateProbe {
  paused: boolean
  ended: boolean
  readyState: number
  muted: boolean
  duration: number
  /** Optional: a plain-object fixture without one reads as "unknown". */
  currentTime?: number
  /** Optional: an element with no metadata yet reports 0 for both. */
  videoWidth?: number
  videoHeight?: number
}

/**
 * One element's state, or null when there is no element to read.
 *
 * PLAYING is `!paused && !ended && readyState >= HAVE_CURRENT_DATA`: the same
 * three conditions `findPinVideoFrame` implies for a drawable frame, spelled
 * out because "the user sees this moving" is exactly what makes an item a span
 * rather than a frozen frame. A paused element is a still even when it is
 * perfectly decoded, and an ENDED one is a still too — its picture is the last
 * frame, not a clip about to run.
 */
export function videoStateOf(video: VideoStateProbe | null): PinVideoState | null {
  if (!video) return null
  const duration = video.duration
  const natural = (value: number | undefined) =>
    typeof value === "number" && isFinite(value) && value > 0 ? value : null
  const currentTime = video.currentTime
  return {
    playing:
      !video.paused && !video.ended && video.readyState >= HAVE_CURRENT_DATA,
    muted: !!video.muted,
    duration:
      typeof duration === "number" && isFinite(duration) && duration > 0
        ? duration
        : null,
    // 0 is a real playhead (a pin parked at its first frame), so only a
    // non-finite reading is "unknown".
    currentTime:
      typeof currentTime === "number" && isFinite(currentTime) && currentTime >= 0
        ? currentTime
        : null,
    width: natural(video.videoWidth),
    height: natural(video.videoHeight),
  }
}

/**
 * The state of the <video> a pin is rendering, or null when it is rendering
 * none (an image pin, an unmounted board, a video the user never started).
 *
 * Probed from the DOM for the reason `findPinVideoFrame` documents: the export
 * surfaces are menus that outlive any particular pin's React tree.
 */
export function probePinVideoState(key: string): PinVideoState | null {
  if (typeof document === "undefined") return null
  const video = document.querySelector<HTMLVideoElement>(
    `[data-pin-key="${CSS.escape(key)}"] video`
  )
  return videoStateOf(video)
}

/** The natural pixel size of the thumbnail a closed pin is rendering. */
export interface PinThumbnailSize {
  width: number
  height: number
}

/**
 * The natural size of the `<img>` a pin is showing, or null when there is
 * none to measure (an unmounted board, an image still loading).
 *
 * This is the source-rectangle space of a `source: thumbnail` composition
 * item (docs/compose-still-video-parity-design.md §3): the closed video's
 * export composites the stored thumbnail, so its `src` rect is measured in
 * the thumbnail's own pixels — the exact numbers the static mosaic draws
 * with, read off the same element. Probed from the DOM for the reason
 * `findPinVideoFrame` documents. Only consulted for a pin with no mounted
 * `<video>`; a null answer is the builder's cue to fall back to a
 * file-source still.
 */
export function probePinThumbnailSize(key: string): PinThumbnailSize | null {
  if (typeof document === "undefined") return null
  const img = document.querySelector<HTMLImageElement>(
    `[data-pin-key="${CSS.escape(key)}"] img`
  )
  if (!img || !img.complete) return null
  if (!(img.naturalWidth > 0) || !(img.naturalHeight > 0)) return null
  // Raw naturals, placeholder included: whether what is measured is a real
  // thumbnail is `resolveItemRendering`'s question (the pure layer, where
  // the answer is testable), not this probe's.
  return { width: img.naturalWidth, height: img.naturalHeight }
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
