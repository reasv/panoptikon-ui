// Assertions for grid hover-to-animate: the animate PREFERENCE
// (lib/state/animatePref.ts), the hover ARMING rule
// (lib/state/animatedPlayback.ts canArmHover), the BADGE predicate and the
// small-cell threshold (lib/thumbnailTier.ts), and the `big` parameter those
// two feed (lib/utils.ts getFileURL). The contract is
// docs/grid-hover-animate-implementation.md §1, decisions D1–D9. No test
// runner in this repo — run it from the ui root:
//
//   node --experimental-strip-types scripts/hoveranimate.test.mjs
//
// Every function asserted here is pure and element-free, which is what lets
// them execute under plain node: the preference module touches localStorage
// and matchMedia only from inside its box functions, and the playback module
// only from inside the director's, so importing either starts nothing. Exits
// non-zero on failure.

import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  DEFAULT_ANIMATE_SETTINGS,
  cellRange,
  defaultAnimateMode,
  parseAnimatePref,
  resolveAnimateMode,
  withAnimateSlot,
} = await import("../lib/state/animatePref.ts")
const { ANIMATED_PLAYBACK, canArmHover } = await import(
  "../lib/state/animatedPlayback.ts"
)
const { SMALL_CELL_THRESHOLD_PX, isSmallCell, showsMotionBadge } = await import(
  "../lib/thumbnailTier.ts"
)
const { getFileURL } = await import("../lib/utils.ts")

const { HOVER_MOVE_WINDOW_MS } = ANIMATED_PLAYBACK

