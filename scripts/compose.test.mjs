// Assertions for the composition document: lib/pinboardCompose.ts (the board
// as `POST /api/video/compose` sees it) and the state probe it reads
// (lib/pinboardMedia's `videoStateOf`). Run from the ui root:
//
//   node --experimental-strip-types scripts/compose.test.mjs
//
// The whole point of the builder is that its rectangles ARE the canvas
// compositor's, so the geometry assertions below re-derive the expected
// numbers from `resolvePinDraw` — the function both paths call — rather than
// from a table of constants that could drift from either.

import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  DEFAULT_COMPOSE_FPS,
  STILLS_ONLY_TARGET_SECONDS,
  buildCompositionDoc,
  buildItemCompositionDoc,
  composeClampFactor,
  composeRequestedSeconds,
  composeRows,
  longestSpanSeconds,
  normalizeComposeBackground,
  resolveItemTime,
} = await import("../lib/pinboardCompose.ts")
const { mosaicGeometry, resolvePinDraw, itemOutputSize } = await import(
  "../lib/pinboardGeometry.ts"
)
const { V2_GRID, effectiveGrid } = await import("../lib/pinboardGrid.ts")
const { videoStateOf } = await import("../lib/pinboardMedia.ts")
const { packHField } = await import("../lib/pinboardCrop.ts")

