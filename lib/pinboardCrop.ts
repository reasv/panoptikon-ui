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
// Serialization piggybacks on the existing pinboard layout query param,
// which is a flat array of 5-string records [sha256, x, y, w, h]. All are
// appended to the `h` slot: "<h>[c<8>][a<8>][t<start>.<end>]" — "c" + 8
// chars for the manual crop, "a" + 8 chars for the auto crop (same
// encoding), then "t<start>.<end>" for the trim (either side empty when
// unset), e.g. "12c00zzzz00a0899zz0it5k.8a". parseInt() reads the leading
// digits and ignores the suffix, so old clients see the correct height and
// simply drop the suffixes, while new clients reading old URLs get no
// suffix and default to the full image (fields without an `a` segment
// parse with autoCrop: null).

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

// Auto crops within this fraction of the full base are treated as no crop:
// near-fits aren't worth cropping, and dropping them keeps hFields short
export const AUTO_CROP_FULL_THRESHOLD = 0.98

// Fit-to-cell auto crop: the centered window over the base (the
// manual-cropped region) whose aspect matches the cell. Computed from the
// BASE aspect only, so recomputing for the same cell is idempotent — the
// result never feeds back into itself.
export function computeAutoCrop(
  baseAspect: number,
  cellAspect: number
): CropRect | null {
  if (!(baseAspect > 0) || !(cellAspect > 0)) return null
  if (baseAspect > cellAspect) {
    // Base wider than the cell: crop the sides
    const f = cellAspect / baseAspect
    if (f >= AUTO_CROP_FULL_THRESHOLD) return null
    return clampCrop({ x: (1 - f) / 2, y: 0, w: f, h: 1 })
  }
  // Base taller than the cell: crop top and bottom
  const f = baseAspect / cellAspect
  if (f >= AUTO_CROP_FULL_THRESHOLD) return null
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

export function packHField(
  h: number,
  crop: CropRect | null,
  autoCrop: CropRect | null = null,
  trim: TrimRange | null = null
): string {
  let field = h.toString()
  field += encodeCrop("c", crop)
  field += encodeCrop("a", autoCrop)
  if (!isEmptyTrim(trim)) {
    const start = trim!.start != null ? encodeTime(trim!.start) : ""
    const end = trim!.end != null ? encodeTime(trim!.end) : ""
    field += `t${start}.${end}`
  }
  return field
}

export function parseHField(field: string): {
  h: number
  crop: CropRect | null
  autoCrop: CropRect | null
  trim: TrimRange | null
} {
  const h = parseInt(field)
  const match =
    /^\d+(?:c([0-9a-z]{8}))?(?:a([0-9a-z]{8}))?(?:t([0-9a-z]*)\.([0-9a-z]*))?$/.exec(
      field
    )
  if (!match) {
    return { h, crop: null, autoCrop: null, trim: null }
  }
  const crop = decodeCrop(match[1])
  const autoCrop = decodeCrop(match[2])
  let trim: TrimRange | null = null
  if (match[3] || match[4]) {
    trim = { start: decodeTime(match[3]), end: decodeTime(match[4]) }
  }
  return { h, crop, autoCrop, trim }
}
