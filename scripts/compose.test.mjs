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
  clipPinDrawToCanvas,
  composeClampFactor,
  composeRequestedSeconds,
  composeRows,
  composeTargetCs,
  estimateLoopBytes,
  longestSpanSeconds,
  naturalSize,
  normalizeComposeBackground,
  resolveItemRendering,
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
  // avif deliberately absent, so the capability-miss rows below are real.
  span_capable_image_mimes: ["image/gif", "image/webp"],
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
  // Nothing on this board is cut by the canvas edge (the pins sit well inside
  // it — asserted, not assumed), so the sizes are the compositor's rounded and
  // NOT clamped. Re-deriving the clamp here would be circular: it would agree
  // with the builder whatever the builder did, which is exactly how a squashed
  // straddler went unnoticed. The clipped case is its own block below.
  check(
    "the fixture's pins really are inside the canvas",
    draw.dest.left >= 0 &&
      draw.dest.top >= 0 &&
      draw.dest.left + draw.dest.width <= doc.width &&
      draw.dest.top + draw.dest.height <= doc.height,
    `${shape(draw.dest)} in ${doc.width}x${doc.height}`
  )
  check(
    "…so the SIZES are left alone (scale honours them; overlay does not honour odd offsets)",
    item.dest.w === Math.round(draw.dest.width) &&
      item.dest.h === Math.round(draw.dest.height),
    `${shape(item.dest)} vs ${draw.dest.width}x${draw.dest.height}`
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

// ---- the canvas edge cuts the SOURCE too --------------------------------
//
// A pin the visible-extent fold crosses gets a SHORTER destination rectangle,
// and `scale` obeys whatever rectangle it is handed: sending the whole frame
// with a half-height dest squashes the picture, where the canvas mosaic draws
// the top half at its own aspect. So the source has to shrink by the same
// fraction — on whichever source axis and side the pin's orientation sends the
// display's BOTTOM edge to.
//
// The expected side per quarter turn is written out by hand below, from the
// rotation itself (display = source turned `q` quarters CLOCKWISE, so the
// display's bottom row is the source's left column for q=3, its right column
// for q=1, and so on). Deriving it from `sourceRect` instead would assert only
// that the builder calls the function it calls.

{
  const near = (a, b) => Math.abs(a - b) <= 2
  const CLIP_CROP = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }
  const VIS_ROWS = 40
  // foldRows(V2_GRID, 410) === 40, i.e. the fill line lands at 405 px.
  const FOLD_BOARD_H = 410

  // An image pin at the top (so the capture box starts at the board origin and
  // the canvas is a full screenful tall) and a TALL video pin whose bottom half
  // hangs past the fill line.
  const clipRecords = (q) => [
    IMAGE_SHA, "0", "0", "20", "12",
    VIDEO_SHA, "24", "30", "20",
    packHField(20, {
      crop: CLIP_CROP,
      autoCrop: null,
      trim: { start: 1.5, end: 8.5 },
      lock: null,
      orient: q === 0 ? null : { quarterTurns: q, flipped: false },
    }),
  ]

  for (const q of [0, 1, 2, 3]) {
    const records = clipRecords(q)
    const doc = await built({
      layout: ["v2", ...records],
      boardHeight: FOLD_BOARD_H,
      extent: "visible",
    })
    const geo = mosaicGeometry({
      records,
      grid: effectiveGrid(G, 1),
      layoutWidth: BOARD_W,
      seamless: false,
      extent: "visible",
      visibleRows: VIS_ROWS,
    }).geometry
    const p = geo.placements[1]
    const meta = META[VIDEO_SHA]
    const draw = resolvePinDraw(p, meta.width, meta.height, {
      left: p.left - geo.cropLeft,
      top: p.top - geo.cropTop,
      width: p.width,
      height: p.height,
    })
    // Whole-frame source pixels, the rect a builder with no clip would send.
    const full = {
      x: Math.floor(draw.src.x * meta.width),
      y: Math.floor(draw.src.y * meta.height),
      w: Math.round(draw.src.w * meta.width),
      h: Math.round(draw.src.h * meta.height),
    }
    const kept = (doc.height - draw.dest.top) / draw.dest.height
    const item = doc.body.items[1]
    const src = item.src

    check(
      `q=${q}: the fixture pin really is cut by the bottom edge`,
      draw.dest.top < doc.height &&
        draw.dest.top + draw.dest.height > doc.height &&
        kept > 0.2 &&
        kept < 0.9,
      `dest ${draw.dest.top}..${draw.dest.top + draw.dest.height}, canvas ${doc.height}, kept ${kept}`
    )
    check(
      `q=${q}: the destination is the visible remainder, not the whole cell`,
      near(item.dest.h, doc.height - draw.dest.top) &&
        item.dest.y + item.dest.h <= doc.height,
      `${shape(item.dest)} of ${doc.width}x${doc.height}`
    )
    const want =
      q === 0
        ? // display bottom = source bottom
          { axis: "h", size: near(src.h, full.h * kept), origin: src.y === full.y, other: src.x === full.x && src.w === full.w }
        : q === 1
          ? // a clockwise quarter turn puts the source's RIGHT column along the
            // display's bottom
            { axis: "w", size: near(src.w, full.w * kept), origin: src.x === full.x, other: src.y === full.y && src.h === full.h }
          : q === 2
            ? // half turn: the display's bottom is the source's TOP
              { axis: "h", size: near(src.h, full.h * kept), origin: src.y > full.y && near(src.y + src.h, full.y + full.h), other: src.x === full.x && src.w === full.w }
            : // three quarters: the display's bottom is the source's LEFT
              { axis: "w", size: near(src.w, full.w * kept), origin: src.x > full.x && near(src.x + src.w, full.x + full.w), other: src.y === full.y && src.h === full.h }
    check(
      `q=${q}: the source shrinks on the ${want.axis} axis, by the fraction the canvas kept`,
      want.size && want.origin && want.other,
      `${shape(src)} vs full ${shape(full)} kept ${kept}`
    )
    check(
      `q=${q}: the source rect stays inside the frame`,
      src.x >= 0 &&
        src.y >= 0 &&
        src.x + src.w <= meta.width &&
        src.y + src.h <= meta.height,
      shape(src)
    )
  }

  // The unclipped identity: a pin the edge does not touch keeps the rect
  // `resolvePinDraw` gave it, to the pixel.
  {
    const dest = { left: 10, top: 20, width: 100, height: 50 }
    const clipped = clipPinDrawToCanvas({
      dest,
      crop: CLIP_CROP,
      orient: { quarterTurns: 1, flipped: false },
      canvasW: 400,
      canvasH: 400,
    })
    check(
      "a pin inside the canvas is not clipped at all",
      near(clipped.dest.left, 10) &&
        near(clipped.dest.width, 100) &&
        near(clipped.src.w, 0.8) &&
        near(clipped.src.h, 0.8),
      shape(clipped)
    )
  }

  // The phantom sliver: two pixels of a scaled-down picture is not a picture,
  // and the canvas mosaic draws nothing meaningful there either.
  check(
    "a pin the edge leaves a sliver of is skipped rather than composed",
    clipPinDrawToCanvas({
      dest: { left: 10, top: 98, width: 100, height: 100 },
      crop: null,
      orient: null,
      canvasW: 200,
      canvasH: 100,
    }) === null &&
      clipPinDrawToCanvas({
        dest: { left: 199, top: 10, width: 100, height: 100 },
        crop: null,
        orient: null,
        canvasW: 200,
        canvasH: 200,
      }) === null
  )
  check(
    "…and one with three pixels left is kept",
    clipPinDrawToCanvas({
      dest: { left: 10, top: 97, width: 100, height: 100 },
      crop: null,
      orient: null,
      canvasW: 200,
      canvasH: 100,
    }) !== null
  )
  check(
    "a pin entirely past the edge is skipped too",
    clipPinDrawToCanvas({
      dest: { left: 10, top: 220, width: 100, height: 100 },
      crop: null,
      orient: null,
      canvasW: 200,
      canvasH: 200,
    }) === null
  )

  // …end to end: a pin whose picture begins below the cut is named in the
  // receipt rather than silently dropped or squashed into a stripe.
  {
    const records = [
      IMAGE_SHA, "0", "0", "20", "12",
      VIDEO_SHA, "24", "38", "20",
      // A very wide crop letterboxes the picture down the middle of the cell,
      // which puts its top edge past the fill line.
      packHField(20, {
        crop: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 },
        autoCrop: null,
        trim: { start: 1.5, end: 8.5 },
        lock: null,
        orient: null,
      }),
    ]
    const doc = await built({
      layout: ["v2", ...records],
      boardHeight: FOLD_BOARD_H,
      extent: "visible",
    })
    check(
      "a pin the cut leaves nothing of is skipped and reported",
      doc.body.items.length === 1 &&
        doc.body.items[0].sha256 === IMAGE_FULL &&
        shape(doc.skipped) === shape([VIDEO_SHA]),
      `${shape(doc.body.items.map((i) => i.sha256))} skipped ${shape(doc.skipped)}`
    )
  }
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
      name: "a PAUSED video is a still at its own PLAYHEAD, not the trim start",
      input: {
        isVideo: true,
        trim: { start: 3, end: 9 },
        state: { playing: false, muted: false, duration: 12, currentTime: 5.3 },
        duration: 12,
      },
      want: { kind: "still", at_cs: 530 },
    },
    {
      name: "…even parked at 0 — a real playhead, not a missing one",
      input: {
        isVideo: true,
        trim: { start: 3, end: 9 },
        state: { playing: false, muted: false, duration: 12, currentTime: 0 },
        duration: 12,
      },
      want: { kind: "still", at_cs: 0 },
    },
    {
      name: "an ENDED element's playhead (== duration) clamps onto the last frame",
      input: {
        isVideo: true,
        trim: null,
        state: { playing: false, muted: false, duration: 12, currentTime: 12 },
        duration: 12,
      },
      want: { kind: "still", at_cs: 1199 },
    },
    {
      name: "a PAUSED video with no readable playhead falls back to its trim start",
      input: {
        isVideo: true,
        trim: { start: 3, end: 9 },
        state: { playing: false, muted: false, duration: 12, currentTime: null },
        duration: 12,
      },
      want: { kind: "still", at_cs: 300 },
    },
    {
      name: "a PLAYING pin's span never reads the playhead",
      input: {
        isVideo: true,
        trim: { start: 1.5, end: 8.5 },
        state: { playing: true, muted: false, duration: 12, currentTime: 5.3 },
        duration: 12,
      },
      want: { kind: "span", start_cs: 150, end_cs: 850 },
    },
    {
      name: "…nor does a playing pin that degrades to a still (no knowable end)",
      input: {
        isVideo: true,
        trim: null,
        state: { playing: true, muted: false, duration: null, currentTime: 5.3 },
        duration: null,
      },
      want: { kind: "still", at_cs: 0 },
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

// ---- time: the animated-image rule (design §6) ---------------------------
//
// A non-video with a measured animation length AND a container on the
// server's capability list is a span — always the full 0..duration, since an
// animated image has no <video> element, no trim and no play state — and
// everything else stays the frozen image it has always been.

{
  const caps = LIMITS.span_capable_image_mimes
  const table = [
    {
      name: "a measured GIF on the capability list is a full-length span",
      input: {
        isVideo: false, trim: null, state: null,
        duration: 3, mime: "image/gif", spanCapableImageMimes: caps,
      },
      want: { kind: "span", start_cs: 0, end_cs: 300 },
    },
    {
      name: "…and a fractional length lands on the centisecond lattice",
      input: {
        isVideo: false, trim: null, state: null,
        duration: 0.75, mime: "image/webp", spanCapableImageMimes: caps,
      },
      want: { kind: "span", start_cs: 0, end_cs: 75 },
    },
    {
      name: "a measured-still image (duration 0) stays an image",
      input: {
        isVideo: false, trim: null, state: null,
        duration: 0, mime: "image/gif", spanCapableImageMimes: caps,
      },
      want: { kind: "image" },
    },
    {
      name: "an unmeasured image (duration null) stays an image",
      input: {
        isVideo: false, trim: null, state: null,
        duration: null, mime: "image/gif", spanCapableImageMimes: caps,
      },
      want: { kind: "image" },
    },
    {
      name: "a container off the capability list composes frozen",
      input: {
        isVideo: false, trim: null, state: null,
        duration: 3, mime: "image/avif", spanCapableImageMimes: caps,
      },
      want: { kind: "image" },
    },
    {
      name: "the empty pre-envelope fallback list composes frozen too",
      input: {
        isVideo: false, trim: null, state: null,
        duration: 3, mime: "image/gif", spanCapableImageMimes: [],
      },
      want: { kind: "image" },
    },
    {
      name: "a caller that passes no capability input at all composes frozen",
      input: { isVideo: false, trim: null, state: null, duration: 3 },
      want: { kind: "image" },
    },
    {
      name: "a sub-centisecond animation composes frozen, not as span{0,0}",
      input: {
        isVideo: false, trim: null, state: null,
        duration: 0.004, mime: "image/webp", spanCapableImageMimes: caps,
      },
      want: { kind: "image" },
    },
  ]
  for (const row of table) {
    const got = resolveItemTime(row.input)
    const ok = shape(got) === shape(row.want)
    check(row.name, ok, ok ? "" : `${shape(got)} != ${shape(row.want)}`)
  }
}

// ---- animated images through the builders --------------------------------
//
// The rule above, threaded: the board builder passes the envelope's
// capability list into every item's classification, and the single-item
// builder resolves the SAME span the item-row gate keys on — an animated GIF
// saves as a looping clip, a genuine still refuses exactly as before.

{
  const GIF_META = {
    ...META[IMAGE_SHA],
    type: "image/gif",
    duration: 2.5,
  }
  const doc = await built({
    getMeta: async (sha) => (sha === IMAGE_SHA ? GIF_META : META[sha] ?? null),
  })
  const gifItem = doc.body.items[1]
  check(
    "a measured GIF pin composes as its full span, with no audio",
    gifItem.time.kind === "span" &&
      gifItem.time.start_cs === 0 &&
      gifItem.time.end_cs === 250 &&
      gifItem.audio === false,
    shape(gifItem.time)
  )
  const preEnvelope = await built({
    getMeta: async (sha) => (sha === IMAGE_SHA ? GIF_META : META[sha] ?? null),
    limits: null,
  })
  check(
    "…but with no envelope yet the same GIF composes frozen",
    preEnvelope.body.items[1].time.kind === "image",
    shape(preEnvelope.body.items[1].time)
  )

  // The single-item export gate keys on the RESOLVED kind: the same
  // classification the item hook runs answers span for this pin, and the
  // document built for it is that span covering its own canvas.
  const placement = solveAt(BOARD_W).geometry.placements[1]
  const single = buildItemCompositionDoc({
    placement,
    meta: GIF_META,
    state: null,
    preset: MP4,
    limits: LIMITS,
    length: { mode: "longest_loop_once" },
    targetWidth: null,
    background: "#101820",
  })
  check(
    "a GIF pin saves on its own as a looping clip",
    single.ok === true &&
      single.doc.body.items[0].time.kind === "span" &&
      single.doc.body.items[0].time.end_cs === 250,
    shape(single)
  )
  check(
    "…and the gate's own classification refuses a genuine still",
    resolveItemTime({
      isVideo: false,
      trim: placement.trim,
      state: null,
      duration: META[IMAGE_SHA].duration,
      mime: META[IMAGE_SHA].type,
      spanCapableImageMimes: LIMITS.span_capable_image_mimes,
    }).kind === "image"
  )
}

// ---- the closed video: composite the stored thumbnail --------------------
//
// docs/compose-still-video-parity-design.md §3: a video pin with no <video>
// mounted is SHOWING its generated thumbnail, so the export composites the
// thumbnail itself — a thumbnail-source image item whose rectangles are in
// the THUMBNAIL's pixel space, exactly as the static mosaic draws it. A
// thumbnail that cannot be measured falls back to the file-source still,
// degraded and never refused.

{
  const THUMB = { width: 640, height: 480 }

  check(
    "a closed video with a measurable thumbnail renders as a thumbnail-source image",
    (() => {
      const r = resolveItemRendering({
        isVideo: true, trim: { start: 1.5, end: 8.5 }, state: null,
        duration: 12, thumbnail: THUMB,
      })
      return r.source === "thumbnail" && r.time.kind === "image"
    })()
  )
  check(
    "…with no thumbnail to measure it falls back to the file-source still",
    (() => {
      const r = resolveItemRendering({
        isVideo: true, trim: { start: 1.5, end: 8.5 }, state: null,
        duration: 12, thumbnail: null,
      })
      return r.source === "file" && shape(r.time) === shape({ kind: "still", at_cs: 150 })
    })()
  )
  check(
    "…and the 4096x4096 missing-thumbnail placeholder reads as no thumbnail",
    (() => {
      const r = resolveItemRendering({
        isVideo: true, trim: { start: 1.5, end: 8.5 }, state: null,
        duration: 12, thumbnail: { width: 4096, height: 4096 },
      })
      return r.source === "file" && shape(r.time) === shape({ kind: "still", at_cs: 150 })
    })()
  )
  check(
    "a MOUNTED stopped pin keeps the file source — its picture is the element's",
    (() => {
      const r = resolveItemRendering({
        isVideo: true, trim: null,
        state: { playing: false, muted: false, duration: 12, currentTime: 4 },
        duration: 12, thumbnail: THUMB,
      })
      return r.source === "file" && shape(r.time) === shape({ kind: "still", at_cs: 400 })
    })()
  )
  check(
    "a playing pin keeps its trim-keyed span, thumbnail or not",
    (() => {
      const r = resolveItemRendering({
        isVideo: true, trim: { start: 1.5, end: 8.5 }, state: PLAYING,
        duration: 12, thumbnail: THUMB,
      })
      return r.source === "file" && shape(r.time) === shape({ kind: "span", start_cs: 150, end_cs: 850 })
    })()
  )
  check(
    "a non-video never composes from a thumbnail",
    resolveItemRendering({
      isVideo: false, trim: null, state: null, duration: null, thumbnail: THUMB,
    }).source === "file"
  )

  // …and through the board builder. The thumbnail dims are deliberately NOT
  // proportional to the index's 1920x1080, so a builder still solving these
  // rectangles in file space fails the numbers loudly.
  const thumbOf = (key) => (key.endsWith(VIDEO_SHA) ? THUMB : null)
  const doc = await built({ probe: () => null, thumb: thumbOf })
  const geo = solveAt(BOARD_W).geometry
  const placement = geo.placements[0]
  const draw = resolvePinDraw(placement, THUMB.width, THUMB.height, {
    left: placement.left - geo.cropLeft,
    top: placement.top - geo.cropTop,
    width: placement.width,
    height: placement.height,
  })
  const item = doc.body.items[0]
  check(
    "a closed video composes as a thumbnail-source image item, with no audio",
    item.source === "thumbnail" && item.time.kind === "image" && item.audio === false,
    shape(item)
  )
  check(
    "…whose source rect is in the THUMBNAIL's pixel space",
    item.src.x === Math.floor(draw.src.x * THUMB.width) &&
      item.src.y === Math.floor(draw.src.y * THUMB.height) &&
      item.src.w === Math.round(draw.src.w * THUMB.width) &&
      item.src.h === Math.round(draw.src.h * THUMB.height) &&
      item.src.x + item.src.w <= THUMB.width &&
      item.src.y + item.src.h <= THUMB.height,
    `${shape(item.src)} vs ${shape(draw.src)} of ${THUMB.width}x${THUMB.height}`
  )
  check(
    "…while the image pin beside it keeps its file source",
    doc.body.items[1].source === "file",
    shape(doc.body.items[1])
  )
  const fallback = await built({ probe: () => null, thumb: () => null })
  check(
    "a closed video with no measurable thumbnail composes the file-source still",
    fallback.body.items[0].source === "file" &&
      shape(fallback.body.items[0].time) === shape({ kind: "still", at_cs: 150 }),
    shape(fallback.body.items[0])
  )
  const noProbe = await built({ probe: () => null })
  check(
    "…and a builder given no thumb probe at all composes the same fallback",
    noProbe.body.items[0].source === "file" &&
      shape(noProbe.body.items[0].time) === shape({ kind: "still", at_cs: 150 }),
    shape(noProbe.body.items[0])
  )
  const playing = await built({ thumb: thumbOf })
  check(
    "a playing pin's span is untouched by the thumbnail probe",
    playing.body.items[0].source === "file" &&
      shape(playing.body.items[0].time) ===
        shape({ kind: "span", start_cs: 150, end_cs: 850 }),
    shape(playing.body.items[0])
  )
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
  check(
    "the playhead is read off the element, 0 included",
    videoStateOf({
      paused: true, ended: false, readyState: 4, muted: false, duration: 9,
      currentTime: 3.5,
    }).currentTime === 3.5 &&
      videoStateOf({
        paused: true, ended: false, readyState: 4, muted: false, duration: 9,
        currentTime: 0,
      }).currentTime === 0
  )
  check(
    "…and a non-finite (or absent) playhead reads as unknown",
    videoStateOf({
      paused: true, ended: false, readyState: 4, muted: false, duration: 9,
      currentTime: NaN,
    }).currentTime === null &&
      videoStateOf({
        paused: true, ended: false, readyState: 4, muted: false, duration: 9,
      }).currentTime === null
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
  // The VIDEO containers are capped too — by a much larger number, but the
  // server clamps against it the same silent way, so the row goes with it.
  check(
    "an mp4/webm row is hidden past max_output_seconds",
    composeRows(presets, { requestedSeconds: 61, limits: LIMITS }).length === 0 &&
      composeRows(presets, { requestedSeconds: 60, limits: LIMITS }).map((r) => r.preset.id)[0] ===
        "mosaic-mp4"
  )
  check(
    "…and a length CAP under the limit brings it back",
    composeRows(presets, {
      requestedSeconds: composeRequestedSeconds({ mode: "cap", seconds: 10 }, 900),
      limits: LIMITS,
    }).length === 2
  )
  check(
    "an unknown limit hides every row — one that always truncates is worse than none",
    composeRows(presets, { requestedSeconds: 7, limits: null }).length === 0
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

// ---- the loop-memory pre-solve ------------------------------------------
//
// `compose.rs`'s `check_loop_memory`, mirrored so a board that would 422 comes
// back as a smaller mosaic instead. Every item shorter than the output is held
// open by a loop filter buffering its whole segment at DESTINATION resolution.

{
  const px = (w, h) => ({ x: 0, y: 0, w, h })
  check(
    "the longest span buffers nothing — it plays straight through",
    estimateLoopBytes(
      [{ dest: px(100, 100), time: { kind: "span", start_cs: 0, end_cs: 500 } }],
      30,
      500
    ) === 0
  )
  check(
    "a shorter span buffers ceil(span * fps) frames at 3/2 bytes a pixel",
    estimateLoopBytes(
      [{ dest: px(100, 100), time: { kind: "span", start_cs: 0, end_cs: 250 } }],
      30,
      500
    ) === 75 * 100 * 100 * 1.5,
    `${estimateLoopBytes([{ dest: px(100, 100), time: { kind: "span", start_cs: 0, end_cs: 250 } }], 30, 500)}`
  )
  check(
    "a still and an image hold exactly one frame each",
    estimateLoopBytes(
      [
        { dest: px(100, 100), time: { kind: "still", at_cs: 0 } },
        { dest: px(100, 100), time: { kind: "image" } },
      ],
      30,
      500
    ) === 2 * 100 * 100 * 1.5
  )
  check(
    "the target length is the longest span, capped by the container's own limit",
    composeTargetCs({ mode: "longest_loop_once" }, [{ kind: "span", start_cs: 0, end_cs: 700 }], "mp4", LIMITS) === 700 &&
      composeTargetCs({ mode: "cap", seconds: 900 }, [], "mp4", LIMITS) === 6000 &&
      composeTargetCs({ mode: "cap", seconds: 900 }, [], "webp", LIMITS) === 1500 &&
      composeTargetCs({ mode: "longest_loop_once" }, [{ kind: "image" }], "mp4", LIMITS) ===
        STILLS_ONLY_TARGET_SECONDS * 100
  )

  // Twelve half-size video pins, all looping under a thirty-second cap: at the
  // width asked for they buffer well over the 512 MB budget, so the builder
  // re-solves smaller instead of posting a document the server refuses.
  const LOOP_SHA = "cccccccccc"
  const LOOP_FULL = "cccccccccc".repeat(6) + "1234"
  const LOOP_META = {
    sha256: LOOP_FULL,
    type: "video/mp4",
    width: 1000,
    height: 1000,
    duration: 30,
  }
  const loopBoard = (spanSeconds) => {
    const records = []
    for (let i = 0; i < 12; i++) {
      records.push(
        LOOP_SHA,
        String((i % 4) * 27),
        String(Math.floor(i / 4) * 50),
        "27",
        packHField(50, {
          crop: null,
          autoCrop: null,
          trim: { start: 0, end: spanSeconds },
          lock: null,
          orient: null,
        })
      )
    }
    return records
  }
  const loopOpts = (spanSeconds) => ({
    layout: ["v2", ...loopBoard(spanSeconds)],
    boardWidth: 2000,
    boardHeight: 4000,
    targetWidth: 2000,
    length: { mode: "cap", seconds: 30 },
    getMeta: async () => LOOP_META,
    probe: () => ({ playing: true, muted: true, duration: 30, width: null, height: null }),
  })
  const budget = LIMITS.max_mosaic_loop_mb * 1024 * 1024
  const bytesOf = (doc) =>
    estimateLoopBytes(
      doc.body.items,
      doc.body.fps,
      composeTargetCs(
        doc.body.output.length,
        doc.body.items.map((i) => i.time),
        "mp4",
        LIMITS
      )
    )

  const short = await built(loopOpts(3))
  check(
    "a composition inside the budget is left at the width it asked for",
    short.clampedWidth === null && bytesOf(short) <= budget,
    `${short.width}x${short.height}, ${Math.round(bytesOf(short) / 1024 / 1024)} MB`
  )
  const long = await built(loopOpts(5))
  check(
    "…and one over it is re-solved smaller until it fits",
    long.clampedWidth !== null && bytesOf(long) <= budget,
    `${long.width}x${long.height} clamped=${long.clampedWidth}, ${Math.round(bytesOf(long) / 1024 / 1024)} MB`
  )
  check(
    "…which is a SMALLER canvas of the same twelve pins, not fewer pins",
    long.width < short.width &&
      long.body.items.length === 12 &&
      long.skipped.length === 0,
    `${long.width} vs ${short.width}, ${long.body.items.length} items`
  )
  // The invariant, at a budget no ordinary mosaic could meet: a document is
  // NEVER handed back over the limit. Refusing is allowed (the canvas floor is
  // reached first for absurd budgets); posting one the server would turn away
  // is not.
  const tinyLimits = { ...LIMITS, max_mosaic_loop_mb: 1 }
  const hopeless = await build({ ...loopOpts(5), limits: tinyLimits })
  check(
    "no budget ever yields a document over it",
    hopeless.ok === false ||
      estimateLoopBytes(
        hopeless.doc.body.items,
        hopeless.doc.body.fps,
        composeTargetCs(
          hopeless.doc.body.output.length,
          hopeless.doc.body.items.map((i) => i.time),
          "mp4",
          tinyLimits
        )
      ) <= 1024 * 1024,
    hopeless.ok ? `${hopeless.doc.width}x${hopeless.doc.height}` : hopeless.detail
  )
}

// ---- natural dimensions: the element's, when it is mounted --------------

{
  check(
    "a mounted element's naturals win over the index's record",
    shape(naturalSize({ width: 1920, height: 1080 }, { width: 1080, height: 1920 })) ===
      shape({ width: 1080, height: 1920 })
  )
  check(
    "…and are taken as a PAIR, never mixed with the index's",
    shape(naturalSize({ width: 1920, height: 1080 }, { width: 1080, height: null })) ===
      shape({ width: 1920, height: 1080 })
  )
  check(
    "an unmounted pin falls back to the index",
    shape(naturalSize({ width: 800, height: 600 }, null)) === shape({ width: 800, height: 600 })
  )
  check(
    "and neither source is no size at all",
    naturalSize({ width: null, height: null }, { width: 0, height: 0 }) === null
  )
  // End to end: the same board, one pin mounted at the OTHER aspect (a rotated
  // video, which a browser reports already rotated). The document is written
  // in the element's pixels, which is where the server's compositor reads.
  const doc = await built({
    probe: (key) =>
      key.endsWith(VIDEO_SHA)
        ? { ...PLAYING, width: 1080, height: 1920 }
        : null,
  })
  check(
    "the document's source rect is in the ELEMENT's pixels",
    doc.body.items[0].src.w === 864 &&
      doc.body.items[0].src.h === 1536 &&
      doc.body.items[0].src.x + doc.body.items[0].src.w <= 1080,
    shape(doc.body.items[0].src)
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