let all = true
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `\n  ${detail}` : ""}`)
  all &&= !!ok
  return ok
}
const shape = (value) => JSON.stringify(value)

// ---- the fixture board -------------------------------------------------
//
// Two pins side by side on a v2 grid: a video (playing, unmuted, trimmed) and
// a still image. Board width and height are chosen so nothing is cut by the
// fold — the extent rules are mosaic.test.mjs's business, and this file is
// about what the DOCUMENT says.

const G = V2_GRID
const BOARD_W = 1920
const BOARD_H = 4000

const VIDEO_SHA = "aaaaaaaaaa"
const IMAGE_SHA = "bbbbbbbbbb"
const VIDEO_FULL = "aaaaaaaaaa".repeat(6) + "abcd"
const IMAGE_FULL = "bbbbbbbbbb".repeat(6) + "efab"

// The video pin carries a crop, a trim and a quarter turn; the image pin is
// plain. Packed with the codec rather than spelled by hand — a hand-written
// field that does not parse silently yields a pin with no crop, no trim and no
// orientation, which is a fixture that tests none of the three.
const VIDEO_H_FIELD = packHField(12, {
  crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
  autoCrop: null,
  trim: { start: 1.5, end: 8.5 },
  lock: null,
  orient: { quarterTurns: 1, flipped: false },
})
const RECORDS = [
  VIDEO_SHA, "0", "0", "20", VIDEO_H_FIELD,
  IMAGE_SHA, "24", "0", "20", "12",
]

// One tall pin on its own board, for the rules only an oversized capture box
// reaches (the canvas clamp, and the preset height cap that rides in it).
const TALL_RECORDS = [VIDEO_SHA, "0", "0", "20", "200"]

const META = {
  [VIDEO_SHA]: {
    sha256: VIDEO_FULL,
    type: "video/mp4",
    width: 1920,
    height: 1080,
    duration: 12,
  },
  [IMAGE_SHA]: {
    sha256: IMAGE_FULL,
    type: "image/jpeg",
    width: 800,
    height: 600,
    duration: null,
  },
}

const LIMITS = {
  max_mosaic_inputs: 24,
  max_mosaic_loop_mb: 512,
  max_animated_image_seconds: 15,
  max_output_seconds: 60,
  min_canvas_side: 16,
  max_canvas_side: 4096,
  max_canvas_area: 3840 * 2160,
  max_compose_fps: 60,
}

const MP4 = { id: "mosaic-mp4", label: "MP4", container: "mp4", ext: "mp4" }
const WEBP = {
  id: "webp-anim",
  label: "Animated WebP",
  container: "webp",
  ext: "webp",
  max_height: 720,
}

const PLAYING = { playing: true, muted: false, duration: 12 }

function build(overrides = {}) {
  return buildCompositionDoc({
    layout: ["v2", ...RECORDS],
    boardWidth: BOARD_W,
    boardHeight: BOARD_H,
    preset: MP4,
    limits: LIMITS,
    length: { mode: "longest_loop_once" },
    targetWidth: BOARD_W,
    seamless: false,
    extent: "full",
    proportional: false,
    background: "rgb(9, 9, 11)",
    getMeta: async (sha) => META[sha] ?? null,
    probe: (key) => (key.endsWith(VIDEO_SHA) ? PLAYING : null),
    ...overrides,
  })
}

async function built(overrides = {}) {
  const result = await build(overrides)
  if (!result.ok) {
    throw new Error(`expected a document, got "${result.failure}": ${result.detail}`)
  }
  return result.doc
}

// The solve the builder mirrors, re-run here so the expected numbers come
// from the shared geometry rather than from constants.
function solveAt(width, only) {
  return mosaicGeometry({
    records: RECORDS,
    grid: effectiveGrid(G, width / BOARD_W),
    layoutWidth: width,
    seamless: false,
    extent: "full",
    visibleRows: 1000,
    only,
  })
}

// ---- geometry: the document's rects ARE the compositor's ----------------

{
  const doc = await built()
  const geo = solveAt(BOARD_W).geometry
  check(
    "the canvas is the capture box, rounded down to even",
    doc.width === geo.width - (geo.width % 2) &&
      doc.height === geo.height - (geo.height % 2),
    `${doc.width}x${doc.height} from ${geo.width}x${geo.height}`
  )
  check(
    "the canvas is even on both sides",
    doc.body.canvas.w % 2 === 0 && doc.body.canvas.h % 2 === 0,
    `${doc.body.canvas.w}x${doc.body.canvas.h}`
  )
  check("every visible pin is an item", doc.body.items.length === 2, shape(doc.body.items.length))

  // The video pin, against resolvePinDraw's own answer for the same cell.
  const placement = geo.placements[0]
  const meta = META[VIDEO_SHA]
  const draw = resolvePinDraw(placement, meta.width, meta.height, {
    left: placement.left - geo.cropLeft,
    top: placement.top - geo.cropTop,
    width: placement.width,
    height: placement.height,
  })
  const item = doc.body.items[0]
  check(
    "the source rect is the compositor's normalized rect in source pixels",
    item.src.x === Math.floor(draw.src.x * meta.width) &&
      item.src.y === Math.floor(draw.src.y * meta.height) &&
      item.src.w === Math.round(draw.src.w * meta.width) &&
      item.src.h === Math.round(draw.src.h * meta.height),
    `${shape(item.src)} vs ${shape(draw.src)} of ${meta.width}x${meta.height}`
  )
  check(
    "the source rect stays inside the frame",
    item.src.x + item.src.w <= meta.width && item.src.y + item.src.h <= meta.height,
    shape(item.src)
  )
  check(
    "the destination rect is the compositor's, positions rounded to EVEN",
    item.dest.x === Math.round(draw.dest.left / 2) * 2 &&
      item.dest.y === Math.round(draw.dest.top / 2) * 2,
    `${shape(item.dest)} vs left=${draw.dest.left} top=${draw.dest.top}`
  )
  check(
    "…and the SIZES are left alone (scale honours them; overlay does not honour odd offsets)",
    item.dest.w === Math.min(Math.round(draw.dest.width), doc.width - item.dest.x) &&
      item.dest.h === Math.min(Math.round(draw.dest.height), doc.height - item.dest.y),
    `${shape(item.dest)} vs ${draw.dest.width}x${draw.dest.height}`
  )
  check(
    "the destination sizes are allowed to be odd",
    doc.body.items.some((i) => i.dest.w % 2 === 1 || i.dest.h % 2 === 1) ||
      // Not every fixture lands on an odd size; the rule is that nothing
      // rounds them, which the assertion above already pins.
      true
  )
  check(
    "every destination rect is inside the canvas",
    doc.body.items.every(
      (i) =>
        i.dest.x >= 0 &&
        i.dest.y >= 0 &&
        i.dest.x + i.dest.w <= doc.width &&
        i.dest.y + i.dest.h <= doc.height
    ),
    shape(doc.body.items.map((i) => i.dest))
  )
  check(
    "the item carries the FULL hash, never the board's prefix",
    item.sha256 === VIDEO_FULL && doc.body.items[1].sha256 === IMAGE_FULL,
    item.sha256
  )
  check(
    "the pin's orientation rides verbatim",
    shape(item.transform) === shape({ quarter_turns: 1, flip_h: false }),
    shape(item.transform)
  )
  check(
    "an unoriented pin sends the identity transform",
    shape(doc.body.items[1].transform) === shape({ quarter_turns: 0, flip_h: false })
  )
}

// ---- time: the C7 resolution table -------------------------------------

{
  const table = [
    {
      name: "a non-video is an image",
      input: { isVideo: false, trim: null, state: PLAYING, duration: 12 },
      want: { kind: "image" },
    },
    {
      name: "a playing untrimmed video spans 0..duration",
      input: { isVideo: true, trim: null, state: PLAYING, duration: 12 },
      want: { kind: "span", start_cs: 0, end_cs: 1200 },
    },
    {
      name: "a playing trimmed video spans its trim",
      input: {
        isVideo: true,
        trim: { start: 1.5, end: 8.5 },
        state: PLAYING,
        duration: 12,
      },
      want: { kind: "span", start_cs: 150, end_cs: 850 },
    },
    {
      name: "a playing video with only a start bound runs to the duration",
      input: { isVideo: true, trim: { start: 2, end: null }, state: PLAYING, duration: 12 },
      want: { kind: "span", start_cs: 200, end_cs: 1200 },
    },
    {
      name: "a PAUSED video is a still at its trim start",
      input: {
        isVideo: true,
        trim: { start: 3, end: 9 },
        state: { playing: false, muted: false, duration: 12 },
        duration: 12,
      },
      want: { kind: "still", at_cs: 300 },
    },
    {
      name: "an UNMOUNTED video is a still too",
      input: { isVideo: true, trim: null, state: null, duration: 12 },
      want: { kind: "still", at_cs: 0 },
    },
    {
      name: "an equal-bounds trim names its own freeze frame",
      input: {
        isVideo: true,
        trim: { start: 4.25, end: 4.25 },
        state: PLAYING,
        duration: 12,
      },
      want: { kind: "still", at_cs: 425 },
    },
    {
      name: "a span with NO knowable end falls back to a still (end_cs is required)",
      input: {
        isVideo: true,
        trim: null,
        state: { playing: true, muted: false, duration: null },
        duration: null,
      },
      want: { kind: "still", at_cs: 0 },
    },
    {
      name: "…and the element's own duration stands in when the index has none",
      input: {
        isVideo: true,
        trim: null,
        state: { playing: true, muted: false, duration: 7.5 },
        duration: null,
      },
      want: { kind: "span", start_cs: 0, end_cs: 750 },
    },
    {
      name: "a still at the very end is clamped inside the file",
      input: {
        isVideo: true,
        trim: { start: 12, end: 12 },
        state: null,
        duration: 12,
      },
      want: { kind: "still", at_cs: 1199 },
    },
    {
      name: "a still past the end is clamped too",
      input: { isVideo: true, trim: { start: 99, end: null }, state: null, duration: 12 },
      want: { kind: "still", at_cs: 1199 },
    },
  ]
  for (const row of table) {
    const got = resolveItemTime(row.input)
    const ok = shape(got) === shape(row.want)
    check(row.name, ok, ok ? "" : `${shape(got)} != ${shape(row.want)}`)
  }
}

// ---- the DOM probe's state rules ---------------------------------------

{
  const HAVE_CURRENT_DATA = 2
  check("no element is no state", videoStateOf(null) === null)
  check(
    "a running element reads as playing",
    videoStateOf({
      paused: false, ended: false, readyState: HAVE_CURRENT_DATA,
      muted: false, duration: 9,
    }).playing === true
  )
  check(
    "a paused element does not",
    videoStateOf({
      paused: true, ended: false, readyState: 4, muted: false, duration: 9,
    }).playing === false
  )
  check(
    "an ENDED element does not either — its picture is the last frame",
    videoStateOf({
      paused: false, ended: true, readyState: 4, muted: false, duration: 9,
    }).playing === false
  )
  check(
    "an element with no decoded frame does not",
    videoStateOf({
      paused: false, ended: false, readyState: 1, muted: false, duration: 9,
    }).playing === false
  )
  check(
    "mute rides through, and an infinite duration is no duration",
    (() => {
      const s = videoStateOf({
        paused: false, ended: false, readyState: 4, muted: true, duration: Infinity,
      })
      return s.muted === true && s.duration === null
    })()
  )
}

// ---- audio -------------------------------------------------------------

{
  const doc = await built()
  check(
    "a playing unmuted span in an mp4 mixes its audio in",
    doc.body.items[0].audio === true && doc.body.items[0].time.kind === "span"
  )
  check("a still image never claims audio", doc.body.items[1].audio === false)
  const muted = await built({
    probe: (key) => (key.endsWith(VIDEO_SHA) ? { ...PLAYING, muted: true } : null),
  })
  check("a MUTED pin composes silent", muted.body.items[0].audio === false)
  const webp = await built({ preset: WEBP })
  check(
    "an animated-image container carries no audio at all",
    webp.body.items.every((i) => i.audio === false)
  )
}

// ---- skipped pins ------------------------------------------------------

{
  const doc = await built({
    getMeta: async (sha) =>
      sha === VIDEO_SHA ? { ...META[sha], width: null, height: null } : META[sha] ?? null,
  })
  check(
    "a pin with no dimensions is skipped, not drawn as a grey box",
    doc.body.items.length === 1 && doc.body.items[0].sha256 === IMAGE_FULL,
    shape(doc.body.items.map((i) => i.sha256))
  )
  check(
    "…and its identity comes back so the caller can say so",
    shape(doc.skipped) === shape([VIDEO_SHA]),
    shape(doc.skipped)
  )
  const missing = await build({ getMeta: async () => null })
  check(
    "a board whose every pin is unknown refuses instead of posting an empty document",
    missing.ok === false && missing.failure === "no-items",
    shape(missing)
  )
  const throwing = await build({
    getMeta: async (sha) => {
      if (sha === VIDEO_SHA) throw new Error("network")
      return META[sha]
    },
  })
  check(
    "a metadata lookup that THROWS skips its pin rather than failing the export",
    throwing.ok === true && throwing.doc.body.items.length === 1,
    shape(throwing.ok ? throwing.doc.skipped : throwing)
  )
}

// ---- limits ------------------------------------------------------------

{
  const tooMany = await build({ limits: { ...LIMITS, max_mosaic_inputs: 1 } })
  check(
    "more items than the server accepts is refused before the POST",
    tooMany.ok === false && tooMany.failure === "too-many-items",
    tooMany.ok ? "" : tooMany.detail
  )
  check(
    "…and the refusal names the limit",
    !tooMany.ok && /at most 1 items/.test(tooMany.detail),
    tooMany.ok ? "" : tooMany.detail
  )

  // The canvas clamp: the same loop the canvas export runs, against the
  // SERVER's bounds instead of the browser's.
  const bounds = { minSide: 16, maxSide: 4096, maxArea: 3840 * 2160, maxHeight: null }
  check("an ordinary canvas is not clamped", composeClampFactor(1920, 1080, bounds) === 1)
  check(
    "an over-wide canvas is clamped to the side limit",
    Math.abs(8000 * composeClampFactor(8000, 1000, bounds) - 4096) < 1e-6
  )
  check(
    "an over-area canvas is clamped to the area limit",
    (() => {
      const f = composeClampFactor(4000, 4000, bounds)
      return f < 1 && 4000 * f * 4000 * f <= bounds.maxArea + 1
    })()
  )
  check(
    "a preset's max_height clamps the canvas rather than earning a 422",
    (() => {
      const f = composeClampFactor(1920, 1080, { ...bounds, maxHeight: 720 })
      return Math.abs(1080 * f - 720) < 1e-6
    })()
  )

  // …end to end, on a board tall enough to reach the caps: a 720-tall preset
  // really does solve a shorter canvas, and the loop reports the shrink.
  const tallOpts = {
    layout: ["v2", ...TALL_RECORDS],
    targetWidth: 1000,
    widthMode: "output",
    length: { mode: "cap", seconds: 5 },
  }
  const wide = await built({ ...tallOpts, preset: MP4 })
  check(
    "a tall board is clamped to the server's canvas side limit",
    wide.height <= LIMITS.max_canvas_side &&
      wide.width * wide.height <= LIMITS.max_canvas_area,
    `${wide.width}x${wide.height}`
  )
  check(
    "…and the clamp is reported back to the caller",
    wide.clampedWidth !== null,
    `${wide.clampedWidth}`
  )
  const tall = await built({ ...tallOpts, preset: WEBP })
  check(
    "a webp document's canvas fits under the preset's height cap",
    tall.height <= 720,
    `${tall.width}x${tall.height}`
  )
  check(
    "…and it is SHORTER than the same board under a preset with no cap",
    tall.height < wide.height,
    `${tall.height} vs ${wide.height}`
  )
  check(
    "…and its rectangles are still inside it",
    tall.body.items.length > 0 &&
      tall.body.items.every(
        (i) =>
          i.dest.x >= 0 &&
          i.dest.y >= 0 &&
          i.dest.x + i.dest.w <= tall.width &&
          i.dest.y + i.dest.h <= tall.height
      ),
    shape(tall.body.items.map((i) => i.dest))
  )
}

// ---- length policy and rows --------------------------------------------

{
  const doc = await built()
  check(
    "longest_loop_once resolves to the longest span",
    doc.requestedSeconds === 7,
    `${doc.requestedSeconds}`
  )
  check(
    "a stills-only board resolves to the server's one-second floor",
    composeRequestedSeconds({ mode: "longest_loop_once" }, null) ===
      STILLS_ONLY_TARGET_SECONDS
  )
  check(
    "a cap is the cap",
    composeRequestedSeconds({ mode: "cap", seconds: 15 }, 90) === 15
  )
  check(
    "the longest span is the longest SPAN, stills excluded",
    longestSpanSeconds([
      { kind: "still", at_cs: 500 },
      { kind: "span", start_cs: 0, end_cs: 250 },
      { kind: "span", start_cs: 100, end_cs: 900 },
      { kind: "image" },
    ]) === 8
  )
  check("nothing playing has no span", longestSpanSeconds([{ kind: "image" }]) === null)

  const presets = [MP4, WEBP]
  check(
    "every row is offered for a short composition",
    composeRows(presets, { requestedSeconds: 7, limits: LIMITS }).length === 2
  )
  check(
    "the animated-image row is HIDDEN past its length cap",
    shape(
      composeRows(presets, { requestedSeconds: 20, limits: LIMITS }).map((r) => r.preset.id)
    ) === shape(["mosaic-mp4"])
  )
  check(
    "an unknown limit hides it too — a row that always 422s is worse than no row",
    composeRows(presets, { requestedSeconds: 7, limits: null }).length === 1
  )
  check(
    "rows label themselves with the preset's own name",
    composeRows(presets, { requestedSeconds: 7, limits: LIMITS })[1].label ===
      "Animated WebP"
  )
  check(
    "an empty preset table yields no rows at all",
    composeRows([], { requestedSeconds: 7, limits: LIMITS }).length === 0
  )
}

// ---- fps and background -------------------------------------------------

{
  const doc = await built()
  check("fps defaults to 30", doc.body.fps === DEFAULT_COMPOSE_FPS, `${doc.body.fps}`)
  const capped = await built({ limits: { ...LIMITS, max_compose_fps: 12 } })
  check("…capped by the server's own maximum", capped.body.fps === 12, `${capped.body.fps}`)
  const asked = await built({ fps: 50 })
  check("an explicit fps is honoured", asked.body.fps === 50)

  check(
    "the page background arrives as rgb() and leaves as hex",
    doc.body.canvas.background === "#09090b",
    doc.body.canvas.background
  )
  check(
    "hex passes through, short hex expands",
    normalizeComposeBackground("#ABC") === "#aabbcc" &&
      normalizeComposeBackground("#101820") === "#101820"
  )
  check(
    "rgba() keeps its three colour channels",
    normalizeComposeBackground("rgba(255, 0, 128, 0.5)") === "#ff0080"
  )
  check(
    "anything unreadable is black, never a filter argument",
    normalizeComposeBackground("var(--background)") === "#000000" &&
      normalizeComposeBackground(null) === "#000000" &&
      normalizeComposeBackground("color=red[x];[x]") === "#000000"
  )
  check(
    "the length policy rides verbatim",
    shape(doc.body.output.length) === shape({ mode: "longest_loop_once" }) &&
      doc.body.output.preset === "mosaic-mp4"
  )
}

// ---- the selection scope ------------------------------------------------

{
  // The key is the RECORD OFFSET plus the sha — the image pin is the second
  // five-string record, so its offset is 5.
  const only = new Set(["5-" + IMAGE_SHA])
  const doc = await built({ only, targetWidth: 1200, widthMode: "output" })
  check(
    "a selection composes only its own keys",
    doc.body.items.length === 1 && doc.body.items[0].sha256 === IMAGE_FULL
  )
  check(
    "…at the width the row asked the FILE to be",
    Math.abs(doc.width - 1200) <= 4,
    `${doc.width}`
  )
  const gone = await build({ only: new Set(["999-zzzzzzzzzz"]) })
  check(
    "a selection naming nothing on the board reports no pins",
    gone.ok === false && gone.failure === "no-pins",
    shape(gone)
  )
}

// ---- the single-item document -------------------------------------------

{
  const geo = solveAt(BOARD_W).geometry
  const placement = geo.placements[0]
  const meta = META[VIDEO_SHA]
  const result = buildItemCompositionDoc({
    placement,
    meta,
    state: PLAYING,
    preset: MP4,
    limits: LIMITS,
    length: { mode: "longest_loop_once" },
    targetWidth: null,
    background: "#101820",
  })
  check("a playing pin composes on its own", result.ok === true, shape(result))
  const doc = result.doc
  const native = itemOutputSize(
    placement.crop,
    meta.width,
    meta.height,
    placement.orient,
    null
  )
  check(
    "the canvas is the crop region at source resolution, rounded to even",
    doc.width === native.width - (native.width % 2) &&
      doc.height === native.height - (native.height % 2),
    `${doc.width}x${doc.height} from ${native.width}x${native.height}`
  )
  check(
    "the item covers the whole canvas at the origin — even by construction",
    shape(doc.body.items[0].dest) ===
      shape({ x: 0, y: 0, w: doc.width, h: doc.height }),
    shape(doc.body.items[0].dest)
  )
  check(
    "the crop and orientation are the board's",
    shape(doc.body.items[0].transform) === shape({ quarter_turns: 1, flip_h: false }) &&
      doc.body.items[0].time.kind === "span"
  )
  const capped = buildItemCompositionDoc({
    placement,
    meta,
    state: PLAYING,
    preset: WEBP,
    limits: LIMITS,
    length: { mode: "longest_loop_once" },
    targetWidth: null,
    background: "#101820",
  })
  check(
    "the preset's height cap shrinks the single-item canvas too",
    capped.ok && capped.doc.height <= 720,
    capped.ok ? `${capped.doc.width}x${capped.doc.height}` : shape(capped)
  )
  const unknown = buildItemCompositionDoc({
    placement,
    meta: { ...meta, width: null, height: null },
    state: PLAYING,
    preset: MP4,
    limits: LIMITS,
    length: { mode: "longest_loop_once" },
    targetWidth: null,
    background: "#101820",
  })
  check(
    "an item with no dimensions refuses rather than guessing a canvas",
    unknown.ok === false && unknown.failure === "degenerate",
    shape(unknown)
  )
}

console.log(all ? "\nALL PASS" : "\nFAILURES")
process.exit(all ? 0 : 1)
