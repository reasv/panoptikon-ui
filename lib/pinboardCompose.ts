// The composition document: a pinboard, as the server's compositor sees it.
//
// `POST /api/video/compose` takes a canvas, a frame rate, a length policy and
// a list of PLACED items — each one a source rectangle, a display transform, a
// destination rectangle and a slice of time. This module turns the board the
// user is looking at into exactly that (implementation plan §4 C6).
//
// THE POINT IS THAT IT IS THE SAME PICTURE. The static mosaic export
// (pinboardMosaic.ts) and this builder run the identical solve — the same live
// grid scale, the same visible-row count, the same `mosaicGeometry`, the same
// clamp loop — and the same per-pin composition (`resolvePinDraw`, extracted
// out of the canvas compositor for exactly this reason). A rectangle here that
// disagreed with the canvas by a pixel would be a mosaic that moves when it
// starts playing.
//
// Four things the canvas never has to think about, and this does:
//
//   1. INTEGER PIXELS. Canvas draws at fractional coordinates; ffmpeg's
//      `crop`/`scale`/`overlay` take integers. Source rects round into the
//      source's own pixels, destination rects into the canvas's.
//   2. EVEN POSITIONS. `overlay` silently snaps an odd offset down onto the
//      4:2:0 chroma grid, so a rectangle placed at an odd x renders one pixel
//      off where it was solved with nothing to say so — the server refuses it
//      (`dest_not_even`) rather than let that happen. SIZES are free: `scale`
//      produces exactly what it is asked for. So positions are rounded to even
//      and sizes are not, and the up-to-one-pixel shift that costs is the
//      chroma grid's price, paid where it is visible in one place.
//   3. THE EDGE. A canvas clips for free: draw past it and the bitmap ends.
//      A filtergraph scales the source into whatever rectangle it is given, so
//      a pin the capture box cuts has to be cut in BOTH spaces or it arrives
//      squashed (`clipPinDrawToCanvas`).
//   4. TIME. A canvas composites one frame; a composition composites a span,
//      a frozen frame or a still image per item (see `resolveItemTime`) — and
//      every item shorter than the output is held open by a loop buffer, whose
//      size the client has to estimate before it asks (`estimateLoopBytes`).
//
// Everything here is pure: no DOM, no fetch. The metadata lookup and the live
// video-state probe arrive as functions, which is what lets the whole builder
// be asserted from a plain node script (scripts/compose.test.mjs).

import type { components } from "@/lib/panoptikon"
import type { CropRect, PinOrientation, TrimRange } from "@/lib/pinboardCrop"
import { sourceRect } from "@/lib/pinboardCrop"
import type { PinVideoState } from "@/lib/pinboardMedia"
import type {
  DrawRect,
  MosaicExtent,
  MosaicFailure,
  PinDraw,
  PinPlacement,
} from "@/lib/pinboardGeometry"
import {
  fitLayoutWidthToOutput,
  foldRows,
  itemOutputSize,
  mosaicGeometry,
  resolvePinDraw,
  solveWithinCanvasLimits,
} from "@/lib/pinboardGeometry"
import { effectiveGrid, gridScale, parseBoard } from "@/lib/pinboardGrid"

type ComposeBody = components["schemas"]["ComposeRequest"]
type ComposeItem = components["schemas"]["ComposeItem"]
type ComposeRect = components["schemas"]["Rect"]
export type ComposeLength = components["schemas"]["ComposeLength"]
export type ItemTime = components["schemas"]["ItemTime"]
type TranscodeLimits = components["schemas"]["TranscodeLimits"]
type Container = components["schemas"]["Container"]

/** The preset fields a document depends on. */
export type ComposePreset = Pick<
  components["schemas"]["TranscodePresetInfo"],
  "id" | "label" | "container"
> & { max_height?: number | null }

/**
 * The item metadata a placed pin needs: its FULL hash (the board's records
 * carry a 10-char prefix, and the document is cache-keyed on what it sends —
 * two spellings of one item would be two artifacts), its natural pixel size,
 * its mime type and its recorded length.
 */
export interface ComposeItemMeta {
  sha256?: string | null
  type?: string | null
  width?: number | null
  height?: number | null
  duration?: number | null
}

/** The animated-image containers, the ones with a length cap on them. */
const ANIMATED_CONTAINERS: ReadonlySet<Container> = new Set(["webp", "avif"])

const isAnimatedContainer = (container: Container): boolean =>
  ANIMATED_CONTAINERS.has(container)

/**
 * Fallback composition limits, for the window between a menu opening and the
 * presets envelope landing. They mirror `media_tools/transcode/compose.rs`'s
 * code constants and the shipped `[transcode]` defaults — the LIVE numbers ride
 * in the envelope (§0.4) and are always preferred; these only keep the builder
 * from having to refuse a document because a fetch is still in flight, and a
 * document they get wrong earns a 422 whose message says so.
 */
const FALLBACK_LIMITS = {
  minCanvasSide: 16,
  maxCanvasSide: 4096,
  maxCanvasArea: 3840 * 2160,
  maxComposeFps: 60,
  maxMosaicInputs: 12,
  maxMosaicLoopMb: 512,
  maxAnimatedImageSeconds: 30,
  maxOutputSeconds: 300,
  // Deliberately EMPTY, not a mirror of the server's unconditional entries
  // (`image/gif`, and `image/webp` via its Rust-side bridge): while the
  // limits are in flight nothing is known about the server's capabilities,
  // and the conservative reading composes an animated image as a frozen
  // frame rather than risking a span the server cannot play. A frozen
  // mosaic is degraded; a failed job is a broken export.
  spanCapableImageMimes: [] as readonly string[],
} as const

/** `compose.rs`'s `BYTES_PER_MB` — the loop budget is stated in MiB. */
const BYTES_PER_MB = 1024 * 1024

