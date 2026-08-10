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
// Three things the canvas never has to think about, and this does:
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
//   3. TIME. A canvas composites one frame; a composition composites a span,
//      a frozen frame or a still image per item (see `resolveItemTime`).
//
// Everything here is pure: no DOM, no fetch. The metadata lookup and the live
// video-state probe arrive as functions, which is what lets the whole builder
// be asserted from a plain node script (scripts/compose.test.mjs).

import type { components } from "@/lib/panoptikon"
import type { CropRect, TrimRange } from "@/lib/pinboardCrop"
import type { PinVideoState } from "@/lib/pinboardMedia"
import type {
  DrawRect,
  MosaicExtent,
  MosaicFailure,
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

/** The animated-image container, the one with a length cap on it. */
const ANIMATED_CONTAINER: Container = "webp"

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
  maxMosaicInputs: 24,
} as const

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
  /** Only a video has a span or a frozen frame; everything else is an image. */
  isVideo: boolean
  /** The pin's own trim, off its h field. */
  trim: TrimRange | null
  /** The live DOM state of this pin's <video>, or null when it has none. */
  state: PinVideoState | null
  /** The item's recorded duration in seconds, when the index knows one. */
  duration: number | null
}

/**
 * What one pin is showing, as the document's time enum (§0.5: a span *is*
 * playing, a still and an image are stopped, so no two fields can contradict).
 *
 * The rules, and why each one is the honest reading of the board:
 *
 *   NOT A VIDEO → `image`. A still image held for the whole output.
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
  if (!input.isVideo) return { kind: "image" }
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
 * Whether one preset may be offered for a composition of this length. Same
 * rule (and the same reasoning) as lib/videoClip's `clipRowFits`: only the
 * animated-image container is capped, and an unknown limit counts as no.
 */
function composeRowFits(
  preset: ComposePreset,
  requestedSeconds: number,
  limits: TranscodeLimits | null
): boolean {
  if (preset.container !== ANIMATED_CONTAINER) return true
  const limit = limits?.max_animated_image_seconds
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

/**
 * The board (or a selection of it) as a composition document.
 *
 * Step for step the solve `composeBoardMosaic` runs — live grid scale, visible
 * rows, output-width fit, clamp loop — with ONE substitution: the clamp bound
 * is the server's composition limits instead of the browser's canvas limits.
 * Everything downstream of the solve is the same geometry through
 * `resolvePinDraw`, rounded onto the integer lattice the filtergraph needs.
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
  const solved = solveWithinCanvasLimits(layoutTarget, solveAt, 4, (w, h) =>
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
  const { geometry: geo, clampedWidth } = solved

  // 4:2:0 has no odd sizes, and the server refuses an odd canvas rather than
  // rounding one itself (which would move every rectangle by half a pixel).
  // Flooring is safe in the one way that matters: every destination rect below
  // is clamped INTO this canvas, so shaving a pixel off the edge can only
  // shave a pixel off a rectangle, never push one outside.
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
  // cut crosses are clipped by the canvas edge, exactly as the canvas mosaic
  // clips them.
  const bottom = geo.cropTop + geo.height
  const visible = geo.placements.filter((p) => p.top < bottom)
  const metas = await loadMetas(visible, opts.getMeta)

  const items: ComposeItem[] = []
  const skipped: string[] = []
  const carriesAudio = preset.container !== ANIMATED_CONTAINER
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
    })
    if (item) items.push(item)
    else skipped.push(placement.sha256)
  }

  if (items.length === 0) {
    return refuse(
      "no-items",
      "None of these pins could be composed — their details are still loading,"
        + " or they have left the index."
    )
  }
  const maxItems = limits?.max_mosaic_inputs ?? FALLBACK_LIMITS.maxMosaicInputs
  if (items.length > maxItems) {
    return refuse(
      "too-many-items",
      `A composition may hold at most ${maxItems} items; this one has`
        + ` ${items.length}. Select fewer pins, or capture a smaller area.`
    )
  }

  return {
    ok: true,
    doc: finishDoc({
      items,
      canvasW,
      canvasH,
      background: opts.background,
      preset,
      limits,
      length: opts.length,
      fps: opts.fps,
      skipped,
      clampedWidth,
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
  const naturalW = meta?.width ?? 0
  const naturalH = meta?.height ?? 0
  const size = itemOutputSize(
    placement.crop,
    naturalW,
    naturalH,
    placement.orient,
    opts.targetWidth
  )
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
    carriesAudio: preset.container !== ANIMATED_CONTAINER,
  })
  if (!item) {
    return refuse(
      "no-items",
      "This item could not be composed — its details are still loading, or it"
        + " has left the index."
    )
  }
  return {
    ok: true,
    doc: finishDoc({
      items: [item],
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

/** Metadata for every unique sha on the board, resolved once each. */
async function loadMetas(
  placements: readonly PinPlacement[],
  getMeta: (sha256: string) => Promise<ComposeItemMeta | null>
): Promise<Map<string, ComposeItemMeta | null>> {
  const shas = [...new Set(placements.map((p) => p.sha256))]
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
  return new Map(entries)
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
}): ComposeItem | null {
  const { placement, meta, state } = input
  // The FULL hash, never the board's 10-char prefix: the document is cache-keyed
  // on what it sends, so two spellings of one item would be two artifacts.
  const sha256 = meta?.sha256
  const naturalW = meta?.width ?? 0
  const naturalH = meta?.height ?? 0
  if (!sha256 || !(naturalW > 0) || !(naturalH > 0)) return null

  const cell = input.cell ?? {
    left: placement.left - input.origin.left,
    top: placement.top - input.origin.top,
    width: placement.width,
    height: placement.height,
  }
  const draw = resolvePinDraw(placement, naturalW, naturalH, cell)
  if (!draw) return null
  const src = sourcePixels(draw.src, naturalW, naturalH)
  const dest = destPixels(draw.dest, input.canvasW, input.canvasH)
  if (!src || !dest) return null

  const isVideo = (meta?.type ?? "").startsWith("video/")
  const time = resolveItemTime({
    isVideo,
    trim: placement.trim,
    state,
    duration: meta?.duration ?? null,
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
  const maxFps = input.limits?.max_compose_fps ?? FALLBACK_LIMITS.maxComposeFps
  const fps = Math.max(
    1,
    Math.min(Math.round(input.fps ?? DEFAULT_COMPOSE_FPS), Math.max(1, maxFps))
  )
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
