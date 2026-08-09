// Assertions for the outro-skip composition in lib/videoTrim.ts — the §1
// table of docs/video-outro-skip-design.md. No test runner in this repo —
// run it directly from the ui root:
//
//   node --experimental-strip-types scripts/outroskip.test.mjs
//
// (the flag is what lets a .mjs import the .ts module; Node 22+). Exits
// non-zero on the first failing assertion set.

// videoTrim imports its sibling extensionless, which node's resolver
// rejects; ts-hooks fills that in. register() has to run before the modules
// load, hence the dynamic imports.
import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  FREEZE_EPS,
  effectiveVideoTrim,
  outroCutPoint,
  outroProbeEligible,
  outroSkipGoverns,
} = await import("../lib/videoTrim.ts")
const { isEmptyTrim } = await import("../lib/pinboardCrop.ts")

let all = true
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `\n  ${detail}` : ""}`)
  all &&= !!ok
  return ok
}
const shape = (trim) => JSON.stringify(trim && { start: trim.start, end: trim.end })

// ---- cut point: fallback path (no durations known) --------------------

// With either duration missing the cut is START-anchored, the original
// formula: content_end_ms − 60 ms guard, in seconds, rounded to
// centiseconds (the trim codec's storage resolution, so a seeded user bound
// lands on the lattice). This is what plays before `loadedmetadata`.
check("cut point applies the 60 ms guard", outroCutPoint(10060) === 10)
check(
  "the guard is 60 ms, not the old 150",
  outroCutPoint(10150) === 10.09,
  String(outroCutPoint(10150))
)
check(
  "cut point rounds to centiseconds (up)",
  outroCutPoint(12345) === 12.29,
  String(outroCutPoint(12345))
)
check(
  "cut point rounds to centiseconds (down)",
  outroCutPoint(12344) === 12.28,
  String(outroCutPoint(12344))
)
check(
  "cut point is exactly on the centisecond lattice",
  Number.isInteger(Math.round(outroCutPoint(9007) * 100)) &&
    outroCutPoint(9007) === 8.95,
  String(outroCutPoint(9007))
)

check("no content_end_ms is ineligible", outroCutPoint(null) === null)
check("undefined content_end_ms is ineligible", outroCutPoint(undefined) === null)
check("cut point at zero is ineligible", outroCutPoint(60) === null)
check("negative cut point is ineligible", outroCutPoint(10) === null)

// The eligibility floor is the FREEZE band, not zero: {start: null, end:
// 0.02} is useVideoTrim's freeze branch, so an item whose content_end_ms
// lands there would show frame 1 and pause with no user trim in sight.
check("FREEZE_EPS is the exported contract", FREEZE_EPS === 0.02)
check(
  "a cut point inside the freeze band is ineligible",
  outroCutPoint(80) === null,
  String(outroCutPoint(80))
)
check(
  "a cut point exactly one centisecond past the band is eligible",
  outroCutPoint(90) === 0.03,
  String(outroCutPoint(90))
)
check(
  "an eligible cut point never composes a freeze range on its own",
  effectiveVideoTrim(null, outroCutPoint(90), true).end - 0 > FREEZE_EPS
)
check(
  "a raw sub-band cut point is refused by the composition too",
  effectiveVideoTrim(null, 0.02, true) === null,
  shape(effectiveVideoTrim(null, 0.02, true))
)
check("a cut point well past the band is eligible", outroCutPoint(160) === 0.1)

// Every way of not knowing both durations must still produce the fallback,
// never null: the button and the skip exist from the first frame, and only
// REFINE when metadata lands.
const FB = outroCutPoint(11290) // 11.29 s content end -> 11.23
check("bare call falls back", FB === 11.23, String(FB))
for (const [label, server, browser] of [
  ["browser duration NaN (no metadata yet)", 12.29, NaN],
  ["browser duration null", 12.29, null],
  ["browser duration undefined", 12.29, undefined],
  ["browser duration zero", 12.29, 0],
  ["browser duration Infinite (stream)", 12.29, Infinity],
  ["server duration null (item has none)", null, 12.4],
  ["server duration undefined", undefined, 12.4],
  ["server duration NaN", NaN, 12.4],
  // Zero and negative are as unknown as absent: a stored duration of 0
  // must select the fallback, not compute a negative card and vanish
  ["server duration zero", 0, 12.4],
  ["server duration negative", -3, 12.4],
  ["neither duration", null, NaN],
]) {
  // The literal, not FB: comparing against another call through the same
  // branch would pass even if that branch returned null for everything
  check(
    `falls back with ${label}`,
    outroCutPoint(11290, server, browser) === 11.23,
    String(outroCutPoint(11290, server, browser))
  )
}

// ---- cut point: anchored (midpoint) path ------------------------------

// The browser's timeline disagrees with ffprobe's in BOTH directions, and
// two field rounds on one file bracketed the real boundary: the pure
// start-anchored cut measured 0.11-0.14 s EARLY (origin shift: edit lists /
// audio priming), the pure end-anchored cut 0.11-0.14 s LATE (tail padding:
// the audio track outlives the video). Nothing in the metadata apportions
// the discrepancy, so the cut splits it:
//   delta = browserDuration − serverDuration ; cut = contentEnd + delta/2 − guard
//
// Field file: contentEnd 11.29, delta +0.25, real transition ~11.40-11.43.
// The midpoint puts the boundary estimate at 11.415, the cut at 11.355 —
// inside the guard's margin, no card flash.
const FIELD = outroCutPoint(11290, 13.29, 13.54) // card 2.0 s, delta +0.25
check(
  // The ideal value 11.355 sits exactly between two centisecond lattice
  // points, so rounding may land on either neighbour
  "field case lands 45-75 ms before the observed 11.40-11.43 transition",
  FIELD === 11.35 || FIELD === 11.36,
  String(FIELD)
)
check(
  "the midpoint sits strictly between the two pure anchors",
  FIELD > outroCutPoint(11290) && FIELD < 11.29 + 0.25 - 0.06,
  `${outroCutPoint(11290)} < ${FIELD} < ${11.29 + 0.25 - 0.06}`
)
check(
  "with the two timelines agreeing, the anchor degenerates to the fallback",
  outroCutPoint(11400, 12.4, 12.4) === outroCutPoint(11400),
  `${outroCutPoint(11400, 12.4, 12.4)} vs ${outroCutPoint(11400)}`
)
check(
  "a longer browser timeline pushes the cut out by HALF the discrepancy",
  outroCutPoint(11400, 12.4, 12.6) === 11.44,
  String(outroCutPoint(11400, 12.4, 12.6))
)
check(
  "a shorter browser timeline pulls it in by half too",
  outroCutPoint(11400, 12.4, 12.2) === 11.24,
  String(outroCutPoint(11400, 12.4, 12.2))
)
const ANCH = outroCutPoint(11003, 12, 12.3) // delta 0.3 -> 11.003+0.15-0.06
check(
  "the anchored cut is on the centisecond lattice too",
  Math.abs(ANCH * 100 - Math.round(ANCH * 100)) < 1e-9 && ANCH === 11.09,
  String(ANCH)
)

// Sanity guards on the card length. These are not "fall back" cases: the
// two numbers are already known to disagree, and cutting on them would be
// cutting on nonsense.
check(
  "a content end at the file end leaves no card (ineligible)",
  outroCutPoint(12400, 12.4, 12.55) === null,
  String(outroCutPoint(12400, 12.4, 12.55))
)
check(
  "a content end past the file end is ineligible",
  outroCutPoint(13000, 12.4, 12.55) === null,
  String(outroCutPoint(13000, 12.4, 12.55))
)
// A duration disagreement of a second or more is not padding to split but
// two files' worth of metadata: ineligible, not a guess.
check(
  "a full second of duration disagreement is ineligible",
  outroCutPoint(1000, 30, 29) === null,
  String(outroCutPoint(1000, 30, 29))
)
check(
  "wildly disagreeing durations are ineligible",
  outroCutPoint(1000, 30, 5) === null,
  String(outroCutPoint(1000, 30, 5))
)
check(
  "a disagreement just inside the bound still anchors",
  outroCutPoint(11400, 12.4, 13.38) === 11.83,
  String(outroCutPoint(11400, 12.4, 13.38))
)
check(
  "…and exactly at the bound does not",
  outroCutPoint(11400, 12.4, 13.4) === null,
  String(outroCutPoint(11400, 12.4, 13.4))
)

// The freeze-band floor governs the anchored path identically — including
// where only the anchoring puts the cut in the band (browser 0.9 s against a
// server 1.0 s, so the anchored cut sits 100 ms below the fallback's)
check(
  "an anchored cut inside the freeze band is ineligible",
  outroCutPoint(180, 1, 0.78) === null,
  String(outroCutPoint(180, 1, 0.78))
)
check(
  "an anchored cut one centisecond past the band is eligible",
  outroCutPoint(200, 1, 0.78) === 0.03,
  String(outroCutPoint(200, 1, 0.78))
)
check(
  "…and the fallback would have cleared the band there, so the floor is the anchor's",
  outroCutPoint(180) === 0.12,
  String(outroCutPoint(180))
)

// ---- cut point: probe (measured) path ---------------------------------

// The probe measures the video track's TRUE end in the browser's timeline
// (lib/videoEndProbe.ts), which removes the guess entirely:
//   K = serverDuration − contentEnd   (the card length, exact, one timeline)
//   cut = probedVideoEnd − K − guard  (browser seconds)
// Fixture: contentEnd 11.29 s, serverDuration 13.29 s => K = 2.0 s exactly.
// A measured video end of 13.40 puts the card's first frame at 11.40 and the
// cut at 11.34 — no browser duration involved anywhere.
const PROBE = outroCutPoint(11290, 13.29, 13.54, 13.4)
check("probe path: cut = probedEnd − K − guard", PROBE === 11.34, String(PROBE))
check(
  "the probe outranks the midpoint on the same numbers",
  PROBE !== FIELD && (FIELD === 11.35 || FIELD === 11.36),
  `probe ${PROBE} vs midpoint ${FIELD}`
)
check(
  "the probe needs no browser duration at all (pre-metadata)",
  outroCutPoint(11290, 13.29, NaN, 13.4) === 11.34,
  String(outroCutPoint(11290, 13.29, NaN, 13.4))
)
check(
  "the probe ignores an absurd browser duration (no |delta| test on it)",
  outroCutPoint(11290, 13.29, 99, 13.4) === 11.34,
  String(outroCutPoint(11290, 13.29, 99, 13.4))
)
check(
  "the probed cut is on the centisecond lattice (rounds up)",
  outroCutPoint(11290, 13.29, null, 13.4567) === 11.4,
  String(outroCutPoint(11290, 13.29, null, 13.4567))
)
check(
  "…and rounds down",
  outroCutPoint(11290, 13.29, null, 13.4512) === 11.39,
  String(outroCutPoint(11290, 13.29, null, 13.4512))
)

// A nonsense measurement falls THROUGH to the midpoint/fallback — the
// asymmetry against inconsistent durations (which make the item ineligible).
// A browser that measured badly has said nothing about the two durations, so
// a failed measurement must not kill a feature that worked without it.
for (const [label, probed] of [
  ["a measured end shorter than the card", 1.9],
  ["a measured end exactly at the card length", 2],
  ["a zero measurement", 0],
  ["a negative measurement", -1],
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["null (still running / unsupported browser)", null],
  ["undefined (caller passed nothing)", undefined],
]) {
  check(
    `${label} falls through to the midpoint`,
    outroCutPoint(11290, 13.29, 13.54, probed) === FIELD,
    String(outroCutPoint(11290, 13.29, 13.54, probed))
  )
  check(
    `${label} falls through to the fallback with no browser duration`,
    outroCutPoint(11290, 13.29, NaN, probed) === 11.23,
    String(outroCutPoint(11290, 13.29, NaN, probed))
  )
}

// K comes from the server duration, so without a usable one there is no
// probe path at all — a measured end alone cannot say where the card starts.
for (const [label, server] of [
  ["null", null],
  ["undefined", undefined],
  ["NaN", NaN],
  ["zero", 0],
  ["negative", -3],
]) {
  check(
    `a probe with server duration ${label} falls back`,
    outroCutPoint(11290, server, NaN, 13.4) === 11.23,
    String(outroCutPoint(11290, server, NaN, 13.4))
  )
}

// The card sanity guard is the midpoint path's, unchanged: a probe cannot
// rescue an item whose content ends at or past the file end.
check(
  "a probe does not rescue a content end at the file end",
  outroCutPoint(12400, 12.4, 12.55, 13) === null,
  String(outroCutPoint(12400, 12.4, 12.55, 13))
)

// The freeze-band floor governs the probed path identically. K = 0.8 here,
// so a measured end of 0.86 puts the cut at exactly 0.00.
check(
  "a probed cut inside the freeze band is ineligible",
  outroCutPoint(200, 1, null, 0.86) === null,
  String(outroCutPoint(200, 1, null, 0.86))
)
check(
  "a probed cut one centisecond past the band is eligible",
  outroCutPoint(200, 1, null, 0.89) === 0.03,
  String(outroCutPoint(200, 1, null, 0.89))
)

// The hosts' gate on running the probe at all: an outro to refine, and a
// server duration to build K from.
check("probe eligibility: both present", outroProbeEligible(11290, 13.29))
check("probe eligibility: no outro", !outroProbeEligible(null, 13.29))
check("probe eligibility: undefined outro", !outroProbeEligible(undefined, 13.29))
check("probe eligibility: no duration", !outroProbeEligible(11290, null))
check("probe eligibility: undefined duration", !outroProbeEligible(11290, undefined))
check("probe eligibility: zero duration", !outroProbeEligible(11290, 0))
check("probe eligibility: NaN duration", !outroProbeEligible(11290, NaN))

const CUT = outroCutPoint(30060) // 30 s
check("fixture cut point", CUT === 30)

// ---- composition: the §1 table ---------------------------------------

// No user trim: the default is the whole feature
check(
  "no user trim, skip on -> outro end only",
  shape(effectiveVideoTrim(null, CUT, true)) === shape({ start: null, end: 30 }),
  shape(effectiveVideoTrim(null, CUT, true))
)
check(
  "no user trim, skip on -> loop attribute must be off",
  !isEmptyTrim(effectiveVideoTrim(null, CUT, true))
)
check("no user trim, skip on -> governs", outroSkipGoverns(null, CUT, true))

// Toggle off: the default simply is not there, and the native loop returns
check("toggle off -> user trim untouched", effectiveVideoTrim(null, CUT, false) === null)
check(
  "toggle off -> effective trim is empty (native loop)",
  isEmptyTrim(effectiveVideoTrim(null, CUT, false))
)
check("toggle off -> does not govern", !outroSkipGoverns(null, CUT, false))
const startOnly = { start: 5, end: null }
check(
  "toggle off keeps a user start intact",
  effectiveVideoTrim(startOnly, CUT, false) === startOnly
)

// Ineligible item: same as no feature at all
check("ineligible item, skip on -> null", effectiveVideoTrim(null, null, true) === null)
check(
  "ineligible item keeps the user trim identity",
  effectiveVideoTrim(startOnly, null, true) === startOnly
)
check("ineligible item does not govern", !outroSkipGoverns(startOnly, null, true))

// A user END bound wins — including past the cut. No min() composition.
for (const [label, end] of [
  ["past the cut", 45],
  ["before the cut", 12],
  ["exactly at the cut", 30],
  ["at zero", 0],
]) {
  const user = { start: null, end }
  check(
    `user end ${label} overrides the default`,
    effectiveVideoTrim(user, CUT, true) === user,
    shape(effectiveVideoTrim(user, CUT, true))
  )
  check(`user end ${label} does not govern`, !outroSkipGoverns(user, CUT, true))
}
const both = { start: 2, end: 45 }
check(
  "user start + end past the cut is untouched",
  effectiveVideoTrim(both, CUT, true) === both,
  shape(effectiveVideoTrim(both, CUT, true))
)

// A start-only trim still skips the outro: start is orthogonal to the end
// default, and placing a loop start must not resurrect the end card.
check(
  "start-only trim keeps the outro end",
  shape(effectiveVideoTrim(startOnly, CUT, true)) === shape({ start: 5, end: 30 }),
  shape(effectiveVideoTrim(startOnly, CUT, true))
)
check("start-only trim -> the default governs", outroSkipGoverns(startOnly, CUT, true))
check(
  "start-only composition does not mutate the user trim",
  startOnly.end === null
)

// Degenerate-range guard: a start that does not clear the cut by more than
// FREEZE_EPS suppresses the default. The threshold is the freeze band, NOT
// `start >= end`: useVideoTrim freezes (and pauses) at `end - start <=
// FREEZE_EPS`, so a start one centisecond before the cut is degenerate too.
for (const [label, start] of [
  ["exactly at the cut", 30],
  ["past the cut", 40],
  ["one centisecond before the cut", 29.99],
  ["exactly FREEZE_EPS before the cut", 29.98],
]) {
  const user = { start, end: null }
  check(
    `user start ${label} suppresses the default`,
    effectiveVideoTrim(user, CUT, true) === user,
    shape(effectiveVideoTrim(user, CUT, true))
  )
  check(
    `user start ${label} does not govern (no cyan marker)`,
    !outroSkipGoverns(user, CUT, true)
  )
}
// Just outside the band the default is back — the guard suppresses the
// freeze cases and nothing more
check(
  "a start three centiseconds before the cut still gets the default",
  shape(effectiveVideoTrim({ start: 29.97, end: null }, CUT, true)) ===
    shape({ start: 29.97, end: 30 }),
  shape(effectiveVideoTrim({ start: 29.97, end: null }, CUT, true))
)
check(
  "a start three centiseconds before the cut governs (cyan marker shows)",
  outroSkipGoverns({ start: 29.97, end: null }, CUT, true)
)