/** Frame rate a mosaic is composed at unless the server caps it lower. */
export const DEFAULT_COMPOSE_FPS = 30

/**
 * What a stills-only document runs for, in seconds: `compose.rs`'s
 * `STILLS_ONLY_TARGET_CS`. A frozen mosaic is a legitimate thing to ask for,
 * and the alternative is a zero-length file.
 */
export const STILLS_ONLY_TARGET_SECONDS = 1

// ---- time (pure) --------------------------------------------------------

/** Seconds onto the wire's centisecond lattice. */
function toCs(seconds: number): number {
  return Math.max(0, Math.round(seconds * 100))
}

export interface ItemTimeInput {
  /** Only a video has a still or a trim-driven span; see below for images. */
  isVideo: boolean
  /** The pin's own trim, off its h field. */
  trim: TrimRange | null
  /** The live DOM state of this pin's <video>, or null when it has none. */
  state: PinVideoState | null
  /** The item's recorded duration in seconds, when the index knows one. */
  duration: number | null
  /** The item's mime type, for the animated-image rule below. */
  mime?: string | null
  /**
   * The limits envelope's `span_capable_image_mimes`: the image containers
   * the server can play animation from — natively via its ffmpeg, or via
   * the Rust-side extraction bridge for animated WebP, which no ffmpeg
   * decodes (docs/animated-webp-bridge-design.md). Absent or empty reads as
   * "none", which composes an animated image frozen — the safe direction
   * while the envelope is in flight.
   */
  spanCapableImageMimes?: readonly string[]
}

/**
 * What one pin is showing, as the document's time enum (§0.5: a span *is*
 * playing, a still and an image are stopped, so no two fields can contradict).
 *
 * The rules, and why each one is the honest reading of the board:
 *
 *   NOT A VIDEO → `image`… unless the index measured an animation length
 *   AND the server listed this container as span-capable
 *   (docs/animated-image-spans-design.md §6): then the full `0..duration`
 *   span, always. An animated image on the board PLAYS — it has no <video>
 *   element, no trim, no play/pause state to consult — so the whole
 *   animation is the only honest span, and it loops or trims to the target
 *   exactly like a video span does. A still (duration 0), an unmeasured item
 *   (null), or a container off the capability list stays a frozen `image`.
 *
 *   MOUNTED AND PLAYING → `span`, from the pin's trim: start is `trim.start`
 *   (or 0), end is `trim.end` (or the item's length). What the user set the
 *   pin up to loop, not where its playhead happens to be — a document keyed on
 *   a moving number would mint a new artifact for every export of an unchanged
 *   board.
 *
 *   …UNLESS THE END IS UNKNOWABLE. `end_cs` is REQUIRED for a span (the target
 *   length is arithmetic over the document, never a probe of every input), so
 *   an untrimmed video whose duration neither the index nor the element knows
 *   composes as a still instead of being refused.
 *
 *   PAUSED, ENDED OR UNMOUNTED → `still`. Its frame is the trim's start, which
 *   for an equal-bounds trim IS the freeze frame the pin is parked on. An
 *   untrimmed stopped video freezes at 0 — accepted, and worth naming: the
 *   board shows such a pin its THUMBNAIL, which is not usually frame 0, so the
 *   animated save can differ from the still one there.
 *
 * A still's timestamp is clamped inside the item's recorded length: the server
 * refuses `at_cs` at or past it by name (`still_past_end`), and there is
 * nothing to learn from a round trip that says so.
 */
export function resolveItemTime(input: ItemTimeInput): ItemTime {
  if (!input.isVideo) {
    const duration = input.duration
    if (
      duration != null &&
      isFinite(duration) &&
      duration > 0 &&
      input.mime != null &&
      (input.spanCapableImageMimes ?? []).includes(input.mime)
    ) {
      // Sub-centisecond animations round to `span{0,0}`, which the server
      // refuses outright (`span_not_a_clip`) — and one refused item fails the
      // whole board. A frozen frame is what a 4 ms animation means anyway.
      const endCs = toCs(duration)
      if (endCs > 0) return { kind: "span", start_cs: 0, end_cs: endCs }
    }
    return { kind: "image" }
  }
  const trim = input.trim
  const duration =
    input.duration != null && isFinite(input.duration) && input.duration > 0
      ? input.duration
      : (input.state?.duration ?? null)
  if (input.state?.playing) {
    const start = trim?.start ?? 0
    const end = trim?.end ?? duration
    if (end != null) {
      const startCs = toCs(start)
      const endCs = toCs(end)
      // Equal (or inverted) bounds are a freeze frame spelled as a range; the
      // server refuses that shape outright, and a still is what it means.
      if (endCs > startCs) return { kind: "span", start_cs: startCs, end_cs: endCs }
    }
  }
  return { kind: "still", at_cs: stillCs(trim?.start ?? 0, duration) }
}

/**
 * A freeze timestamp, in centiseconds, guaranteed to name a frame that exists.
 * `ceil` on the length, less one centisecond: the server's rule is
 * `at_cs / 100 >= duration` → refused, so the last admissible value is the
 * last centisecond strictly inside the file.
 */
function stillCs(seconds: number, duration: number | null): number {
  const at = toCs(seconds)
  if (duration == null || !(duration > 0)) return at
  return Math.min(at, Math.max(0, Math.ceil(duration * 100) - 1))
}

/** The longest playing span in a document, in seconds; null when nothing plays. */
export function longestSpanSeconds(times: readonly ItemTime[]): number | null {
  let longest: number | null = null
  for (const time of times) {
    if (time.kind !== "span") continue
    const span = (time.end_cs - time.start_cs) / 100
    if (longest == null || span > longest) longest = span
  }
  return longest
}