let all = true
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `\n  ${detail}` : ""}`)
  all &&= !!ok
}

const settings = (pref = {}, reduceMotion = false) => ({ pref, reduceMotion })

console.log("\n== the small-cell threshold (D1) ==")
{
  check(
    "the threshold is exclusive: one pixel under is small, exactly at it is not",
    isSmallCell(SMALL_CELL_THRESHOLD_PX - 1) === true
      && isSmallCell(SMALL_CELL_THRESHOLD_PX) === false,
    `${SMALL_CELL_THRESHOLD_PX}`
  )
  // An unmeasured width must not be read as "small": that would apply a
  // small-cell policy — a single video frame, hover-only animation — to a grid
  // nobody has measured yet, on the strength of a zero.
  check(
    "an unmeasured width is not small",
    [0, -10, NaN, Infinity, null, undefined].every((w) => !isSmallCell(w))
  )
  check(
    "the range names follow the same test",
    cellRange(SMALL_CELL_THRESHOLD_PX - 1) === "below"
      && cellRange(SMALL_CELL_THRESHOLD_PX) === "above"
      && cellRange(0) === "above"
  )
}

console.log("\n== preference resolution (D2/D3/D5) ==")
{
  // The shipped default, which is the whole reason the slot is three-state:
  // small cells animate on hover, larger ones as they always have.
  check(
    "with nothing stored, below animates on hover and above always",
    resolveAnimateMode(settings(), "below") === "hover"
      && resolveAnimateMode(settings(), "above") === "always",
    `${resolveAnimateMode(settings(), "below")}/${resolveAnimateMode(settings(), "above")}`
  )
  check(
    "the module's exported default settings resolve the same way",
    resolveAnimateMode(DEFAULT_ANIMATE_SETTINGS, "below") === "hover"
      && resolveAnimateMode(DEFAULT_ANIMATE_SETTINGS, "above") === "always"
  )
}

{
  // Reduced motion moves the DEFAULT of both ranges, and only the default.
  check(
    "reduced motion makes both ranges default to hover",
    defaultAnimateMode("above", true) === "hover"
      && defaultAnimateMode("below", true) === "hover"
      && resolveAnimateMode(settings({}, true), "above") === "hover"
  )
  check(
    "an explicit slot outranks reduced motion",
    resolveAnimateMode(settings({ above: true }, true), "above") === "always",
    resolveAnimateMode(settings({ above: true }, true), "above")
  )
  check(
    "an explicit slot outranks the size default in the other direction too",
    resolveAnimateMode(settings({ below: true }), "below") === "always"
      && resolveAnimateMode(settings({ above: false }), "above") === "hover"
  )
}

{
  // The three states have to stay three: `false` is a decision, and reading it
  // as "unset" is what would let reduced motion silently overrule the user.
  const stored = settings({ below: false }, true)
  check(
    "a stored `false` is a decision, not an absence",
    resolveAnimateMode(stored, "below") === "hover"
      && resolveAnimateMode(settings({ below: false }), "below") === "hover"
      && resolveAnimateMode(settings({}), "above") === "always"
  )
}

console.log("\n== per-range writes (D4) ==")
{
  const first = withAnimateSlot({}, "below", true)
  check(
    "a write sets exactly its own range",
    first.below === true && first.above === undefined,
    JSON.stringify(first)
  )
  const second = withAnimateSlot(first, "above", false)
  check(
    "the other range is carried over untouched",
    second.below === true && second.above === false,
    JSON.stringify(second)
  )
  check(
    "the write does not mutate the value it was given",
    first.above === undefined,
    JSON.stringify(first)
  )
  // Crossing the threshold has to land on the OTHER range's answer, which is
  // the whole point of storing them separately.
  check(
    "the two ranges resolve independently after a write to one",
    resolveAnimateMode(settings(second), "below") === "always"
      && resolveAnimateMode(settings(second), "above") === "hover"
  )
}

console.log("\n== stored value parsing ==")
{
  check(
    "a well-formed value round-trips",
    JSON.stringify(parseAnimatePref('{"above":false,"below":true}'))
      === JSON.stringify({ above: false, below: true })
  )
  // Anything unusable reads as "nothing stored" — both ranges on their
  // defaults, which is a correct page rather than a broken one.
  const junk = ["", "null", "[]", "not json", '{"above":"yes"}', '{"other":1}']
  check(
    "anything unusable reads as nothing stored",
    junk.every((raw) => JSON.stringify(parseAnimatePref(raw)) === "{}")
      && JSON.stringify(parseAnimatePref(null)) === "{}"
      && JSON.stringify(parseAnimatePref(undefined)) === "{}",
    junk.map((raw) => JSON.stringify(parseAnimatePref(raw))).join(" ")
  )
  check(
    "a partial value keeps only the half it has",
    JSON.stringify(parseAnimatePref('{"below":true,"above":null}'))
      === JSON.stringify({ below: true })
  )
}

console.log("\n== the hover arming rule (D6) ==")
{
  const now = 10_000
  const arm = (lastRealMoveAt, fastScroll = false) =>
    canArmHover({ now, lastRealMoveAt, fastScroll })
  // The whole defence: Chromium re-dispatches boundary events when content
  // scrolls under a STATIONARY cursor, and a real arrival is always preceded
  // by a real move.
  check(
    "no pointer move ever seen does not arm",
    arm(0) === false && arm(-1) === false
  )
  check(
    "a move inside the window arms; one older than it does not",
    arm(now) === true
      && arm(now - HOVER_MOVE_WINDOW_MS) === true
      && arm(now - HOVER_MOVE_WINDOW_MS - 1) === false,
    `${HOVER_MOVE_WINDOW_MS}ms`
  )
  check(
    "a fast scroll refuses to arm however fresh the move",
    arm(now, true) === false && arm(now - 1, true) === false
  )
  // A timestamp in the future cannot happen, and treating it as "moved 0 ms
  // ago" would arm on exactly the events the window exists to refuse.
  check("a future move timestamp does not arm", arm(now + 1) === false)
}

console.log("\n== the badge predicate matrix (D8) ==")
{
  const floor = { maxFileSize: 1_000_000, maxSide: 512 }
  const gif = (over) => ({
    type: "image/gif",
    duration: 2,
    size: over ? 4_000_000 : 100,
    width: 100,
    height: 100,
  })
  const video = { type: "video/mp4", duration: 30 }
  const still = { type: "image/jpeg", duration: null }
  const audio = { type: "audio/mpeg", duration: 90 }

  check(
    "a video still always carries the badge",
    showsMotionBadge(video, floor, "always") === true
      && showsMotionBadge(video, floor, "hover") === true
  )
  check(
    "a loop carries it in hover mode and not in always mode",
    showsMotionBadge(gif(true), floor, "hover") === true
      && showsMotionBadge(gif(true), floor, "always") === false
  )
  // Below the floor the endpoint serves the item's own file, which animates in
  // the <img>: the picture is already moving, so there is nothing to announce.
  check(
    "a below-floor animation carries none, in either mode",
    showsMotionBadge(gif(false), floor, "hover") === false
      && showsMotionBadge(gif(false), floor, "always") === false
  )
  check("a still picture carries none", showsMotionBadge(still, floor, "hover") === false)
  // The measured-span fallback, which is what keeps audio's badge working.
  check(
    "a non-picture with a measured span still carries one",
    showsMotionBadge(audio, floor, "always") === true
  )
  // With no floor on record nothing is above it, so every animation is on the
  // "serves its own file" path and none of them are announced. Same answer an
  // older Server and an in-flight client-config produce.
  check(
    "with no floor known, an animation carries no badge",
    showsMotionBadge(gif(true), null, "hover") === false
  )
}

console.log("\n== the video thumbnail choice (D9) ==")
{
  const dbs = { index_db: null, user_data_db: null }
  const base = getFileURL(dbs, "thumbnail", "sha256", "abc", "grid-s")
  const small = getFileURL(dbs, "thumbnail", "sha256", "abc", "grid-s", false, false)
  // Only `false` is ever spelled out, so every existing call site produces the
  // URL it always did — byte for byte, hence the same cache entry.
  check(
    "omitting big, and passing true, are today's URL exactly",
    base === getFileURL(dbs, "thumbnail", "sha256", "abc", "grid-s", false, true)
      && base === getFileURL(dbs, "thumbnail", "sha256", "abc", "grid-s", false, undefined)
      && !base.includes("big"),
    base
  )
  check(
    "a small cell asks for the single frame",
    small === `${base}&big=false`,
    small
  )
  // The two flags are independent parameters and both have to survive.
  const both = getFileURL(dbs, "thumbnail", "sha256", "abc", "grid-m", true, false)
  check(
    "still and big compose",
    both.includes("&still=true") && both.includes("&big=false")
      && both.includes("&size=grid-m"),
    both
  )
}

console.log(all ? "\nALL PASS" : "\nFAILURES")
process.exit(all ? 0 : 1)
