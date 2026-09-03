import { decode } from "blurhash"

/**
 * The rung a caller that names no size gets. The tier-aware call sites ask
 * `placeholderForTier` (lib/thumbnailTier.ts) instead; this is what everything
 * else has always had.
 */
const DEFAULT_PLACEHOLDER_EDGE = 32

/**
 * Decoded placeholders, keyed by `edge:hash` — the placeholder edge is now a
 * per-tier choice (`placeholderForTier`), so two surfaces can hold the same
 * hash at two resolutions and the key has to carry both.
 *
 * A blurhash is decoded AND PNG-encoded in pure JS — 4096 `String.fromCharCode`
 * calls, a hand-rolled deflate-store and a CRC pass — and a grid cell does it
 * on every mount. Scrolling back up a virtualized grid remounts cells that
 * were on screen seconds ago, so without this the same twenty hashes are
 * re-encoded over and over on the warm re-scroll path, which is the direction
 * that measured WORSE than a cold scroll.
 *
 * Insertion-ordered Map as an LRU: a hit re-inserts, and the oldest entry is
 * evicted past the cap. The cap exists because the cache is module-level and
 * lives as long as the tab — a long scrolling session would otherwise keep
 * every data URL it has ever produced (~5.5 KB each) alive forever, which is
 * exactly the accumulation this work is trying not to add to.
 */
const CACHE_LIMIT = 512
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

export function blurHashToDataURL(
  hash: string | undefined,
  /**
   * The square edge to decode and encode at, in pixels. A blurhash carries a
   * handful of cosine components, so a bigger raster of it holds no more
   * information — it only costs more to build, quadratically. See
   * `placeholderForTier`.
   */
  edge: number = DEFAULT_PLACEHOLDER_EDGE
): PlaceholderDataURL | undefined {
  if (!hash) return undefined
  const key = `${edge}:${hash}`
  const hit = cache.get(key)
  if (hit !== undefined) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const pixels = decode(hash, edge, edge)
  const dataURL = parsePixels(pixels, edge, edge)
  cache.set(key, dataURL)
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  return dataURL
}

/** blurhash's base83 alphabet, in its canonical order. */
const BASE83 =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~"

/**
 * THE HASH'S AVERAGE COLOUR, as a CSS `rgb()` string — the `"colour"` rung.
 *
 * A blurhash's first two characters are its size flag and quantised maximum;
 * characters 2..6 are the DC term, a base83 24-bit sRGB triple. That triple is
 * the image's average colour and is stored ALREADY sRGB-encoded (the decoder's
 * job is to turn it back into linear light), so it is a CSS colour verbatim —
 * four base83 digits and three masks, no raster, no PNG, no base64.
 *
 * `undefined` for anything that is not a well-formed hash of at least six
 * characters, so a malformed value paints the cell's own background rather
 * than a wrong colour.
 */
export function blurHashAverageColour(
  hash: string | undefined
): string | undefined {
  if (!hash || hash.length < 6) return undefined
  let dc = 0
  for (let i = 2; i < 6; i++) {
    const digit = BASE83.indexOf(hash[i])
    if (digit < 0) return undefined
    dc = dc * 83 + digit
  }
  return `rgb(${dc >> 16},${(dc >> 8) & 255},${dc & 255})`
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