/**
 * How long the output would run, BEFORE the container's own cap — the number a
 * row is offered or hidden on.
 *
 * Deliberately the unclamped figure: the server clamps rather than refusing
 * (`resolve_target_cs`), so an over-long animated image is not an error, it is
 * a file that silently stops early. Hiding the row is how that is prevented,
 * which means the comparison has to be against what was ASKED for.
 */
export function composeRequestedSeconds(
  length: ComposeLength,
  longest: number | null
): number {
  if (length.mode === "cap") return Math.max(0, length.seconds)
  return longest ?? STILLS_ONLY_TARGET_SECONDS
}

/**
 * Whether one preset may be offered for a composition of this length.
 *
 * BOTH caps are enforced, because the server clamps against both: an
 * animated image is bounded by `max_animated_image_seconds` and a real video
 * by `max_output_seconds` (`resolve_target_cs`). A clip export can leave the
 * mp4 rows alone — a whole-file re-encode is as long as the file is, and the
 * length cap does not apply to it — but a COMPOSITION names its own length, so
 * an over-long one is a file that silently stops early, exactly the outcome
 * hiding the row exists to prevent.
 *
 * An unknown limit counts as no, the same reading lib/videoClip's `clipRowFits`
 * documents: a row that always truncates is worse than no row, and the limits
 * ride in the same envelope as the presets, so "no limits" means "no rows to
 * offer yet" rather than a menu that has to guess.
 */
function composeRowFits(
  preset: ComposePreset,
  requestedSeconds: number,
  limits: TranscodeLimits | null
): boolean {
  const limit = isAnimatedContainer(preset.container)
    ? limits?.max_animated_image_seconds
    : limits?.max_output_seconds
  if (limit == null) return false
  return requestedSeconds <= limit
}

/**
 * The rows one animated section shows, in the server's own order.
 *
 * Labels are the PRESET's, verbatim: the shipped mosaic-surface presets are
 * already named for this menu ("MP4", "MP4 (fast)", "WebM", "Animated WebP"),
 * and a user-declared profile's name is its author's to choose. An empty
 * `presets` array yields no rows at all — which is the whole capability story,
 * exactly as for the clip rows: hide, never disable.
 */
export function composeRows<T extends ComposePreset>(
  presets: T[],
  context: { requestedSeconds: number; limits: TranscodeLimits | null }
): { preset: T; label: string }[] {
  return presets
    .filter((preset) => composeRowFits(preset, context.requestedSeconds, context.limits))
    .map((preset) => ({ preset, label: preset.label }))
}

// ---- the loop-memory guard (pure) --------------------------------------
//
// `compose.rs`'s `check_loop_memory`, mirrored. Every item shorter than the
// output is held open by a loop filter that buffers its whole segment AT
// DESTINATION RESOLUTION (the loop sits after the scale, which is what makes
// this computable at all), so a twelve-pin 4K mosaic of five-second clips can
// ask ffmpeg for gigabytes before a single frame is written. The server
// refuses such a document by name (`loop_memory`), with the estimate in the
// message.
//
// Mirrored here so the CLIENT can shrink instead: the canvas is the client's
// own choice, and a mosaic solved a few hundred pixels narrower is a file the
// user gets rather than a 422 telling them to select fewer pins.

/**
 * The output's length in centiseconds — `resolve_target_cs`, which decides
 * which items loop at all (anything at least as long as the target plays
 * through and buffers nothing).
 */
export function composeTargetCs(
  length: ComposeLength,
  times: readonly ItemTime[],
  container: Container,
  limits: TranscodeLimits | null
): number {
  const maxOutput = limits?.max_output_seconds ?? FALLBACK_LIMITS.maxOutputSeconds
  const maxAnimated =
    limits?.max_animated_image_seconds ?? FALLBACK_LIMITS.maxAnimatedImageSeconds
  const requested =
    length.mode === "cap"
      ? Math.round(Math.min(Math.max(0, length.seconds), maxOutput) * 100)
      : Math.round((longestSpanSeconds(times) ?? STILLS_ONLY_TARGET_SECONDS) * 100)
  const capCs = Math.max(
    1,
    Math.round((isAnimatedContainer(container) ? maxAnimated : maxOutput) * 100)
  )
  return Math.min(Math.max(requested, 1), capCs)
}

/**
 * Frames one looping item buffers: `span_loop`'s segment, which is
 * `frames_for` (a ceiling — a partial frame still occupies one) and zero for
 * anything the loop filter never touches.
 */
function loopSegmentFrames(spanCs: number, targetCs: number, fps: number): number {
  const span = Math.max(0, spanCs)
  if (span === 0 || span >= targetCs) return 0
  return Math.max(1, Math.floor((span * Math.max(1, fps) + 99) / 100))
}

/**
 * What this document would buffer, in bytes: frames times destination pixels
 * times 3/2 (one luma sample plus two quarter-resolution chroma samples, the
 * server's own count). Stills and images hold exactly one frame each — the
 * infinite loop that freezes them still buffers it.
 *
 * Counted at the frame rate the document ASKS for, which is the one number
 * here that can be too high: a preset's `fps_max` caps it silently server-side
 * and is deliberately not published (an over-cap rate is never a rejection, so
 * a client can do nothing with it). Over-estimating only ever clamps the canvas
 * a little sooner than it had to, which is the safe direction for a guard whose
 * other outcome is a refused POST.
 */
export function estimateLoopBytes(
  items: readonly { dest: ComposeRect; time: ItemTime }[],
  fps: number,
  targetCs: number
): number {
  let bytes = 0
  for (const item of items) {
    const frames =
      item.time.kind === "span"
        ? loopSegmentFrames(item.time.end_cs - item.time.start_cs, targetCs, fps)
        : 1
    const pixels = Math.max(0, item.dest.w) * Math.max(0, item.dest.h)
    bytes += Math.floor((frames * pixels * 3) / 2)
  }
  return bytes
}

