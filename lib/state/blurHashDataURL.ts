import { decode } from "blurhash"
import type { PlaceholderSize } from "../thumbnailTier"

/**
 * Decoded placeholders, keyed by hash AND raster size.
 *
 * THE SIZE IS PART OF THE KEY, and that is not defensive — it is required.
 * The raster used to be a pair of module constants, so one hash had exactly
 * one rendering; it is now a per-card rung off the thumbnail tier
 * (`placeholderSizeForTier`, lib/thumbnailTier.ts), so the SAME hash legitimately
 * has an 8x8, a 16x16 and a 32x32 form live in one tab at once — the result
 * grid and the gallery strip sit on the same page at different card sizes.
 * Keyed by hash alone, whichever surface mounted first would silently hand its
 * raster to the other.
 *
 * A blurhash is decoded AND PNG-encoded in pure JS — one `String.fromCharCode`
 * per byte, a hand-rolled deflate-store and a CRC pass — and a grid cell does
 * it on every mount. Scrolling back up a virtualized grid remounts cells that
 * were on screen seconds ago, so without this the same twenty hashes are
 * re-encoded over and over on the warm re-scroll path, which is the direction
 * that measured WORSE than a cold scroll.
 *
 * Insertion-ordered Map as an LRU: a hit re-inserts, and the oldest entry is
 * evicted past the cap. The cap exists because the cache is module-level and
 * lives as long as the tab — a long scrolling session would otherwise keep
 * every data URL it has ever produced alive forever, which is exactly the
 * accumulation this work is trying not to add to.
 *
 * WHY 2048 AND NOT 512. The cap only ever matters on the surface that mounts
 * fastest, and 512 was below ONE SCREENFUL-SECOND there: at the size slider's
 * 140px minimum on a 4K viewport the grid mounts ~330 cells/s across 19
 * columns, so a forward scroll walked 2660 distinct hashes in eight seconds
 * and the hit rate on the path that matters was zero — the cache helped only a
 * short scroll back. 2048 covers ~6 s of that scroll, which is the range a
 * user actually reverses over.
 *
 * The memory that buys is small BECAUSE of the ladder above, and the two
 * decisions are coupled. An entry is ~5.5 KB at 32x32, ~1.5 KB at 16x16 and
 * ~0.5 KB at 8x8 (measured, scripts/blurplaceholder.test.mjs). The rung that
 * can actually fill 2048 slots is `grid-xs`, i.e. 8x8 — about 1 MB full. The
 * 32x32 rung is reached only by big cells and the gallery, where the mount
 * rate is single digits per second and the cache never approaches the cap; a
 * cache full of 32x32 entries would be ~11 MB, and no surface in the app
 * produces one.
 */
const CACHE_LIMIT = 2048
const cache = new Map<string, PlaceholderDataURL>()

/**
 * Narrower than `string` ON PURPOSE. Callers pass this value STRAIGHT into
 * next/image's `placeholder` prop (never as `blurDataURL` alongside
 * `placeholder="blur"` — see the comment in components/SearchResultImage.tsx
 * for why the 'blur' path is banned on churning surfaces), and that prop's type
 * is `'blur' | 'empty' | \`data:image/${string}\``. next/image validates the
 * string at render only in DEV builds — in production an invalid value silently
 * becomes a garbage background — so this template-literal type is the actual
 * guard, not a belt over a runtime check.
 */
export type PlaceholderDataURL = `data:image/png;base64,${string}`

/**
 * `size` is REQUIRED and has no default, deliberately: every call site knows
 * which tier its card is on, and a default would be the 32 this work exists to
 * stop paying at the small ones — silently, in whatever surface forgot. Get it
 * from `placeholderSizeForTier` rather than writing a number.
 */
export function blurHashToDataURL(
  hash: string | undefined,
  size: PlaceholderSize
): PlaceholderDataURL | undefined {
  if (!hash) return undefined
  const key = `${size}:${hash}`
  const hit = cache.get(key)
  if (hit !== undefined) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const pixels = decode(hash, size, size)
  const dataURL = parsePixels(pixels, size, size)
  cache.set(key, dataURL)
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  return dataURL
}

