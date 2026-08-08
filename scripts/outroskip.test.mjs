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

const { effectiveVideoTrim, outroCutPoint, outroSkipGoverns } = await import(
  "../lib/videoTrim.ts"
)
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
check("a cut point just past zero is eligible", outroCutPoint(250) === 0.1)

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

// Degenerate-range guard: a start at or past the cut suppresses the default
// (a composed start >= end would hit useVideoTrim's freeze branch)
for (const [label, start] of [
  ["exactly at the cut", 30],
  ["past the cut", 40],
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
check(
  "a start one centisecond before the cut still gets the default",
  shape(effectiveVideoTrim({ start: 29.99, end: null }, CUT, true)) ===
    shape({ start: 29.99, end: 30 })
)

// The invariant behind the guard, swept: composition alone never produces
// start >= end (§10)
for (const start of [null, 0, 0.01, 5, 29.99, 30, 30.01, 60]) {
  const composed = effectiveVideoTrim({ start, end: null }, CUT, true)
  const s = composed?.start ?? null
  const e = composed?.end ?? null
  check(
    `composed range is never degenerate (start=${start})`,
    e == null || s == null || s < e,
    shape(composed)
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