/** The server's budget for the above, in bytes. */
function loopBudgetBytes(limits: TranscodeLimits | null): number {
  return (limits?.max_mosaic_loop_mb ?? FALLBACK_LIMITS.maxMosaicLoopMb) * BYTES_PER_MB
}

// ---- geometry helpers (pure) -------------------------------------------

/** The largest even integer at or below `v`, floored at 0. */
function evenFloor(v: number): number {
  const n = Math.max(0, Math.floor(v))
  return n - (n % 2)
}

/** The nearest even integer to `v`, floored at 0. */
function evenRound(v: number): number {
  return Math.max(0, Math.round(v / 2) * 2)
}

interface CanvasBounds {
  minSide: number
  maxSide: number
  maxArea: number
  /** The chosen preset's height cap, when it has one. */
  maxHeight: number | null
}

function canvasBounds(
  limits: TranscodeLimits | null,
  preset: ComposePreset
): CanvasBounds {
  return {
    minSide: limits?.min_canvas_side ?? FALLBACK_LIMITS.minCanvasSide,
    maxSide: limits?.max_canvas_side ?? FALLBACK_LIMITS.maxCanvasSide,
    maxArea: limits?.max_canvas_area ?? FALLBACK_LIMITS.maxCanvasArea,
    maxHeight:
      preset.max_height != null && preset.max_height > 0 ? preset.max_height : null,
  }
}

/**
 * The factor a canvas must shrink by to be ADMISSIBLE — the server's twin of
 * `canvasClampFactor`, which answers the same question about the browser.
 *
 * The preset's height cap is in here rather than left to the 422 because the
 * server refuses an over-tall canvas instead of rescaling it
 * (`canvas_over_preset_height`): a rescale would move every rectangle the
 * client placed, which is the pixel-for-pixel guarantee this whole path
 * exists to keep. So the client solves at a height the preset renders, and a
 * 720-tall preset simply produces a smaller mosaic of the same board.
 */
export function composeClampFactor(
  width: number,
  height: number,
  bounds: CanvasBounds
): number {
  if (!(width > 0) || !(height > 0)) return 1
  return Math.min(
    1,
    bounds.maxSide / width,
    bounds.maxSide / height,
    Math.sqrt(bounds.maxArea / (width * height)),
    bounds.maxHeight != null ? bounds.maxHeight / height : 1
  )
}

/**
 * One pin's source rectangle in the source's OWN pixels, before its display
 * orientation — which is what the document means by `src` (the filtergraph
 * crops in source space and rotates afterwards, exactly like the canvas).
 *
 * Floors the origin and rounds the size, then clamps inside the frame: a rect
 * that runs off the edge is clamped at dispatch anyway, and doing it here
 * keeps the document honest about what it asked for.
 */
function sourcePixels(
  src: CropRect,
  naturalW: number,
  naturalH: number
): ComposeRect | null {
  const x = Math.min(Math.max(0, Math.floor(src.x * naturalW)), Math.max(0, naturalW - 1))
  const y = Math.min(Math.max(0, Math.floor(src.y * naturalH)), Math.max(0, naturalH - 1))
  const w = Math.min(Math.max(1, Math.round(src.w * naturalW)), naturalW - x)
  const h = Math.min(Math.max(1, Math.round(src.h * naturalH)), naturalH - y)
  if (w < 1 || h < 1) return null
  return { x, y, w, h }
}

/**
 * One pin's destination rectangle in canvas pixels: position rounded to EVEN
 * (the chroma-grid rule — see the header), size rounded and then clamped so
 * the rectangle stays inside the canvas. Null when nothing of it is left,
 * which is a pin the extent cut away.
 */
function destPixels(dest: DrawRect, canvasW: number, canvasH: number): ComposeRect | null {
  const x = Math.min(evenRound(dest.left), Math.max(0, evenFloor(canvasW - 2)))
  const y = Math.min(evenRound(dest.top), Math.max(0, evenFloor(canvasH - 2)))
  const w = Math.min(Math.max(1, Math.round(dest.width)), canvasW - x)
  const h = Math.min(Math.max(1, Math.round(dest.height)), canvasH - y)
  if (w < 1 || h < 1) return null
  return { x, y, w, h }
}

/**
 * Anything at or below this on either display axis is a phantom sliver: a pin
 * the edge has effectively cut away. The canvas mosaic paints one or two
 * columns of scaled-down pixels there, which is not a picture of anything.
 */
const MIN_VISIBLE_PX = 2

/**
 * One pin's draw, cut by the canvas edge IN BOTH SPACES.
 *
 * THE BUG THIS EXISTS TO PREVENT: a pin the visible-extent fold (or the even
 * canvas, or the board's own right edge) crosses gets a SHORTER destination
 * rectangle. `scale` obeys whatever rectangle it is given, so sending the full
 * source with a two-thirds-height dest squashes the whole frame into it —
 * where the canvas mosaic, which simply draws past the edge and lets the
 * bitmap clip, shows the top two thirds of the picture at its own aspect. Same
 * document, two different mosaics.
 *
 * So the crop is composed in DISPLAY space, before the orientation is unwound.
 * The destination rect IS the crop region rendered (`computeRestGeometry`'s
 * contain fit), so the fraction of the rect the canvas kept is the same
 * fraction of the display-space crop — and mapping that sub-rectangle through
 * the SAME `sourceRect` the whole crop goes through carries the cut onto
 * whichever source axis and side the pin's D4 element sends it to. A bottom
 * cut on an unrotated pin trims the bottom of the source; on a pin turned one
 * quarter clockwise it trims the source's RIGHT edge, because that column is
 * what the turn puts along the display's bottom. Nothing here has to know
 * which: the mapping does it.
 *
 * Null when what survives is a sliver (see MIN_VISIBLE_PX) — a skipped pin,
 * counted in the receipt, rather than a rectangle two pixels wide.
 */