// thanks to https://github.com/wheany/js-png-encoder
function parsePixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): PlaceholderDataURL {
  const pixelsString = [...pixels]
    .map((byte) => String.fromCharCode(byte))
    .join("")
  const pngString = generatePng(width, height, pixelsString)
  const base64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(getPngArray(pngString)).toString("base64")
      : btoa(pngString)
  // Template literal, not `"…" + base64`: string concatenation widens to
  // `string`, which does not satisfy the `data:image/png;base64,${string}`
  // return type this module exists to guarantee.
  return `data:image/png;base64,${base64}`
}

function getPngArray(pngString: string) {
  const pngArray = new Uint8Array(pngString.length)
  for (let i = 0; i < pngString.length; i++) {
    pngArray[i] = pngString.charCodeAt(i)
  }
  return pngArray
}

// The CRC-32 table, built ONCE at module load rather than per call: it is a
// constant (256 entries, 2048 shift/xor steps) and rebuilding it inside
// generatePng made every placeholder pay for it.
const CRC_TABLE: number[] = (() => {
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
})()

const DEFLATE_METHOD = String.fromCharCode(0x78, 0x01)
const SIGNATURE = String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10)
const NO_FILTER = String.fromCharCode(0)

function generatePng(width: number, height: number, rgbaString: string) {
  // Functions
  function inflateStore(data: string) {
    const MAX_STORE_LENGTH = 65535
    let storeBuffer = ""
    let remaining
    let blockType

    for (let i = 0; i < data.length; i += MAX_STORE_LENGTH) {
      remaining = data.length - i
      blockType = ""

      if (remaining <= MAX_STORE_LENGTH) {
        blockType = String.fromCharCode(0x01)
      } else {
        remaining = MAX_STORE_LENGTH
        blockType = String.fromCharCode(0x00)
      }
      // little-endian
      storeBuffer +=
        blockType +
        String.fromCharCode(remaining & 0xff, (remaining & 0xff00) >>> 8)
      storeBuffer += String.fromCharCode(
        ~remaining & 0xff,
        (~remaining & 0xff00) >>> 8
      )

      storeBuffer += data.substring(i, i + remaining)
    }

    return storeBuffer
  }

  function adler32(data: string) {
    let MOD_ADLER = 65521
    let a = 1
    let b = 0

    for (let i = 0; i < data.length; i++) {
      a = (a + data.charCodeAt(i)) % MOD_ADLER
      b = (b + a) % MOD_ADLER
    }

    return (b << 16) | a
  }

  function updateCrc(crc: number, buf: string) {
    let c = crc
    let b: number

    for (let n = 0; n < buf.length; n++) {
      b = buf.charCodeAt(n)
      c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
    }
    return c
  }

  function crc(buf: string) {
    return updateCrc(0xffffffff, buf) ^ 0xffffffff
  }

  function dwordAsString(dword: number) {
    return String.fromCharCode(
      (dword & 0xff000000) >>> 24,
      (dword & 0x00ff0000) >>> 16,
      (dword & 0x0000ff00) >>> 8,
      dword & 0x000000ff
    )
  }

  function createChunk(length: number, type: string, data: string) {
    const CRC = crc(type + data)

    return dwordAsString(length) + type + data + dwordAsString(CRC)
  }

  function createIHDR(width: number, height: number) {
    const IHDRdata =
      dwordAsString(width) +
      dwordAsString(height) +
      // bit depth
      String.fromCharCode(8) +
      // color type: 6=truecolor with alpha
      String.fromCharCode(6) +
      // compression method: 0=deflate, only allowed value
      String.fromCharCode(0) +
      // filtering: 0=adaptive, only allowed value
      String.fromCharCode(0) +
      // interlacing: 0=none
      String.fromCharCode(0)

    return createChunk(13, "IHDR", IHDRdata)
  }

  // PNG creations

  const IEND = createChunk(0, "IEND", "")
  const IHDR = createIHDR(width, height)

  let scanlines = ""
  let scanline

  for (let y = 0; y < rgbaString.length; y += width * 4) {
    scanline = NO_FILTER
    if (Array.isArray(rgbaString)) {
      for (let x = 0; x < width * 4; x++) {
        scanline += String.fromCharCode(rgbaString[y + x] & 0xff)
      }
    } else {
      scanline += rgbaString.substr(y, width * 4)
    }
    scanlines += scanline
  }

  const compressedScanlines =
    DEFLATE_METHOD + inflateStore(scanlines) + dwordAsString(adler32(scanlines))
  const IDAT = createChunk(
    compressedScanlines.length,
    "IDAT",
    compressedScanlines
  )

  const pngString = SIGNATURE + IHDR + IDAT + IEND
  return pngString
}
