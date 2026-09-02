// Assertions for the DISPLAY LOOP predicate (lib/thumbnailTier.ts
// exceedsDisplayLoopTrigger) and the client-config normalisation that feeds it
// (lib/clientConfig.ts). The contract is
// docs/thumbnail-format-implementation.md R2/R3: an animated item past any of
// three bounds — source bytes, short side, total pixels — is answered at the
// `display` size with an H.264 loop instead of a picture, so the gallery's
// large view has to mount a <video> for exactly those items and an <img> for
// everything else.
//
// This is the whole reason the bounds are published rather than duplicated: a
// client that guesses puts a <video> where image bytes are, or an <img> where
// `video/mp4` is, and both are a broken picture in the biggest surface in the
// app. No test runner in this repo — run it from the ui root:
//
//   node --experimental-strip-types scripts/displayloop.test.mjs
//
// Exits non-zero on failure.

import { createChecker } from "./harness.mjs"
import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const { exceedsDisplayLoopTrigger } = await import("../lib/thumbnailTier.ts")
// deriveClientConfig is what turns the wire shape into the one above. It
// imports only a .d.ts (type-only) and lib/thumbnailTier.ts, so it runs here.
const { deriveClientConfig } = await import("../lib/clientConfig.ts")

const { check, finish } = createChecker()

// The plan's own numbers: 5 MiB for the animated class, the 4096 short side
// today's code already uses as the display trigger, and 24 MP.
const TRIGGER = {
  maxBytes: 5 * 1048576,
  maxShortSide: 4096,
  maxPixels: 24000000,
}
const gif = (over) => ({ type: "image/gif", duration: 4, ...over })

console.log("\n== the three bounds (R2) ==")
{
  const over = (item) => exceedsDisplayLoopTrigger(item, TRIGGER)
  // A perfectly ordinary GIF: small in every dimension the trigger measures.
  check("a small animated GIF is a picture",
    !over(gif({ size: 540046, width: 800, height: 600 })))
  // ANY of the three fires it, independently.
  check("bytes alone fire it",
    over(gif({ size: 30 * 1048576, width: 800, height: 600 })))
  check("the short side alone fires it",
    over(gif({ size: 1000, width: 4097, height: 9000 }))
      && over(gif({ size: 1000, width: 9000, height: 4097 })))
  check("total pixels alone fire it",
    over(gif({ size: 1000, width: 6000, height: 4001 })))
  // Every bound is a STRICT `>`, and the pixel one deliberately so: a 6000x4000
  // camera frame is exactly 24,000,000 and stays a picture (§2, "decimal MP
  // with `>`").
  check("exactly at each bound is still a picture",
    !over(gif({ size: TRIGGER.maxBytes, width: 4096, height: 4096 }))
      && !over(gif({ size: 1000, width: 6000, height: 4000 })))
  check("one byte, one pixel and one row over each fire it",
    over(gif({ size: TRIGGER.maxBytes + 1, width: 10, height: 10 }))
      && over(gif({ size: 1000, width: 4097, height: 4097 }))
      && over(gif({ size: 1000, width: 6000, height: 4001 })))
  // The short side is the SMALLER of the two, in either orientation — a
  // webtoon strip is enormous on one axis and tiny on the other, and it is the
  // small axis that decides.
  check("a tall strip is measured on its short side, not its long one",
    !over(gif({ size: 1000, width: 800, height: 20000 })))
}

console.log("\n== only animated items (R3) ==")
{
  const over = (item) => exceedsDisplayLoopTrigger(item, TRIGGER)
  // A huge STILL image is a display rendition, never a loop, however far past
  // the bounds it is. The animated test is the same transcription the grid
  // uses (isAnimatedItem), so the two sides cannot answer differently.
  check("a huge PNG is not a loop",
    !over({ type: "image/png", size: 40 * 1048576, width: 9000, height: 9000 }))
  check("a huge JPEG is not a loop",
    !over({ type: "image/jpeg", size: 40 * 1048576, width: 9000, height: 9000 }))
  check("a video item is not an animated PICTURE",
    !over({ type: "video/mp4", duration: 600, size: 9e8, width: 3840, height: 2160 }))
  // The GIF/other-container split isAnimatedItem draws: an unmeasured GIF is
  // animated (and the endpoint treats it the same way), an unmeasured WebP is
  // not.
  check("an unmeasured huge GIF is a loop",
    over({ type: "image/gif", size: 30 * 1048576, width: 800, height: 600 }))
  check("an unmeasured huge WebP is not",
    !over({ type: "image/webp", size: 30 * 1048576, width: 800, height: 600 }))
  check("a measured huge WebP is",
    over({ type: "image/webp", duration: 2, size: 30 * 1048576, width: 800, height: 600 }))
  check("a GIF measured as STILL is never a loop",
    !over({ type: "image/gif", duration: 0, size: 30 * 1048576, width: 800, height: 600 }))
  check("a missing or empty type is never a loop",
    !over({ type: null, size: 30 * 1048576 })
      && !over({ type: undefined, size: 30 * 1048576 })
      && !over({ type: "", size: 30 * 1048576 }))
}