export function clipPinDrawToCanvas(input: {
  /** The pin's picture rect in canvas pixels — `resolvePinDraw`'s `dest`. */
  dest: DrawRect
  /** The pin's crop in DISPLAY space (`placement.crop`); null is the frame. */
  crop: CropRect | null
  orient: PinOrientation | null
  canvasW: number
  canvasH: number
}): PinDraw | null {
  const { dest } = input
  if (!(dest.width > 0) || !(dest.height > 0)) return null
  const left = Math.max(0, dest.left)
  const top = Math.max(0, dest.top)
  const right = Math.min(input.canvasW, dest.left + dest.width)
  const bottom = Math.min(input.canvasH, dest.top + dest.height)
  const width = right - left
  const height = bottom - top
  if (width <= MIN_VISIBLE_PX || height <= MIN_VISIBLE_PX) return null
  const crop = input.crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const visible: CropRect = {
    x: crop.x + ((left - dest.left) / dest.width) * crop.w,
    y: crop.y + ((top - dest.top) / dest.height) * crop.h,
    w: (width / dest.width) * crop.w,
    h: (height / dest.height) * crop.h,
  }
  return {
    src: sourceRect(visible, input.orient),
    dest: { left, top, width, height },
  }
}

// ---- the background (pure) ---------------------------------------------

/**
 * A CSS colour as the `#RRGGBB` the document takes.
 *
 * The page background arrives from `getComputedStyle`, which answers in
 * `rgb()` / `rgba()` — a spelling the server rejects, and rightly: the value is
 * interpolated into a filter argument, so it validates a narrow hex grammar
 * rather than parsing CSS. Anything unrecognised becomes black, which is what
 * a mosaic's gutters have always been.
 */
export function normalizeComposeBackground(css: string | null | undefined): string {
  const value = (css ?? "").trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const digits = hex[1]
    return digits.length === 3
      ? `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`.toLowerCase()
      : `#${digits.toLowerCase()}`
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value)
  if (rgb) {
    const channel = (raw: string) => {
      const n = Math.max(0, Math.min(255, Math.round(Number(raw))))
      return (isFinite(n) ? n : 0).toString(16).padStart(2, "0")
    }
    return `#${channel(rgb[1])}${channel(rgb[2])}${channel(rgb[3])}`
  }
  return "#000000"
}

// ---- the builder --------------------------------------------------------

export interface CompositionOptions {
  /** The raw `pinboard` URL param array — the LIVE board, unsaved edits included. */
  layout: string[]
  /** The rendered board's pixel width (window.innerWidth when unmounted). */
  boardWidth: number
  /** The board scroll viewport's height, for the fold line. */
  boardHeight: number
  /** The preset row that was pressed; its height cap bounds the canvas. */
  preset: ComposePreset
  /** The presets envelope's limits. Null falls back to the mirrored defaults. */
  limits: TranscodeLimits | null
  length: ComposeLength
  /** Frame rate; defaults to 30, capped by the server's own maximum. */
  fps?: number
  /** Target width in px, read per `widthMode`. */
  targetWidth: number
  widthMode?: "layout" | "output"
  seamless: boolean
  extent: MosaicExtent
  /** Layout keys to capture; absent means the whole board. */
  only?: ReadonlySet<string>
  /** The board's "Scale With Window" flag (pbp). */
  proportional: boolean
  /** Page background, as anything `normalizeComposeBackground` reads. */
  background: string
  /** Item metadata, called once per UNIQUE sha (a react-query cache hit). */
  getMeta: (sha256: string) => Promise<ComposeItemMeta | null>
  /** The live state of one pin's <video>, or null when it has none. */
  probe: (key: string) => PinVideoState | null
}

export interface CompositionDoc {
  body: ComposeBody
  width: number
  height: number
  /** How long the output will run, in seconds (before the container's cap). */
  requestedSeconds: number
  /**
   * Pins that could not be placed, by the board's own sha prefix: an item
   * whose metadata never arrived (so its natural size is unknown, and a
   * rectangle cannot be solved), or one the extent cut away entirely. Named
   * rather than silently dropped — the caller says so in the receipt.
   */
  skipped: string[]
  /** Set when the canvas guard had to shrink the request; null when honored. */
  clampedWidth: number | null
}

export type CompositionFailure =
  | MosaicFailure
  /** The clamp loop never converged on an admissible canvas. */
  | "too-large"
  /** Every pin was skipped, so there is nothing to compose. */
  | "no-items"
  /** More pins than the server will accept in one document. */
  | "too-many-items"
  /** The solved canvas is below the server's minimum side. */
  | "canvas-too-small"

export type CompositionResult =
  | { ok: true; doc: CompositionDoc }
  | { ok: false; failure: CompositionFailure; detail: string }

function refuse(
  failure: CompositionFailure,
  detail: string
): { ok: false; failure: CompositionFailure; detail: string } {
  return { ok: false, failure, detail }
}

/** One solved canvas with its items on it — the output of a single pass. */
interface ComposedItems {
  canvasW: number
  canvasH: number
  items: ComposeItem[]
  skipped: string[]
  /** Set when the CANVAS clamp had to shrink this pass's request. */
  clampedWidth: number | null
}

type ComposeAttempt =
  | ({ ok: true } & ComposedItems)
  | { ok: false; failure: CompositionFailure; detail: string }

/**
 * Re-solves the loop-memory clamp may spend. One pass is exact up to the
 * rounding of every rectangle (the buffered bytes scale with the canvas area),
 * so the rest is slack — and a run that never fits refuses rather than posting
 * a document the server will turn away.
 */
const LOOP_MEMORY_PASSES = 3

