// The per-DB thumbnail format policy as the settings page reads and writes it
// (lib/thumbnailFormats.ts). The contract is
// docs/thumbnail-format-implementation.md R5, plus the CLAUDE.md rule that a
// setting is retired by a migration and never by a commit-path rejection —
// which is why every function here is TOTAL over whatever the stored value
// turns out to be.
//
// No test runner in this repo — run it from the ui root:
//
//   node --experimental-strip-types scripts/thumbnailformats.test.mjs

import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  THUMBNAIL_FORMATS_DEFAULT,
  THUMBNAIL_FORMAT_OPTIONS,
  effectiveThumbnailFormats,
  isKnownThumbnailFormat,
  mergeThumbnailFormats,
} = await import("../lib/thumbnailFormats.ts")

let all = true
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `\n  ${detail}` : ""}`)
  all &&= !!ok
  return ok
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log("\n== what the control shows as checked ==")
{
  // The DEFAULT stands in for exactly the two cases where the SERVER itself
  // applies the default: the key absent (or not a list) and the list empty.
  check("an absent key shows the default",
    same(effectiveThumbnailFormats(undefined), THUMBNAIL_FORMATS_DEFAULT)
      && same(effectiveThumbnailFormats(null), THUMBNAIL_FORMATS_DEFAULT))
  check("a value that is not a list shows the default",
    same(effectiveThumbnailFormats("jpeg"), THUMBNAIL_FORMATS_DEFAULT)
      && same(effectiveThumbnailFormats(7), THUMBNAIL_FORMATS_DEFAULT)
      && same(effectiveThumbnailFormats({ jpeg: true }), THUMBNAIL_FORMATS_DEFAULT))
  check("an EMPTY list shows the default, because the server reads it that way",
    same(effectiveThumbnailFormats([]), THUMBNAIL_FORMATS_DEFAULT))
  // AND FOR NO OTHER CASE. A list this build cannot draw shows NOTHING
  // checked, which is the truth about what the UI can see; showing the default
  // there would be a claim about the stored value that the very next toggle
  // would make true by overwriting it.
  check("a list of only UNKNOWN formats shows nothing checked",
    same(effectiveThumbnailFormats(["avif"]), []))
  check("a mixed list shows only the known entries",
    same(effectiveThumbnailFormats(["avif", "webp"]), ["webp"]))
  check("junk in the list is not a format",
    same(effectiveThumbnailFormats([null, 3, "jpeg"]), ["jpeg"]))
  check("both known formats round-trip",
    same(effectiveThumbnailFormats(["jpeg", "webp"]), ["jpeg", "webp"])
      && THUMBNAIL_FORMAT_OPTIONS.every((o) => isKnownThumbnailFormat(o.value)))
}

console.log("\n== what a toggle writes ==")
{
  // The settings page round-trips the WHOLE config object on every save, so
  // anything dropped here is deleted from the user's database.
  check("an unknown format is carried through IN ITS STORED POSITION",
    same(mergeThumbnailFormats(["avif", "jpeg", "webp"], ["jpeg"]),
      ["avif", "jpeg"]),
    JSON.stringify(mergeThumbnailFormats(["avif", "jpeg", "webp"], ["jpeg"])))
  check("a newly selected format is appended",
    same(mergeThumbnailFormats(["jpeg"], ["jpeg", "webp"]), ["jpeg", "webp"]))
  check("a deselected known format is dropped",
    same(mergeThumbnailFormats(["jpeg", "webp"], ["webp"]), ["webp"]))
  // ONLY STRINGS SURVIVE, and that is what makes the LENGTH of the result mean
  // something: the caller's "at least one must stay selected" refusal is
  // measured against this list, so a stored `[null]` must not be allowed to
  // count as a format and let both boxes be cleared.
  check("non-strings are dropped rather than written back",
    same(mergeThumbnailFormats([null, 3, "jpeg"], ["jpeg"]), ["jpeg"])
      && same(mergeThumbnailFormats([null], []), []))
  // Clearing the last KNOWN box with an unknown present still leaves a
  // non-empty list — the server has something to apply, and the user has not
  // lost the format this build cannot draw.
  check("clearing the last known box with an unknown present stays non-empty",
    same(mergeThumbnailFormats(["avif", "jpeg"], []), ["avif"]))
  check("clearing everything, with nothing else stored, is empty",
    same(mergeThumbnailFormats(["jpeg", "webp"], []), []))
  // A stored value that is not a list at all is replaced by the selection
  // rather than crashing the save.
  check("a non-list stored value merges into just the selection",
    same(mergeThumbnailFormats(undefined, ["webp"]), ["webp"])
      && same(mergeThumbnailFormats("jpeg", ["webp"]), ["webp"]))
}

console.log(all ? "\nALL PASS" : "\nFAILURES")
process.exit(all ? 0 : 1)
