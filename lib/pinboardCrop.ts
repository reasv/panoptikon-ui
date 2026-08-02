// Crop and playback-trim state for pinboard items.
//
// A crop is a rectangle over the source image in normalized coordinates:
// x/y is the top-left corner, w/h the size, all as fractions of the source
// image dimensions. The full image is {x: 0, y: 0, w: 1, h: 1}.
//
// Each item has TWO crop slots:
//   - The MANUAL crop (`c` segment) is what the crop editor edits. It acts
//     as a rebase: it defines the image everything else sees — layout math,
//     the auto crop, and rendering all treat the manually-cropped region as
//     the source image.
//   - The AUTO crop (`a` segment) is a derived fit-to-cell crop, expressed
//     as fractions OF THE MANUAL-CROPPED REGION. It is always recomputed
//     from that base (never from its own previous value, which would
//     ratchet: each recompute would crop the crop). Its presence doubles as
//     a sticky per-image "keep me fitted to my cell" flag — layout actions
//     that resize cells recompute the auto crop of any item that has one.
//     Rendering shows composeCrops(manual, auto); finishing a manual crop
//     clears the auto slot.
//
// A trim is a playback range for videos: loop playback restricted to
// [start, end] seconds, either bound optional, start === end meaning a
// freeze frame. Times are absolute seconds (not duration fractions, whose
// precision would degrade with video length) stored as base36 centiseconds.
//
// An orientation is a D4 element applied to the source image (rotation
// plus optional mirror); see PinOrientation below. Crops and trims are
// independent of it — both crop slots are stored in DISPLAY (oriented)
// space, so the layout/fit math never maps coordinates.
//
// Serialization piggybacks on the existing pinboard layout query param,
// which is a flat array of 5-string records [sha256, x, y, w, h]. All are
// appended to the `h` slot:
// "<h>[c<8>][a<8>][t<start>.<end>][L<a|s>][O<1-7>]" — "c" + 8 chars for the
// manual crop, "a" + 8 chars for the auto crop (same encoding), then
// "t<start>.<end>" for the trim (either side empty when unset), then "L"
// plus a flag for the layout lock ("a" = anchored in place, "s" = size
// locked; "p" is accepted as a legacy alias of "a" from before the anchor
// rename), then "O" plus the orientation code (identity omitted), e.g.
// "12c00zzzz00a0899zz0it5k.8aLaO5".
// The flag prefixes L and O are UPPERCASE on purpose: the trim bounds are
// variable-length base36, so a lowercase prefix appended after them would
// be swallowed as another trim digit — "t5k.8ao5" is genuinely ambiguous
// (end = "8ao5" vs end = "8a" plus an orientation), and both old and new
// parsers would resolve it wrongly. Uppercase is outside the base36
// alphabet, so every suffix segment stays self-delimiting.
//
// parseInt() reads the leading digits and ignores the suffix, so old
// clients see the correct height and simply drop the suffixes, while new
// clients reading old URLs get no suffix and default to the full image
// (fields without an `a` segment parse with autoCrop: null, without an `L`
// segment with lock: null, without an `O` segment with orient: null =
// identity).

export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 }

// Smallest allowed crop size, as a fraction of the source image
export const MIN_CROP_FRAC = 0.02

// Each value is stored as two base36 chars, 0..1 mapped to 0.."zz" (1295)
const CROP_SCALE = 1295

function encodeFrac(v: number): string {
  const n = Math.max(0, Math.min(CROP_SCALE, Math.round(v * CROP_SCALE)))
  return n.toString(36).padStart(2, "0")
}

function decodeFrac(s: string): number {
  return parseInt(s, 36) / CROP_SCALE
}

export function isFullCrop(c: CropRect): boolean {
  const eps = 0.5 / CROP_SCALE
  return c.x <= eps && c.y <= eps && c.w >= 1 - eps && c.h >= 1 - eps
}

export function clampCrop(c: CropRect): CropRect {
  const w = Math.min(1, Math.max(MIN_CROP_FRAC, c.w))
  const h = Math.min(1, Math.max(MIN_CROP_FRAC, c.h))
  return {
    x: Math.min(1 - w, Math.max(0, c.x)),
    y: Math.min(1 - h, Math.max(0, c.y)),
    w,
    h,
  }
}

// Effective crop of a manual crop plus an auto crop expressed in the manual
// crop's coordinate space: the auto rect is mapped through the manual rect
// back into source-image fractions. Either side null means the other one
// alone; both null means no crop.
export function composeCrops(
  manual: CropRect | null,
  auto: CropRect | null
): CropRect | null {
  if (!manual) return auto
  if (!auto) return manual
  return clampCrop({
    x: manual.x + auto.x * manual.w,
    y: manual.y + auto.y * manual.h,
    w: auto.w * manual.w,
    h: auto.h * manual.h,
  })
}

// Auto crops that would remove less letterbox than this many pixels (both
// bars combined, at the cell's on-screen size) are treated as no crop:
// invisible near-fits aren't worth cropping, and dropping them keeps
// hFields short. Pixel-based rather than a fraction of the cell, because
// letterbox visibility is absolute — 2% of a 1000px cell is a 20px bar.
export const AUTO_CROP_MAX_LETTERBOX_PX = 4