/**
 * The board (or a selection of it) as a composition document.
 *
 * Step for step the solve `composeBoardMosaic` runs — live grid scale, visible
 * rows, output-width fit, clamp loop — with ONE substitution: the clamp bound
 * is the server's composition limits instead of the browser's canvas limits.
 * Everything downstream of the solve is the same geometry through
 * `resolvePinDraw`, rounded onto the integer lattice the filtergraph needs.
 *
 * TWO clamps run here, not one. The canvas clamp (side, area, the preset's
 * height cap) is a property of the geometry alone, so `solveWithinCanvasLimits`
 * settles it before an item exists. The LOOP-MEMORY clamp cannot: what a
 * composition buffers depends on the items' times and their destination sizes,
 * which are only known once the pins are composed. So it runs outside, on the
 * same "shrink the target width and re-solve" mechanism, with the item table
 * rebuilt each pass and the metadata resolved once for all of them.
 */
export async function buildCompositionDoc(
  opts: CompositionOptions
): Promise<CompositionResult> {
  const {
    layout,
    boardWidth,
    boardHeight,
    preset,
    limits,
    seamless,
    only,
    proportional,
  } = opts
  // The chosen items are the extent: a fold cut on top of a selection would
  // silently drop pins the user pointed at.
  const extent: MosaicExtent = only ? "full" : opts.extent
  const parsed = parseBoard(layout)
  if (parsed.records.length === 0) {
    return refuse("no-pins", "There is nothing on this board to compose.")
  }
  if (boardWidth <= 0) {
    return refuse("degenerate", "The board has no measurable width.")
  }

  const liveScale = gridScale(proportional, parsed.refWidth, boardWidth)
  const liveGrid = effectiveGrid(parsed.grid, liveScale)
  const visibleRows = Math.max(foldRows(liveGrid, boardHeight), parsed.highWater)

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

  let layoutTarget = opts.targetWidth
  if (opts.widthMode === "output") {
    const fitted = fitLayoutWidthToOutput(opts.targetWidth, solveAt)
    if (!fitted.ok) {
      return refuse(fitted.failure, "This board has no capture box to compose.")
    }
    layoutTarget = fitted.layoutWidth
  }

  const bounds = canvasBounds(limits, preset)
  const carriesAudio = !isAnimatedContainer(preset.container)
  const spanMimes =
    limits?.span_capable_image_mimes ?? FALLBACK_LIMITS.spanCapableImageMimes
  // Resolved ONCE per sha across every pass below: the clamp loops re-solve
  // the geometry, never the item table, and a lookup is a request.
  const metas = new Map<string, ComposeItemMeta | null>()

  const attempt = async (width: number): Promise<ComposeAttempt> => {
    const solved = solveWithinCanvasLimits(width, solveAt, 4, (w, h) =>
      composeClampFactor(w, h, bounds)
    )
    if (!solved.ok) {
      return refuse(
        solved.failure,
        solved.failure === "too-large"
          ? "This board is too large to render as one video."
          : "This board has no capture box to compose."
      )
    }
    const geo = solved.geometry

    // 4:2:0 has no odd sizes, and the server refuses an odd canvas rather than
    // rounding one itself (which would move every rectangle by half a pixel).
    // Flooring is safe in the one way that matters: every destination rect
    // below is clipped INTO this canvas, so shaving a pixel off the edge can
    // only shave a pixel off a rectangle, never push one outside.
    const canvasW = evenFloor(geo.width)
    const canvasH = evenFloor(geo.height)
    if (canvasW < bounds.minSide || canvasH < bounds.minSide) {
      return refuse(
        "canvas-too-small",
        `A composition must be at least ${bounds.minSide}×${bounds.minSide} px;`
          + ` this one solves to ${canvasW}×${canvasH}.`
      )
    }

    // Items starting past the bottom cut are not composed at all; the ones the
    // cut crosses are clipped by the canvas edge — in the source as well as
    // the destination (`clipPinDrawToCanvas`), which is what makes them the
    // same partial picture the canvas mosaic draws.
    const bottom = geo.cropTop + geo.height
    const visible = geo.placements.filter((p) => p.top < bottom)
    await loadMetas(visible, opts.getMeta, metas)

    const items: ComposeItem[] = []
    const skipped: string[] = []
    for (const placement of visible) {
      const item = composeItem({
        placement,
        meta: metas.get(placement.sha256) ?? null,
        state: opts.probe(placement.key),
        origin: { left: geo.cropLeft, top: geo.cropTop },
        cell: null,
        canvasW,
        canvasH,
        carriesAudio,
        spanMimes,
      })
      if (item) items.push(item)
      else skipped.push(placement.sha256)
    }
    return {
      ok: true,
      canvasW,
      canvasH,
      items,
      skipped,
      clampedWidth: solved.clampedWidth,
    }
  }

  const fps = resolveComposeFps(opts.fps, limits)
  const budget = loopBudgetBytes(limits)
  const loopBytesOf = (composed: ComposedItems) =>
    estimateLoopBytes(
      composed.items,
      fps,
      composeTargetCs(
        opts.length,
        composed.items.map((item) => item.time),
        preset.container,
        limits
      )
    )

  let width = layoutTarget
  let composed = await attempt(width)
  if (!composed.ok) return composed
  let loopClamped: number | null = null
  let bytes = loopBytesOf(composed)
  for (let pass = 0; pass < LOOP_MEMORY_PASSES && bytes > budget; pass++) {
    // Buffered bytes scale with the canvas AREA, so the width that fits is one
    // square root away; the 0.999 is the same slack the canvas clamp leaves
    // for per-rectangle rounding.
    const next = Math.max(1, Math.floor(width * Math.sqrt(budget / bytes) * 0.999))
    if (next >= width) break
    width = next
    const retry = await attempt(width)
    if (!retry.ok) return retry
    composed = retry
    loopClamped = width
    bytes = loopBytesOf(composed)
  }
  if (bytes > budget) {
    return refuse(
      "too-large",
      `This composition would buffer about ${Math.round(bytes / BYTES_PER_MB)} MB of`
        + ` looped frames, over the ${Math.round(budget / BYTES_PER_MB)} MB limit.`
        + " Shorten the output, or select fewer pins."
    )
  }

  if (composed.items.length === 0) {
    return refuse(
      "no-items",
      "None of these pins could be composed — their details are still loading,"
        + " or they have left the index."
    )
  }
  const maxItems = limits?.max_mosaic_inputs ?? FALLBACK_LIMITS.maxMosaicInputs
  if (composed.items.length > maxItems) {
    return refuse(
      "too-many-items",
      `A composition may hold at most ${maxItems} items; this one has`
        + ` ${composed.items.length}. Select fewer pins, or capture a smaller area.`
    )
  }

  return {
    ok: true,
    doc: finishDoc({
      items: composed.items,
      canvasW: composed.canvasW,
      canvasH: composed.canvasH,
      background: opts.background,
      preset,
      limits,
      length: opts.length,
      fps: opts.fps,
      skipped: composed.skipped,
      // Either clamp is a shrink the caller has to be told about; the
      // loop-memory one is the tighter (and later) of the two when it fires.
      clampedWidth: loopClamped ?? composed.clampedWidth,
    }),
  }
}

