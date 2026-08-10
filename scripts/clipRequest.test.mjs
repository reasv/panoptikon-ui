// Assertions for the pure half of lib/videoClip.ts: what a clip row asks the
// server for, what it calls itself, which key its job is stored under, and the
// per-item busy guard. Everything the export does that needs a browser (the
// POST, the EventSource, the <a download>) lives in `exportClip`'s shell,
// which is exactly why every DECISION it makes lives in a function that does
// not. Run from the ui root:
//
//   node --experimental-strip-types scripts/clipRequest.test.mjs
//
// The module imports fetchClient and the toast store (values, at module
// scope) — that is why the resolver hook below also maps the "@/" alias.

import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  clipProgressText,
  clipRequestFor,
  clipRowLabel,
  clipRows,
  clipStoreKey,
  isClipBusy,
} = await import("../lib/videoClip.ts")
const { FREEZE_EPS } = await import("../lib/videoTrim.ts")
const { transcodeKey } = await import("../lib/videoTranscode.ts")

let all = true
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `\n  ${detail}` : ""}`)
  all &&= !!ok
  return ok
}
const shape = (value) => JSON.stringify(value)

// ---- clipRequestFor: the six-case table --------------------------------
//
// Three inputs, always from the same host: the USER's trim, the EFFECTIVE
// trim the player enforces (lib/videoTrim's effectiveVideoTrim), and whether
// the outro default is what ends playback (outroSkipGoverns). The second and
// third are derived from the first, so the cases below spell out the
// combinations a real player can actually be in.

// 1. Both bounds placed by hand: the explicit window, in centiseconds.
check(
  "both bounds explicit ride as start_cs + end_cs",
  shape(clipRequestFor({ start: 1.5, end: 8.25 }, { start: 1.5, end: 8.25 }, false)) ===
    shape({ start_cs: 150, end_cs: 825 }),
  shape(clipRequestFor({ start: 1.5, end: 8.25 }, { start: 1.5, end: 8.25 }, false))
)

// 2. An outro-skipping item with no user trim at all. The client's own cut
//    point (7.94 below) is DISCARDED: it lives in the browser's timeline and
//    is corrected for it, while ffmpeg reads the file's. The server re-derives
//    the boundary from the same content_end_ms.
check(
  "the outro cut is NAMED, never sent as the client's own number",
  shape(clipRequestFor(null, { start: null, end: 7.94 }, true)) === shape({ cut: "outro" }),
  shape(clipRequestFor(null, { start: null, end: 7.94 }, true))
)

// 3. ...and it composes with a start bound, which is the one thing the server
//    lets `cut` share a request with.
check(
  "cut=outro composes with a user start bound",
  shape(clipRequestFor({ start: 2, end: null }, { start: 2, end: 7.94 }, true)) ===
    shape({ start_cs: 200, cut: "outro" }),
  shape(clipRequestFor({ start: 2, end: null }, { start: 2, end: 7.94 }, true))
)
check(
  "and never alongside end_cs — the server 422s that pair",
  clipRequestFor({ start: 2, end: null }, { start: 2, end: 7.94 }, true).end_cs === undefined
)

// 4. A user END bound on an outro-ELIGIBLE item. outroSkipGoverns is false the
//    moment trim.end is set, so this falls through to the explicit branch:
//    someone who trimmed into the outro on purpose gets what they asked for.
check(
  "a user end bound stays explicit even on an outro-eligible item",
  shape(clipRequestFor({ start: null, end: 9.5 }, { start: null, end: 9.5 }, false)) ===
    shape({ end_cs: 950 }),
  shape(clipRequestFor({ start: null, end: 9.5 }, { start: null, end: 9.5 }, false))
)

// 5. The freeze band — the same predicate useVideoTrim uses to decide a trim
//    shows one frame and stops. Null, so the caller offers the untrimmed rows
//    instead of a row that would 422.
check(
  "a freeze-frame window is not a clip",
  clipRequestFor({ start: 3, end: 3 }, { start: 3, end: 3 }, false) === null
)
// The band is FREEZE_EPS wide and INCLUSIVE at its edge — measured in
// centiseconds, which is the whole point: `3.02 - 3` is 0.020000000000000018
// in floats, so the seconds-space comparison useVideoTrim runs would let this
// window through and the server would 422 it. The bounds are already on the
// centisecond lattice, so this is exact and matches the server's own test.
check(
  "the band is FREEZE_EPS wide, inclusive at its edge",
  clipRequestFor({ start: 3, end: 3.02 }, { start: 3, end: 3.02 }, false) === null &&
    3.02 - 3 > FREEZE_EPS,
  `float slack: ${3.02 - 3}`
)
check(
  "one centisecond past it IS a clip",
  shape(clipRequestFor({ start: 3, end: 3.03 }, { start: 3, end: 3.03 }, false)) ===
    shape({ start_cs: 300, end_cs: 303 }),
  shape(clipRequestFor({ start: 3, end: 3.03 }, { start: 3, end: 3.03 }, false))
)
check(
  "an end bound alone is measured from zero, so the band applies there too",
  clipRequestFor({ start: null, end: 0.02 }, { start: null, end: 0.02 }, false) === null
)

// 6. Nothing set anywhere.
check(
  "no trim at all is null — the rows become a whole-file re-encode",
  clipRequestFor(null, null, false) === null
)

// A start bound alone is a real trim: everything from there to the end.
check(
  "a start bound alone rides as start_cs with no end",
  shape(clipRequestFor({ start: 4.2, end: null }, { start: 4.2, end: null }, false)) ===
    shape({ start_cs: 420 }),
  shape(clipRequestFor({ start: 4.2, end: null }, { start: 4.2, end: null }, false))
)
// Seconds land on the centisecond lattice by rounding, the same lattice
// trimWithBound and the `vt` codec store on.
check(
  "seconds round to the centisecond lattice",
  shape(clipRequestFor({ start: 0.005, end: 1.004 }, { start: 0.005, end: 1.004 }, false)) ===
    shape({ start_cs: 1, end_cs: 100 }),
  shape(clipRequestFor({ start: 0.005, end: 1.004 }, { start: 0.005, end: 1.004 }, false))
)

// ---- the store key ------------------------------------------------------
//
// The playback store keys on `sha:preset`; a clip's job carries trim bounds,
// which that key cannot express. Two different windows of one item must never
// share a key, and neither namespace may collide with the other.

const SHA = "ab".repeat(32)
check(
  "two windows of one item under one preset are different keys",
  clipStoreKey(SHA, "clip", { start_cs: 100, end_cs: 500 }) !==
    clipStoreKey(SHA, "clip", { start_cs: 200, end_cs: 500 })
)
check(
  "an untrimmed clip is a different key again",
  clipStoreKey(SHA, "clip", null) !== clipStoreKey(SHA, "clip", { start_cs: 100 })
)
check(
  "the outro cut is its own window, not the same as a bare start",
  clipStoreKey(SHA, "clip", { start_cs: 100, cut: "outro" }) !==
    clipStoreKey(SHA, "clip", { start_cs: 100 })
)
check(
  "and the same request always names the same key",
  clipStoreKey(SHA, "clip", { start_cs: 100, end_cs: 500 }) ===
    clipStoreKey(SHA, "clip", { start_cs: 100, end_cs: 500 })
)
check(
  "presets do not share a window's key",
  clipStoreKey(SHA, "clip", null) !== clipStoreKey(SHA, "clip-fast", null)
)
// The collision that would matter most: a clip key must never be a PLAYBACK
// key, or an export would hand the player's element the wrong bytes (or vice
// versa). The third segment is what guarantees it.
check(
  "no clip key can ever equal a playback key",
  [null, { start_cs: 0 }, { cut: "outro" }, { start_cs: 1, end_cs: 2 }].every(
    (request) =>
      clipStoreKey(SHA, "playback", request) !== transcodeKey(SHA, "playback")
  )
)

// ---- row labels ---------------------------------------------------------
//
// Only the two presets that SHIP get a derived label; a user-declared profile
// keeps the name its author gave it.

const CLIP = { id: "clip", label: "Clip (quality)", channel: "quality" }
const CLIP_FAST = { id: "clip-fast", label: "Clip (fast)", channel: "fast" }
const CUSTOM = { id: "my-profile", label: "Instagram 1080", channel: "quality" }

check(
  "a trimmed export says so, per channel",
  clipRowLabel(CLIP, true) === "Clip (trimmed)" &&
    clipRowLabel(CLIP_FAST, true) === "Clip (trimmed, fast)",
  `${clipRowLabel(CLIP, true)} / ${clipRowLabel(CLIP_FAST, true)}`
)
check(
  "with no trim the same rows are a whole-file re-encode",
  clipRowLabel(CLIP, false) === "Re-encode" &&
    clipRowLabel(CLIP_FAST, false) === "Re-encode (fast)",
  `${clipRowLabel(CLIP, false)} / ${clipRowLabel(CLIP_FAST, false)}`
)
check(
  "a custom profile keeps its own label, trimmed or not",
  clipRowLabel(CUSTOM, true) === "Instagram 1080" &&
    clipRowLabel(CUSTOM, false) === "Instagram 1080"
)
check(
  "clipRows preserves the server's order and pairs each label with its preset",
  shape(clipRows([CLIP, CLIP_FAST], true).map((row) => [row.preset.id, row.label])) ===
    shape([
      ["clip", "Clip (trimmed)"],
      ["clip-fast", "Clip (trimmed, fast)"],
    ])
)
// The capability story, end to end: a policy without the transcode capability
// never fetches, and one whose `transcode_presets` list omits the clip presets
// gets an empty table. Both arrive here the same way, and both must produce NO
// rows — hidden, never disabled.
check(
  "no presets means no rows at all (capability off, or a policy that offers none)",
  clipRows([], true).length === 0 && clipRows([], false).length === 0
)

// ---- the busy guard -----------------------------------------------------
//
// Module scope and keyed by the full sha256, for the reason lib/menuGuard.ts
// documents: Radix unmounts a context menu the instant a row is selected, so a
// component-state flag would be destroyed by the very click it guards.

check("an item nothing is exporting is not busy", isClipBusy(SHA) === false)
check(
  "a sha that was never seen is not busy either",
  isClipBusy("ff".repeat(32)) === false
)

// ---- progress text ------------------------------------------------------

check(
  "the queue position only appears when there is someone ahead",
  clipProgressText({ state: "queued", position: 1 }) === "Queued" &&
    clipProgressText({ state: "queued", position: 4 }) === "Queued — #4"
)
check(
  "progress is a percentage when the source has a duration to divide by",
  clipProgressText({ state: "running", progress: 0.421 }) === "Encoding — 42%" &&
    clipProgressText({ state: "running", progress: null }) === "Encoding…"
)
check(
  "and every pre-job state says the same honest thing",
  clipProgressText({ state: "idle" }) === "Contacting the server" &&
    clipProgressText({ state: "requesting" }) === "Contacting the server"
)

process.exit(all ? 0 : 1)