console.log("\n== incomplete rows and no trigger ==")
{
  const over = (item) => exceedsDisplayLoopTrigger(item, TRIGGER)
  // No trigger reported — an older Server, the feature off, or the config
  // still in flight — means "the display size is always an image", which is
  // today's element for every item.
  check("no trigger means nothing is ever a loop",
    !exceedsDisplayLoopTrigger(gif({ size: 9e9, width: 9999, height: 9999 }), null)
      && !exceedsDisplayLoopTrigger(gif({ size: 9e9 }), undefined))
  // The size half settles on its own: past maxBytes nothing else matters.
  check("past the byte bound, missing dimensions still answer loop",
    over(gif({ size: 30 * 1048576 })))
  // ...and the genuinely unsettleable row answers the CONSERVATIVE way, which
  // is an <img> — today's element, and a correct picture whenever the server
  // agrees. The reverse guess would be a broken <video>.
  check("within the byte bound and with no dimensions, it is a picture",
    !over(gif({ size: 1000 }))
      && !over(gif({ size: 1000, width: 800 }))
      && !over(gif({ size: 1000, height: 600 })))
  check("no size and in-bound dimensions is a picture",
    !over(gif({ width: 800, height: 600 })))
  // THE RESIDUAL, asserted so it stays visible: no size on record and in-bound
  // dimensions, for a file that is in fact over the byte bound. This answers
  // "picture" and the endpoint answers `video/mp4`. Nothing on this side can
  // tell — which is why the gallery's video branch ALSO carries a one-way
  // onError fallback to the <img>, covering this and the keep-the-original
  // sentinel (an over-bound item whose H.264 encode came out no smaller than
  // its source, served its own bytes forever) in the same handler.
  check("the no-size residual answers picture — hence the onError fallback",
    !over(gif({ width: 100, height: 100 })))
  check("non-finite fields never fire a bound",
    !over(gif({ size: NaN, width: 100, height: 100 }))
      && !over(gif({ size: 1000, width: NaN, height: 100 }))
      && !over(gif({ size: 1000, width: 100, height: Infinity })))
  check("zero or negative dimensions are treated as unknown",
    !over(gif({ size: 1000, width: 0, height: 0 }))
      && !over(gif({ size: 1000, width: -9999, height: -9999 })))
}

console.log("\n== the wire shape (/api/client-config) ==")
{
  const base = {
    capabilities: {},
    client: {},
    policy: "default",
    animated_floor: { max_file_size: 1048576, max_side: 512 },
  }
  const trigger = (extra) =>
    deriveClientConfig({ ...base, ...extra }).displayLoopTrigger
  check("the three numbers are carried through verbatim",
    JSON.stringify(trigger({
      display_loop_trigger: {
        max_bytes: 5242880, max_short_side: 4096, max_pixels: 24000000,
      },
    })) === JSON.stringify(TRIGGER))
  // A Server that predates the field, and an explicit null: both mean "no
  // display loops exist here".
  check("an absent or null trigger is null",
    trigger({}) === null && trigger({ display_loop_trigger: null }) === null)
  // ALL THREE OR NOTHING. The trigger is an OR of three bounds, so a missing
  // one is not a bound that never fires — it is a bound the server IS applying
  // and this client cannot see, and half-applying it would put an <img> in
  // front of `video/mp4`.
  check("a partial trigger is refused whole",
    trigger({ display_loop_trigger: { max_bytes: 5242880 } }) === null
      && trigger({
        display_loop_trigger: { max_bytes: 5242880, max_short_side: 4096 },
      }) === null)
  check("non-numeric or negative values are refused whole",
    trigger({
      display_loop_trigger: {
        max_bytes: "5242880", max_short_side: 4096, max_pixels: 24000000,
      },
    }) === null
      && trigger({
        display_loop_trigger: {
          max_bytes: 5242880, max_short_side: -1, max_pixels: 24000000,
        },
      }) === null
      && trigger({
        display_loop_trigger: {
          max_bytes: 5242880, max_short_side: 4096, max_pixels: Infinity,
        },
      }) === null)
  // Zero is a legal bound, and a meaningful one: it means "every animated item
  // of any size is a loop" on that axis.
  check("zero is a legal bound, not a missing one",
    JSON.stringify(trigger({
      display_loop_trigger: { max_bytes: 0, max_short_side: 0, max_pixels: 0 },
    })) === JSON.stringify({ maxBytes: 0, maxShortSide: 0, maxPixels: 0 }))
  // The existing floor must survive alongside it — the two are independent
  // facts about what the scan wrote, and one is not the other.
  check("the animated floor is untouched by the new field",
    JSON.stringify(deriveClientConfig(base).animatedFloor)
      === JSON.stringify({ maxFileSize: 1048576, maxSide: 512 }))
}

finish()