export interface ItemCompositionOptions {
  placement: PinPlacement
  meta: ComposeItemMeta | null
  state: PinVideoState | null
  preset: ComposePreset
  limits: TranscodeLimits | null
  length: ComposeLength
  fps?: number
  /** Output width in px, or null for the crop region's own resolution. */
  targetWidth: number | null
  background: string
}

/**
 * ONE pin as a composition: the canvas IS the picture.
 *
 * The animated twin of `composeItemImage` — same canvas rule
 * (`itemOutputSize`: the crop region at the source's own resolution, not the
 * cell's, so nothing letterboxes and no background surrounds it), same crop,
 * same orientation. The item covers the whole canvas at 0,0, which the server
 * recognises as the no-overlay single-item graph; the position is even by
 * construction.
 *
 * Only offered for a pin that resolves to a SPAN. A stopped pin's frozen frame
 * is a still image, and the existing image export serves it better than a
 * one-second video of it would.
 */
export function buildItemCompositionDoc(
  opts: ItemCompositionOptions
): CompositionResult {
  const { placement, meta, preset, limits } = opts
  const natural = naturalSize(meta, opts.state)
  const size = natural
    ? itemOutputSize(
        placement.crop,
        natural.width,
        natural.height,
        placement.orient,
        opts.targetWidth
      )
    : null
  if (!size) {
    return refuse(
      "degenerate",
      "This item's dimensions are unknown, so there is nothing to size the"
        + " video against."
    )
  }
  // The browser's canvas guard is already inside itemOutputSize; the SERVER's
  // bounds (including the preset's height cap) are the tighter pair, applied
  // on top and rounded to the even canvas the container needs.
  const bounds = canvasBounds(limits, preset)
  const factor = composeClampFactor(size.width, size.height, bounds)
  const canvasW = evenFloor(size.width * factor)
  const canvasH = evenFloor(size.height * factor)
  if (canvasW < bounds.minSide || canvasH < bounds.minSide) {
    return refuse(
      "canvas-too-small",
      `A composition must be at least ${bounds.minSide}×${bounds.minSide} px;`
        + ` this one solves to ${canvasW}×${canvasH}.`
    )
  }

  const item = composeItem({
    placement,
    meta,
    state: opts.state,
    origin: { left: 0, top: 0 },
    // The cell IS the canvas: the crop's own aspect fills it, so the contain
    // fit inside `resolvePinDraw` is the identity up to the half pixel the
    // integer canvas rounds away.
    cell: { left: 0, top: 0, width: canvasW, height: canvasH },
    canvasW,
    canvasH,
    carriesAudio: !isAnimatedContainer(preset.container),
    spanMimes:
      limits?.span_capable_image_mimes ?? FALLBACK_LIMITS.spanCapableImageMimes,
  })
  if (!item) {
    return refuse(
      "no-items",
      "This item could not be composed — its details are still loading, or it"
        + " has left the index."
    )
  }
  // The item COVERS the canvas, stated rather than derived. The canvas is the
  // crop region's own size evened down, so the contain fit inside
  // `resolvePinDraw` can land a pixel short of it — an aspect change of about
  // one part in two thousand, invisible in the picture and decisive in the
  // graph: a dest that is not exactly the canvas is no longer the single-item
  // cover `covers_canvas` recognises, so the server builds the base-colour
  // plus `overlay` chain instead and leaves a stripe of page background down
  // one edge. Forcing it restores the no-overlay graph and, with it, the
  // background normalization the single-item save has always had.
  const covering: ComposeItem = {
    ...item,
    dest: { x: 0, y: 0, w: canvasW, h: canvasH },
  }
  return {
    ok: true,
    doc: finishDoc({
      items: [covering],
      canvasW,
      canvasH,
      background: opts.background,
      preset,
      limits,
      length: opts.length,
      fps: opts.fps,
      skipped: [],
      clampedWidth: factor < 1 ? canvasW : null,
    }),
  }
}

/**
 * Metadata for every unique sha on the board, resolved once each INTO a cache
 * the caller owns: the clamp loops re-solve the geometry several times over,
 * and an item's natural size does not depend on the width it is drawn at.
 */
