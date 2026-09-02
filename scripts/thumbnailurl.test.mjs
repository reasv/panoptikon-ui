// Every assertion about the strings the UI asks the thumbnail endpoint for
// (lib/thumbnailURL.ts), in ONE place. They used to be split between
// scripts/gridcells.test.mjs and scripts/hoveranimate.test.mjs, which is how
// "the display revision goes on display requests" and "the two flags compose"
// ended up as two half-overlapping tables neither file could see the other's.
//
// The contracts are docs/thumbnail-format-implementation.md §5 (the display
// revision, and what `still=true` answers at each size) and
// docs/grid-scroll-performance-implementation.md §2 (the tier ladder).
//
// No test runner in this repo — run it from the ui root:
//
//   node --experimental-strip-types scripts/thumbnailurl.test.mjs
//
// lib/thumbnailURL.ts imports nothing but lib/thumbnailTier.ts, which is pure,
// which is what lets this execute the real builders rather than a copy of them.

import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  originalFileURL,
  thumbnailMediaURL,
  thumbnailPictureURL,
  thumbnailStillURL,
} = await import("../lib/thumbnailURL.ts")

let all = true
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `\n  ${detail}` : ""}`)
  all &&= !!ok
  return ok
}

const dbs = { index_db: "stdtest", user_data_db: null }
const noDbs = { index_db: null, user_data_db: null }

// The server's display-loop bounds, as /api/client-config publishes them
// (docs/thumbnail-format-implementation.md §5). ONE fixture for the whole file.
const TRIGGER = { maxBytes: 5 * 1024 * 1024, maxShortSide: 4096, maxPixels: 24_000_000 }

/** A row the picture rule can be asked about. */
const row = (over) => ({
  sha256: "abc",
  type: "image/gif",
  duration: 2,
  size: over ? TRIGGER.maxBytes + 1 : 1024,
  width: 400,
  height: 300,
})
const STATIC_ROW = {
  sha256: "abc", type: "image/jpeg", duration: null,
  size: 1024, width: 400, height: 300,
}
const VIDEO_ROW = {
  sha256: "abc", type: "video/mp4", duration: 30,
  size: 40 * 1024 * 1024, width: 1920, height: 1080,
}

console.log("\n== the serializer's shape ==")
{
  check("the bare thumbnail URL is id, id_type, index_db and the revision",
    thumbnailMediaURL(dbs, "abc")
      === "/api/items/item/thumbnail?id=abc&id_type=sha256&index_db=stdtest&r=2",
    thumbnailMediaURL(dbs, "abc"))
  check("a tier appends size=",
    thumbnailMediaURL(dbs, "abc", "grid-s")
      === "/api/items/item/thumbnail?id=abc&id_type=sha256&index_db=stdtest&size=grid-s")
  check("grid-xs is a plain tier like the others",
    thumbnailMediaURL(dbs, "abc", "grid-xs")
      === "/api/items/item/thumbnail?id=abc&id_type=sha256&index_db=stdtest&size=grid-xs")
  check("no index_db still produces a well-formed URL",
    thumbnailMediaURL(noDbs, "abc", "grid-m")
      === "/api/items/item/thumbnail?id=abc&id_type=sha256&size=grid-m")
  check("still=true appends after the tier",
    thumbnailStillURL(dbs, "abc", "grid-m")
      === "/api/items/item/thumbnail?id=abc&id_type=sha256&index_db=stdtest&size=grid-m&still=true")
  check("the original file has no tier, no flags and no revision",
    originalFileURL(dbs, "abc")
      === "/api/items/item/file?id=abc&id_type=sha256&index_db=stdtest",
    originalFileURL(dbs, "abc"))
  // Spelling `display` out is a DIFFERENT URL from the bare one, and one caller
  // needs that: a grid card whose own rendition is a grid tier has to name the
  // display tier to swap to it. No CONTAIN surface spells it any more — the
  // peek layer, the gallery large view and the similarity header all send the
  // bare URL for every item whatever its aspect, so the three share one cache
  // entry per picture. (They used to name it for extreme-aspect items to
  // dislodge a pre-tier cache entry; `r=2` does that for every display request.)
  check("an explicit display is a different URL from the bare one",
    thumbnailMediaURL(dbs, "abc", "display") !== thumbnailMediaURL(dbs, "abc"))
}

console.log("\n== the video thumbnail choice (D9) ==")
{
  const base = thumbnailMediaURL(noDbs, "abc", "grid-s")
  const small = thumbnailPictureURL(noDbs, VIDEO_ROW, TRIGGER, "grid-s", false)
  // Only `false` is ever spelled out, so every existing call site produces the
  // URL it always did — byte for byte, hence the same cache entry.
  check("omitting big, and passing true, are today's URL exactly",
    base === thumbnailPictureURL(noDbs, VIDEO_ROW, TRIGGER, "grid-s", true)
      && base === thumbnailPictureURL(noDbs, VIDEO_ROW, TRIGGER, "grid-s")
      && !base.includes("big"),
    base)
  check("a small cell asks for the single frame",
    small === `${base}&big=false`, small)
  // The two flags are independent parameters and both have to survive.
  const both = thumbnailStillURL(dbs, "abc", "grid-m", false)
  check("still and big compose",
    both.includes("&still=true") && both.includes("&big=false")
      && both.includes("&size=grid-m"),
    both)
}

console.log("\n== the picture rule (R3) ==")
{
  // AT A GRID TIER the question is only "does this item move": above the raw
  // floor such an item answers `video/mp4`, and below it the flag is a
  // documented no-op, so one test covers both without a floor to consult.
  check("a grid tier carries still=true for an animated item",
    thumbnailPictureURL(dbs, row(false), TRIGGER, "grid-m")
      === thumbnailStillURL(dbs, "abc", "grid-m"))
  check("a grid tier carries no flag for a static item",
    thumbnailPictureURL(dbs, STATIC_ROW, TRIGGER, "grid-m")
      === thumbnailMediaURL(dbs, "abc", "grid-m"))
  check("a video is not an animated PICTURE, at any tier",
    thumbnailPictureURL(dbs, VIDEO_ROW, TRIGGER, "grid-s")
      === thumbnailMediaURL(dbs, "abc", "grid-s")
      && thumbnailPictureURL(dbs, VIDEO_ROW, TRIGGER)
        === thumbnailMediaURL(dbs, "abc"))
  // AT THE DISPLAY SIZE the question is the TRIGGER's, and the difference is
  // not cosmetic: `still=true` there answers an above-floor animated item with
  // the stored <=1024 poster rather than with its own file, so a surface that
  // set it speculatively would downgrade every small animation it painted.
  check("the display size carries still=true past the trigger",
    thumbnailPictureURL(dbs, row(true), TRIGGER) === thumbnailStillURL(dbs, "abc"))
  check("the display size is the BARE url under the trigger",
    thumbnailPictureURL(dbs, row(false), TRIGGER) === thumbnailMediaURL(dbs, "abc"))
  // THE CACHE-SHARING INVARIANT, as a string equality: the peek layer, the
  // gallery large view and the similarity header all build their picture this
  // way, so for one item they emit one URL between them — which is what
  // PreviewSurface's aspect store depends on.
  check("every contain surface's URL for one item is one string",
    thumbnailPictureURL(dbs, row(false), TRIGGER)
      === thumbnailPictureURL(dbs, { ...row(false), width: 800, height: 20000 }, TRIGGER),
    thumbnailPictureURL(dbs, row(false), TRIGGER))
  // A null trigger is an older Server, a policy with the feature off, or the
  // config still in flight: the display size is then always a picture, which is
  // what it was before display loops existed.
  check("no trigger means the display size is always an image",
    thumbnailPictureURL(dbs, row(true), null) === thumbnailMediaURL(dbs, "abc")
      && thumbnailPictureURL(dbs, row(true), undefined) === thumbnailMediaURL(dbs, "abc"))
}

console.log("\n== the display revision (§5) ==")
{
  const carries = (u) => /[?&]r=2(&|$)/.test(u)
  // WHERE IT GOES: the display rendition, whether asked for by name or by
  // omission — those are the two spellings of the one request whose bytes this
  // release changes.
  check("the bare thumbnail URL carries it",
    carries(thumbnailMediaURL(dbs, "abc")), thumbnailMediaURL(dbs, "abc"))
  check("an explicit display carries it",
    carries(thumbnailMediaURL(dbs, "abc", "display")))
  check("a display poster (still=true) carries it too",
    carries(thumbnailStillURL(dbs, "abc", "display"))
      && carries(thumbnailStillURL(dbs, "abc")))
  check("a display request for a video's single frame carries it",
    carries(thumbnailPictureURL(dbs, VIDEO_ROW, TRIGGER, undefined, false)))
  // WHERE IT MUST NOT GO, and this is the assertion the whole parameter turns
  // on: a grid tier's bytes are versioned inside its own ETag
  // (TIER_PROCESS_VERSION), so it needs no revision — and adding one would
  // move every grid URL in the app, costing a cold cache in the one surface
  // most sensitive to one. Byte-identical to the pre-revision build.
  for (const tier of ["grid-m", "grid-s", "grid-xs"]) {
    check(`${tier} URLs are byte-identical to before the revision existed`,
      !carries(thumbnailMediaURL(dbs, "abc", tier))
        && !carries(thumbnailStillURL(dbs, "abc", tier))
        && !carries(thumbnailStillURL(dbs, "abc", tier, false)),
      thumbnailStillURL(dbs, "abc", tier, false))
  }
  // `file` serves the bytes on disk, which no release of this app changes.
  check("the original-file URL never carries it",
    !carries(originalFileURL(dbs, "abc")), originalFileURL(dbs, "abc"))
  // One value, one place. A call site that could pass its own would let two
  // surfaces disagree about the URL for the same item and stop sharing a
  // cache entry, which is exactly what PreviewSurface's note depends on.
  check("the revision is not a parameter any call site can vary",
    thumbnailMediaURL(dbs, "abc") === thumbnailMediaURL(dbs, "abc", undefined))
}

console.log(all ? "\nALL PASS" : "\nFAILURES")
process.exit(all ? 0 : 1)
