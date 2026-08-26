// The gallery's playback-trim slot: the `vt` URL param.
//
// The pinboard hangs a trim on the pin record's h field; the gallery has no
// record, so the trim of the video being watched lives in one sha-keyed URL
// slot: "<sha256 10-char prefix>~<start>.<end>", where the bounds are the
// h-field codec verbatim — base36 centiseconds, either side empty when that
// bound is unset (see pinboardCrop.ts). Both sides empty is not a value:
// an empty trim is the absent param.
//
// WIRE FORMAT: the grammar and the centisecond unit are frozen exactly like
// the h field's, for the same reason — shared links carry it.
//
// The sha prefix is the identity of the video the trim belongs to, not a
// scope to clear on navigation: a param whose prefix doesn't match the item
// on screen is INERT, and comes back to life when that video does. The
// prefix length is the pinboard record's (PinButton.tsx `prefixLength`), so
// the two identities compare directly.

// Type-only imports are spelled out: node's --experimental-strip-types
// (how scripts/trimparam.test.mjs exercises this module) cannot erase a
// type hiding in a value import list.
import type { PinExtras, TrimRange } from "./pinboardCrop"
import {
  decodeTime,
  encodeTime,
  isEmptyTrim,
  packHField,
} from "./pinboardCrop"

export const TRIM_SHA_PREFIX_LENGTH = 10

export interface GalleryTrimSlot {
  sha10: string | null
  trim: TrimRange | null
}

// Times stay strictly lowercase base36 like the h field's, so the two
// codecs can never disagree about what a value means; the sha prefix is
// strictly lowercase hex for the same reason — item sha256s are lowercase,
// and an uppercase prefix that parsed but compared case-sensitively would
// be well-formed yet permanently inert, the worst of both.
const VT_PATTERN = /^([0-9a-f]{10})~([0-9a-z]*)\.([0-9a-z]*)$/

// The param value for a trim on `sha256`, or null to clear the slot: an
// empty trim has no representation (both bounds unset is the absent param).
export function encodeGalleryTrim(
  sha256: string,
  trim: TrimRange | null
): string | null {
  if (isEmptyTrim(trim)) return null
  const sha10 = sha256.slice(0, TRIM_SHA_PREFIX_LENGTH)
  // A prefix parseGalleryTrim would reject (short input, non-hex) must not
  // be written: it would put junk in the URL and silently drop the trim.
  if (!/^[0-9a-f]{10}$/.test(sha10)) return null
  const start = trim!.start != null ? encodeTime(trim!.start) : ""
  const end = trim!.end != null ? encodeTime(trim!.end) : ""
  return `${sha10}~${start}.${end}`
}

// Anything that isn't a well-formed slot parses to null rather than
// throwing — the param is user-editable and survives across items.
export function parseGalleryTrim(value: string | null): GalleryTrimSlot | null {
  if (!value) return null
  const match = VT_PATTERN.exec(value)
  if (!match) return null
  if (!match[2] && !match[3]) return null
  return {
    sha10: match[1],
    trim: { start: decodeTime(match[2]), end: decodeTime(match[3]) },
  }
}

// The slot's trim if it belongs to this item, else null (the slot is inert
// for every other video).
export function trimForSha(
  slot: GalleryTrimSlot | null,
  sha256: string
): TrimRange | null {
  if (!slot?.sha10) return null
  return slot.sha10 === sha256.slice(0, TRIM_SHA_PREFIX_LENGTH)
    ? slot.trim
    : null
}

// The h field a NEWLY created pin record gets: the plain height, plus the
// gallery's trim baked in when the slot belongs to the item being pinned
// (the one-directional bridge in docs/video-player-ui-design.md — a
// snapshot; later gallery edits never reach the pin). Without a matching
// trim the field is the bare integer it has always been, byte for byte.
export function newPinHField(
  h: number,
  sha256: string,
  slot: GalleryTrimSlot | null
): string {
  const trim = trimForSha(slot, sha256)
  if (isEmptyTrim(trim)) return h.toString()
  const extras: PinExtras = {
    crop: null,
    autoCrop: null,
    trim,
    lock: null,
    orient: null,
    audio: null,
  }
  return packHField(h, extras)
}