async function loadMetas(
  placements: readonly PinPlacement[],
  getMeta: (sha256: string) => Promise<ComposeItemMeta | null>,
  into: Map<string, ComposeItemMeta | null>
): Promise<void> {
  const shas = [...new Set(placements.map((p) => p.sha256))].filter(
    (sha) => !into.has(sha)
  )
  const entries = await Promise.all(
    shas.map(async (sha) => {
      // A lookup that throws is an item with no metadata, which is a skipped
      // pin — never a failed export of the eleven pins that did resolve.
      try {
        return [sha, await getMeta(sha)] as const
      } catch {
        return [sha, null] as const
      }
    })
  )
  for (const [sha, meta] of entries) into.set(sha, meta)
}

/**
 * The pixel dimensions a pin's rectangles are solved against.
 *
 * The MOUNTED element's own naturals win over the index's record. They are the
 * numbers the canvas mosaic draws with (`findPinVideoFrame` reads
 * `videoWidth`/`videoHeight` off the same element), and the two can genuinely
 * disagree: a browser reports a rotated video already rotated and a
 * non-square-pixel one already corrected, where the index stores what the
 * container's coded dimensions say. `compose.rs` assumes the browser's
 * reading — the whole document is written in it — so preferring it here is
 * what keeps the animated save and the still one the same picture. Metadata is
 * the fallback for every pin that is not mounted, which is most of them.
 *
 * Taken as a PAIR: mixing one axis from the element with the other from the
 * index would invent an aspect neither of them describes.
 */
export function naturalSize(
  meta: ComposeItemMeta | null,
  state: PinVideoState | null
): { width: number; height: number } | null {
  const liveW = state?.width ?? 0
  const liveH = state?.height ?? 0
  if (liveW > 0 && liveH > 0) return { width: liveW, height: liveH }
  const metaW = meta?.width ?? 0
  const metaH = meta?.height ?? 0
  if (metaW > 0 && metaH > 0) return { width: metaW, height: metaH }
  return null
}

/** One placement as a document item, or null when it cannot be placed. */
function composeItem(input: {
  placement: PinPlacement
  meta: ComposeItemMeta | null
  state: PinVideoState | null
  origin: { left: number; top: number }
  /** An explicit destination box, or null to use the placement's own cell. */
  cell: DrawRect | null
  canvasW: number
  canvasH: number
  carriesAudio: boolean
  /** The limits envelope's span-capable image mimes; empty pre-envelope. */
  spanMimes: readonly string[]
}): ComposeItem | null {
  const { placement, meta, state } = input
  // The FULL hash, never the board's 10-char prefix: the document is cache-keyed
  // on what it sends, so two spellings of one item would be two artifacts.
  const sha256 = meta?.sha256
  const natural = naturalSize(meta, state)
  if (!sha256 || !natural) return null

  const cell = input.cell ?? {
    left: placement.left - input.origin.left,
    top: placement.top - input.origin.top,
    width: placement.width,
    height: placement.height,
  }
  const draw = resolvePinDraw(placement, natural.width, natural.height, cell)
  if (!draw) return null
  // The canvas edge cuts BOTH rectangles or neither — see clipPinDrawToCanvas.
  const clipped = clipPinDrawToCanvas({
    dest: draw.dest,
    crop: placement.crop,
    orient: placement.orient,
    canvasW: input.canvasW,
    canvasH: input.canvasH,
  })
  if (!clipped) return null
  const src = sourcePixels(clipped.src, natural.width, natural.height)
  const dest = destPixels(clipped.dest, input.canvasW, input.canvasH)
  if (!src || !dest) return null

  const isVideo = (meta?.type ?? "").startsWith("video/")
  const time = resolveItemTime({
    isVideo,
    trim: placement.trim,
    state,
    duration: meta?.duration ?? null,
    mime: meta?.type ?? null,
    spanCapableImageMimes: input.spanMimes,
  })
  return {
    sha256,
    src,
    dest,
    // The pin's orientation, passed through verbatim — the same D4
    // decomposition the board stores (`flip_h` applied after `quarter_turns`
    // clockwise turns), which is the convention the filtergraph builds to.
    transform: {
      quarter_turns: placement.orient?.quarterTurns ?? 0,
      flip_h: placement.orient?.flipped ?? false,
    },
    time,
    // Audio is the user's own mute state, and only for something that plays:
    // a still has no sound to mix, and a container with no audio stream at all
    // would only have it stripped server-side.
    audio:
      time.kind === "span" && !!state?.playing && !state.muted && input.carriesAudio,
  }
}

/**
 * The frame rate the document will carry: the caller's request, rounded, and
 * capped by the server's own maximum. Shared by `finishDoc` and the
 * loop-memory estimate, which has to count frames at the SAME rate the
 * document asks for.
 */
function resolveComposeFps(
  fps: number | undefined,
  limits: TranscodeLimits | null
): number {
  const maxFps = limits?.max_compose_fps ?? FALLBACK_LIMITS.maxComposeFps
  return Math.max(
    1,
    Math.min(Math.round(fps ?? DEFAULT_COMPOSE_FPS), Math.max(1, maxFps))
  )
}

/** The document's non-geometric half, shared by both builders. */
function finishDoc(input: {
  items: ComposeItem[]
  canvasW: number
  canvasH: number
  background: string
  preset: ComposePreset
  limits: TranscodeLimits | null
  length: ComposeLength
  fps: number | undefined
  skipped: string[]
  clampedWidth: number | null
}): CompositionDoc {
  const fps = resolveComposeFps(input.fps, input.limits)
  const requestedSeconds = composeRequestedSeconds(
    input.length,
    longestSpanSeconds(input.items.map((item) => item.time))
  )
  return {
    body: {
      canvas: {
        w: input.canvasW,
        h: input.canvasH,
        background: normalizeComposeBackground(input.background),
      },
      fps,
      output: { preset: input.preset.id, length: input.length },
      items: input.items,
    },
    width: input.canvasW,
    height: input.canvasH,
    requestedSeconds,
    skipped: input.skipped,
    clampedWidth: input.clampedWidth,
  }
}