// The invariant behind the guard, swept: whenever composition applies the
// default, the composed range clears useVideoTrim's freeze band — a range
// that only satisfies `start < end` would still freeze and pause (§10)
for (const start of [null, 0, 0.01, 5, 29.9, 29.97, 29.98, 29.99, 30, 30.01, 60]) {
  const user = { start, end: null }
  const composed = effectiveVideoTrim(user, CUT, true)
  const applied = composed !== user
  const s = composed?.start ?? 0
  const e = composed?.end ?? null
  check(
    `composed range never lands in the freeze band (start=${start})`,
    applied ? e != null && e - s > FREEZE_EPS : e == null,
    `${shape(composed)} applied=${applied}`
  )
}

// ---- clearing (§5) falls out of the composition -----------------------

// "Clear the end bound with skip on" is just the composition run again with
// the bound gone: the default resurfaces and the button relights.
const cleared = { start: 5, end: null }
check(
  "clearing the end resurfaces the outro default",
  shape(effectiveVideoTrim(cleared, CUT, true)) === shape({ start: 5, end: 30 }) &&
    outroSkipGoverns(cleared, CUT, true)
)
check(
  "a full clear leaves the outro end alone",
  shape(effectiveVideoTrim(null, CUT, true)) === shape({ start: null, end: 30 }) &&
    outroSkipGoverns(null, CUT, true)
)

console.log(all ? "\nALL PASS" : "\nFAILURES")
process.exit(all ? 0 : 1)
