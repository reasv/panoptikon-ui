// Crop state for pinboard items.
//
// A crop is a rectangle over the source image in normalized coordinates:
// x/y is the top-left corner, w/h the size, all as fractions of the source
// image dimensions. The full image is {x: 0, y: 0, w: 1, h: 1}.
//
// Serialization piggybacks on the existing pinboard layout query param,
// which is a flat array of 5-string records [sha256, x, y, w, h]. The crop
// is appended to the `h` slot after a "c" delimiter, e.g. "12c00zzzz00".
// parseInt() reads the leading digits and ignores the suffix, so old
// clients see the correct height and simply drop the crop, while new
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

export function packHField(h: number, crop: CropRect | null): string {
  if (!crop || isFullCrop(crop)) {
    return h.toString()
  }
  const c = clampCrop(crop)
  return `${h}c${encodeFrac(c.x)}${encodeFrac(c.y)}${encodeFrac(c.w)}${encodeFrac(c.h)}`
}

export function parseHField(field: string): { h: number; crop: CropRect | null } {
  const h = parseInt(field)
  const match = /^\d+c([0-9a-z]{8})$/.exec(field)
  if (!match) {
    return { h, crop: null }
  }
  const s = match[1]
  const crop = clampCrop({
    x: decodeFrac(s.slice(0, 2)),
    y: decodeFrac(s.slice(2, 4)),
    w: decodeFrac(s.slice(4, 6)),
    h: decodeFrac(s.slice(6, 8)),
  })
  return { h, crop: isFullCrop(crop) ? null : crop }
}
