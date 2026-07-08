// Crop and playback-trim state for pinboard items.
//
// A crop is a rectangle over the source image in normalized coordinates:
// x/y is the top-left corner, w/h the size, all as fractions of the source
// image dimensions. The full image is {x: 0, y: 0, w: 1, h: 1}.
//
// A trim is a playback range for videos: loop playback restricted to
// [start, end] seconds, either bound optional, start === end meaning a
// freeze frame. Times are absolute seconds (not duration fractions, whose
// precision would degrade with video length) stored as base36 centiseconds.
//
// Serialization piggybacks on the existing pinboard layout query param,
// which is a flat array of 5-string records [sha256, x, y, w, h]. Both are
// appended to the `h` slot: "c" + 8 chars for the crop, then "t<start>.<end>"
// for the trim (either side empty when unset), e.g. "12c00zzzz00t5k.8a".
// parseInt() reads the leading digits and ignores the suffix, so old
// clients see the correct height and simply drop the suffixes, while new
// clients reading old URLs get no suffix and default to the full image.

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

export function packHField(
  h: number,
  crop: CropRect | null,
  trim: TrimRange | null = null
): string {
  let field = h.toString()
  if (crop && !isFullCrop(crop)) {
    const c = clampCrop(crop)
    field += `c${encodeFrac(c.x)}${encodeFrac(c.y)}${encodeFrac(c.w)}${encodeFrac(c.h)}`
  }
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
  trim: TrimRange | null
} {
  const h = parseInt(field)
  const match = /^\d+(?:c([0-9a-z]{8}))?(?:t([0-9a-z]*)\.([0-9a-z]*))?$/.exec(
    field
  )
  if (!match) {
    return { h, crop: null, trim: null }
  }
  let crop: CropRect | null = null
  if (match[1]) {
    const s = match[1]
    const parsed = clampCrop({
      x: decodeFrac(s.slice(0, 2)),
      y: decodeFrac(s.slice(2, 4)),
      w: decodeFrac(s.slice(4, 6)),
      h: decodeFrac(s.slice(6, 8)),
    })
    crop = isFullCrop(parsed) ? null : parsed
  }
  let trim: TrimRange | null = null
  if (match[2] || match[3]) {
    trim = { start: decodeTime(match[2]), end: decodeTime(match[3]) }
  }
  return { h, crop, trim }
}