// Fit-to-cell auto crop: the centered window over the base (the
// manual-cropped region) whose aspect matches the cell of cellW x cellH
// pixels. Computed from the BASE aspect only, so recomputing for the same
// cell is idempotent — the result never feeds back into itself.
export function computeAutoCrop(
  baseAspect: number,
  cellW: number,
  cellH: number
): CropRect | null {
  const cellAspect = cellW / cellH
  if (!(baseAspect > 0) || !(cellAspect > 0)) return null
  if (baseAspect > cellAspect) {
    // Base wider than the cell: contain-fit letterboxes top/bottom, the
    // crop trims the sides to match
    const f = cellAspect / baseAspect
    if ((1 - f) * cellH < AUTO_CROP_MAX_LETTERBOX_PX) return null
    return clampCrop({ x: (1 - f) / 2, y: 0, w: f, h: 1 })
  }
  // Base taller than the cell: letterbox at the sides, crop top and bottom
  const f = baseAspect / cellAspect
  if ((1 - f) * cellW < AUTO_CROP_MAX_LETTERBOX_PX) return null
  return clampCrop({ x: 0, y: (1 - f) / 2, w: 1, h: f })
}

// Video playback range in seconds; null bounds are unset. start === end
// (within centisecond resolution) is a freeze frame.
export interface TrimRange {
  start: number | null
  end: number | null
}

// Trim times are stored as centiseconds in base36, variable length
const TRIM_UNIT = 100

function encodeTime(v: number): string {
  return Math.max(0, Math.round(v * TRIM_UNIT)).toString(36)
}

function decodeTime(s: string): number | null {
  if (!s) return null
  return parseInt(s, 36) / TRIM_UNIT
}

export function isEmptyTrim(trim: TrimRange | null): boolean {
  return !trim || (trim.start == null && trim.end == null)
}

function encodeCrop(prefix: string, crop: CropRect | null): string {
  if (!crop || isFullCrop(crop)) return ""
  const c = clampCrop(crop)
  return `${prefix}${encodeFrac(c.x)}${encodeFrac(c.y)}${encodeFrac(c.w)}${encodeFrac(c.h)}`
}

function decodeCrop(s: string | undefined): CropRect | null {
  if (!s) return null
  const parsed = clampCrop({
    x: decodeFrac(s.slice(0, 2)),
    y: decodeFrac(s.slice(2, 4)),
    w: decodeFrac(s.slice(4, 6)),
    h: decodeFrac(s.slice(6, 8)),
  })
  return isFullCrop(parsed) ? null : parsed
}

// Layout lock: "anchor" fixes position AND size (layout actions treat the
// item as an obstacle and pack around it; manual drags can't displace it
// either), "size" keeps the item's w x h but lets layout actions and drags
// move it. Named "anchor" rather than "pin" because pinning already means
// adding an item to the board.
export type PinLock = "anchor" | "size" | null

// Per-pin orientation: an element of the dihedral group D4 — the source
// image turned `quarterTurns` x 90 degrees CLOCKWISE and then, if
// `flipped`, mirrored horizontally. Eight states; a vertical flip is a
// horizontal flip plus 180 degrees, so one mirror flag covers both axes.
//
// CONVENTION (every helper here depends on it): the flip is applied AFTER
// the rotation, in DISPLAY space —
//   display = flipH^flipped o rotateCW^quarterTurns o source
// The other order encodes the same eight states but assigns a different
// quarterTurns to the four mirrored ones, so mixing conventions yields
// silently 90-degrees-off results rather than a type error.
export interface PinOrientation {
  quarterTurns: 0 | 1 | 2 | 3
  flipped: boolean
}

// Identity is never stored (the codec omits its segment), so `null` and
// this value are interchangeable everywhere orientation is read
export const IDENTITY_ORIENTATION: Readonly<PinOrientation> = Object.freeze({
  quarterTurns: 0,
  flipped: false,
})

export function isIdentityOrientation(o: PinOrientation | null): boolean {
  return !o || (o.quarterTurns === 0 && !o.flipped)
}

// The four orientation actions a user can invoke, always understood in
// DISPLAY space: "cw" turns what is currently on screen a quarter turn
// clockwise, "flipH" mirrors what is currently on screen left-to-right
export type OrientationOp = "cw" | "ccw" | "flipH" | "flipV"

function wrapTurns(q: number): 0 | 1 | 2 | 3 {
  return (((q % 4) + 4) % 4) as 0 | 1 | 2 | 3
}

