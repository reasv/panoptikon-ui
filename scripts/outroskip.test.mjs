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

// ---- cut point: guard, rounding, eligibility -------------------------

// content_end_ms − 150 ms, in seconds, rounded to centiseconds (the trim
// codec's storage resolution, so a seeded user bound lands on the lattice)
check("cut point applies the 150 ms guard", outroCutPoint(10150) === 10)
check(
  "cut point rounds to centiseconds (up)",
  outroCutPoint(12345) === 12.2,
  String(outroCutPoint(12345))
)
check(
  "cut point rounds to centiseconds (down)",
  outroCutPoint(12344) === 12.19,
  String(outroCutPoint(12344))
)
check(
  "cut point is exactly on the centisecond lattice",
  Number.isInteger(Math.round(outroCutPoint(9007) * 100)) &&
    outroCutPoint(9007) === 8.86,
  String(outroCutPoint(9007))
)

check("no content_end_ms is ineligible", outroCutPoint(null) === null)
check("undefined content_end_ms is ineligible", outroCutPoint(undefined) === null)
check("cut point at zero is ineligible", outroCutPoint(150) === null)
check("negative cut point is ineligible", outroCutPoint(100) === null)

// The eligibility floor is the FREEZE band, not zero: {start: null, end:
// 0.02} is useVideoTrim's freeze branch, so an item whose content_end_ms
// lands there would show frame 1 and pause with no user trim in sight.
check("FREEZE_EPS is the exported contract", FREEZE_EPS === 0.02)
check(
  "a cut point inside the freeze band is ineligible",
  outroCutPoint(170) === null,
  String(outroCutPoint(170))
)
check(
  "a cut point exactly one centisecond past the band is eligible",
  outroCutPoint(180) === 0.03,
  String(outroCutPoint(180))
)
check(
  "an eligible cut point never composes a freeze range on its own",
  effectiveVideoTrim(null, outroCutPoint(180), true).end - 0 > FREEZE_EPS
)
check(
  "a raw sub-band cut point is refused by the composition too",
  effectiveVideoTrim(null, 0.02, true) === null,
  shape(effectiveVideoTrim(null, 0.02, true))
)
check("a cut point well past the band is eligible", outroCutPoint(250) === 0.1)

const CUT = outroCutPoint(30150) // 30 s
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
