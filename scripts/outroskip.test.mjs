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

const { FREEZE_EPS, effectiveVideoTrim, outroCutPoint, outroSkipGoverns } =
  await import("../lib/videoTrim.ts")
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

// ---- cut point: END-anchored path ------------------------------------

// The card is appended at the END, and the browser's timeline disagrees
// with ffprobe's about where zero is (edit lists, audio priming). The
// card's LENGTH is origin-free, so the cut is measured back from the
// browser's own end:
//   card = serverDuration − contentEnd ; cut = browserDuration − card − guard
//
// The field case that motivated this (validated on a real TikTok): the cut
// landed at 11.14 s while the card actually began at 11.40 s — 260 ms early,
// of which 150 ms was the old guard and 110 ms the timeline shift.
const FIELD = outroCutPoint(11290, 12.29, 12.4) // card 1.0 s, +110 ms shift
check("field case cuts 60 ms before the real boundary", FIELD === 11.34, String(FIELD))
check(
  "the end anchor is what moved it — the fallback is 110 ms further off",
  FIELD !== outroCutPoint(11290) &&
    Math.abs(FIELD - outroCutPoint(11290) - 0.11) < 1e-9,
  `${FIELD} vs ${outroCutPoint(11290)}`
)
check(
  "the card length comes from the SERVER duration, not the browser one",
  outroCutPoint(11290, 12.29, 12.4) !== outroCutPoint(11290, 12.4, 12.4)
)
check(
  "with the two timelines agreeing, the anchor degenerates to the fallback",
  outroCutPoint(11400, 12.4, 12.4) === outroCutPoint(11400),
  `${outroCutPoint(11400, 12.4, 12.4)} vs ${outroCutPoint(11400)}`
)
check(
  "a longer browser timeline pushes the cut out by the same amount",
  outroCutPoint(11400, 12.4, 12.55) === 11.49,
  String(outroCutPoint(11400, 12.4, 12.55))
)
check(
  "a shorter browser timeline pulls it in by the same amount",
  outroCutPoint(11400, 12.4, 12.3) === 11.24,
  String(outroCutPoint(11400, 12.4, 12.3))
)
const ANCH = outroCutPoint(11005, 12, 12.4) // card 0.995 -> 11.345
check(
  "the anchored cut is on the centisecond lattice too",
  Math.abs(ANCH * 100 - Math.round(ANCH * 100)) < 1e-9 && ANCH === 11.35,
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
// The over-long-card direction needs no guard of its own — the cut lands at
// or below −guard and the freeze-band floor rejects it. These pin the
// OUTCOME (ineligible), whichever predicate delivers it.
check(
  "a card as long as the whole browser timeline is ineligible",
  outroCutPoint(1000, 30, 29) === null,
  String(outroCutPoint(1000, 30, 29))
)
check(
  "a card longer than the whole browser timeline is ineligible",
  outroCutPoint(1000, 30, 5) === null,
  String(outroCutPoint(1000, 30, 5))
)

// The freeze-band floor governs the anchored path identically — including
// where only the anchoring puts the cut in the band (browser 0.9 s against a
// server 1.0 s, so the anchored cut sits 100 ms below the fallback's)
check(
  "an anchored cut inside the freeze band is ineligible",
  outroCutPoint(180, 1, 0.9) === null,
  String(outroCutPoint(180, 1, 0.9))
)
check(
  "an anchored cut one centisecond past the band is eligible",
  outroCutPoint(190, 1, 0.9) === 0.03,
  String(outroCutPoint(190, 1, 0.9))
)
check(
  "…and the fallback would have cleared the band there, so the floor is the anchor's",
  outroCutPoint(180) === 0.12,
  String(outroCutPoint(180))
)

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