// Apply one user action on top of an existing orientation: the new display
// transform is `op o current`. Reducing that back to the stored form with
// the D4 relation flipH o rotateCW = rotateCW^-1 o flipH gives a closed
// form per action:
//
//   op       quarterTurns          flipped
//   cw       q + (flipped ? -1 : +1)   f
//   ccw      q + (flipped ? +1 : -1)   f
//   flipH    q                        !f
//   flipV    q + 2                    !f
//
// The rotation sign inverts for mirrored pins because the mirror reverses
// the sense of the turn the user sees; without it "rotate right" would
// visibly rotate a flipped image left. Consequences worth relying on:
// each flip is self-inverse, cw and ccw cancel, and flipH followed by
// flipV is exactly 180 degrees — all exact, no accumulated drift.
export function composeOrientation(
  current: PinOrientation | null,
  op: OrientationOp
): PinOrientation {
  const { quarterTurns: q, flipped: f } = current ?? IDENTITY_ORIENTATION
  switch (op) {
    case "cw":
      return { quarterTurns: wrapTurns(q + (f ? -1 : 1)), flipped: f }
    case "ccw":
      return { quarterTurns: wrapTurns(q + (f ? 1 : -1)), flipped: f }
    case "flipH":
      return { quarterTurns: q, flipped: !f }
    case "flipV":
      return { quarterTurns: wrapTurns(q + 2), flipped: !f }
  }
}

// Carry a normalized rect stored in display space through one user action,
// so the region it selects keeps framing the same content after the
// orientation changes. Both crop slots are remapped with this whenever
// composeOrientation is applied — that is what makes a flip happen INSIDE
// the crop window (the cropped region stays visible, mirrored) instead of
// swapping it for the content behind it.
// Deliberately not clamped: the maps are range-preserving (a rect inside
// the unit square stays inside it; w/h only swap) and exact on the base36
// lattice, and the only rects that can sit off it (ones pinned to the
// MIN_CROP_FRAC floor by clampCrop) re-encode identically anyway — so
// inverse ops restore the URL byte for byte, and flipping twice or turning
// four times is a no-op. Routing through clampCrop would instead pull rects
// around by MIN_CROP_FRAC for no benefit.
export function orientRect(rect: CropRect, op: OrientationOp): CropRect {
  switch (op) {
    case "flipH":
      return { x: 1 - rect.x - rect.w, y: rect.y, w: rect.w, h: rect.h }
    case "flipV":
      return { x: rect.x, y: 1 - rect.y - rect.h, w: rect.w, h: rect.h }
    case "cw":
      return { x: 1 - rect.y - rect.h, y: rect.x, w: rect.h, h: rect.w }
    case "ccw":
      return { x: rect.y, y: 1 - rect.x - rect.w, w: rect.h, h: rect.w }
  }
}

// Natural dimensions as seen in display space. Feeding these to the
// layout/fit math (which is written entirely in display space) is the
// whole cost of supporting orientation there — no coordinate mapping.
export function orientedSize(
  w: number,
  h: number,
  orientation: PinOrientation | null
): [number, number] {
  return orientation && orientation.quarterTurns % 2 === 1 ? [h, w] : [w, h]
}

function encodeOrient(o: PinOrientation | null): string {
  if (!o || (o.quarterTurns === 0 && !o.flipped)) return ""
  return `O${o.quarterTurns + (o.flipped ? 4 : 0)}`
}

function decodeOrient(s: string | undefined): PinOrientation | null {
  if (!s) return null
  const code = Number(s)
  return { quarterTurns: wrapTurns(code), flipped: code >= 4 }
}

// Everything a pin carries in its h field besides the height. Passed as one
// object rather than positionally: the field has grown five segments so far,
// and each addition otherwise rewrites every call site that only wanted to
// change a single slot.
export interface PinExtras {
  crop: CropRect | null
  autoCrop: CropRect | null
  trim: TrimRange | null
  lock: PinLock
  orient: PinOrientation | null
}

export function packHField(h: number, extras: PinExtras): string {
  const { crop, autoCrop, trim, lock, orient } = extras
  let field = h.toString()
  field += encodeCrop("c", crop)
  field += encodeCrop("a", autoCrop)
  if (!isEmptyTrim(trim)) {
    const start = trim!.start != null ? encodeTime(trim!.start) : ""
    const end = trim!.end != null ? encodeTime(trim!.end) : ""
    field += `t${start}.${end}`
  }
  if (lock) field += `L${lock === "anchor" ? "a" : "s"}`
  field += encodeOrient(orient)
  return field
}

export function parseHField(field: string): { h: number } & PinExtras {
  const h = parseInt(field)
  const match =
    /^\d+(?:c([0-9a-z]{8}))?(?:a([0-9a-z]{8}))?(?:t([0-9a-z]*)\.([0-9a-z]*))?(?:L([aps]))?(?:O([1-7]))?$/.exec(
      field
    )
  if (!match) {
    return {
      h,
      crop: null,
      autoCrop: null,
      trim: null,
      lock: null,
      orient: null,
    }
  }
  const crop = decodeCrop(match[1])
  const autoCrop = decodeCrop(match[2])
  let trim: TrimRange | null = null
  if (match[3] || match[4]) {
    trim = { start: decodeTime(match[3]), end: decodeTime(match[4]) }
  }
  const lock: PinLock = match[5] === "s" ? "size" : match[5] ? "anchor" : null
  return { h, crop, autoCrop, trim, lock, orient: decodeOrient(match[6]) }
}
