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
  WEB_VERSION_LABEL,
  clipProgressText,
  clipRequestFor,
  clipRowLabel,
  clipRows,
  clipStoreKey,
  clipWindowSeconds,
  isClipBusy,
  raceDeadline,
  webVersionRow,
} = await import("../lib/videoClip.ts")
const { FREEZE_EPS } = await import("../lib/videoTrim.ts")
const { PLAYBACK_PRESET, transcodeKey } = await import("../lib/videoTranscode.ts")

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
// A start of ZERO is byte-identical to no start bound at all — ffmpeg is
// handed no `-ss` either way — but the server hashes the request as it
// arrives, so sending one would split the artifact cache: the same clip asked
// for by a player parked at the origin and by one that never had a start bound
// would encode twice and never hit each other's entry.
check(
  "a zero start bound is elided, so it cannot split the cache",
  shape(clipRequestFor({ start: 0, end: 5 }, { start: 0, end: 5 }, false)) ===
    shape({ end_cs: 500 }),
  shape(clipRequestFor({ start: 0, end: 5 }, { start: 0, end: 5 }, false))
)
check(
  "...and in the outro branch too, which is the other spelling of the same clip",
  shape(clipRequestFor({ start: 0, end: null }, { start: 0, end: 7.94 }, true)) ===
    shape({ cut: "outro" }),
  shape(clipRequestFor({ start: 0, end: null }, { start: 0, end: 7.94 }, true))
)
check(
  "the two spellings therefore name ONE store key",
  clipStoreKey(
    "ab".repeat(32),
    "clip",
    clipRequestFor({ start: 0, end: 5 }, { start: 0, end: 5 }, false)
  ) ===
    clipStoreKey(
      "ab".repeat(32),
      "clip",
      clipRequestFor(null, { start: null, end: 5 }, false)
    )
)
// ...and once the zero is gone there is nothing left to ask for: a start-only
// trim at the origin is the whole file, and an empty request object would read
// as `trimmed` to every caller and label a re-encode a clip.
check(
  "a start bound of zero with no end is not a trim at all",
  clipRequestFor({ start: 0, end: null }, { start: 0, end: null }, false) === null
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

const CLIP = { id: "clip", label: "Clip (quality)", channel: "quality", container: "mp4" }
const CLIP_FAST = { id: "clip-fast", label: "Clip (fast)", channel: "fast", container: "mp4" }
const WEBP = { id: "webp-anim", label: "Animated WebP", channel: "fast", container: "webp" }
const AVIF = { id: "avif-anim", label: "Animated AVIF", channel: "fast", container: "avif" }
const CUSTOM = {
  id: "my-profile",
  label: "Instagram 1080",
  channel: "quality",
  container: "mp4",
}
const LIMITS = { max_animated_image_seconds: 30 }
const rowIds = (rows) => rows.map((row) => row.preset.id)

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
// The animated-image row ships too, and carries the SAME trimmed/whole-file
// signal as the others — it used to fall through to the server's untouched
// label, the one row in the menu that never said which of the two it was.
check(
  "the animated-image rows are labelled by their container, with the same signal",
  clipRowLabel(WEBP, true) === "Animated WebP (trimmed)" &&
    clipRowLabel(WEBP, false) === "Animated WebP" &&
    clipRowLabel(AVIF, true) === "Animated AVIF (trimmed)" &&
    clipRowLabel(AVIF, false) === "Animated AVIF",
  `${clipRowLabel(WEBP, true)} / ${clipRowLabel(AVIF, true)}`
)
check(
  "clipRows preserves the server's order and pairs each label with its preset",
  shape(
    clipRows([CLIP, CLIP_FAST], {
      request: { start_cs: 150, end_cs: 825 },
      duration: 60,
      limits: LIMITS,
    }).map((row) => [row.preset.id, row.label])
  ) ===
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
  clipRows([], { request: null, duration: 10, limits: LIMITS }).length === 0 &&
    clipRows([], { request: { end_cs: 500 }, duration: 10, limits: LIMITS }).length === 0
)

// ---- the animated-image length cap --------------------------------------
//
// The server refuses a webp encode longer than `max_animated_image_seconds`
// (api/video.rs `validate_animated_duration`), and refuses an UNBOUNDED one on
// an item whose duration it never recorded. Both halves are mirrored here as a
// hidden row rather than as a disabled one — and only the webp row is touched,
// since a long mp4 is exactly what a whole-file re-encode is for.

const ALL = [CLIP, CLIP_FAST, WEBP, AVIF]
check(
  "the window is the trim when there is one, the item's duration when there is not",
  clipWindowSeconds({ start_cs: 100, end_cs: 600 }, 600) === 5 &&
    clipWindowSeconds(null, 45) === 45 &&
    clipWindowSeconds({ start_cs: 1000 }, 45) === 35,
  `${clipWindowSeconds({ start_cs: 100, end_cs: 600 }, 600)} / ${clipWindowSeconds(null, 45)}`
)
check(
  "an unknown duration with no end bound is an unknown window",
  clipWindowSeconds(null, null) === null &&
    clipWindowSeconds({ start_cs: 500 }, undefined) === null &&
    clipWindowSeconds({ end_cs: 500 }, null) === 5
)
check(
  "a trim inside the cap offers every row",
  shape(
    rowIds(clipRows(ALL, { request: { end_cs: 500 }, duration: 600, limits: LIMITS }))
  ) === shape(["clip", "clip-fast", "webp-anim", "avif-anim"])
)
check(
  "a trim past it drops both animated rows and keeps the video ones",
  shape(
    rowIds(clipRows(ALL, {
      request: { start_cs: 0, end_cs: 3500 },
      duration: 600,
      limits: LIMITS,
    }))
  ) === shape(["clip", "clip-fast"]),
  shape(rowIds(clipRows(ALL, {
    request: { start_cs: 0, end_cs: 3500 },
    duration: 600,
    limits: LIMITS,
  })))
)
check(
  "the cap is inclusive at its edge, like the server's own comparison",
  rowIds(clipRows(ALL, { request: { end_cs: 3000 }, duration: 600, limits: LIMITS }))
    .includes("webp-anim") &&
    rowIds(clipRows(ALL, { request: { end_cs: 3000 }, duration: 600, limits: LIMITS }))
      .includes("avif-anim")
)
check(
  "an untrimmed export measures the ITEM: short offers it, long does not",
  rowIds(clipRows(ALL, { request: null, duration: 12, limits: LIMITS }))
    .includes("webp-anim") &&
    !rowIds(clipRows(ALL, { request: null, duration: 600, limits: LIMITS }))
      .includes("webp-anim")
)
// The two ways the window can be unknowable, both of which the server answers
// with a 422 rather than an encode: no recorded duration and no end bound, and
// a limits envelope that has not landed.
check(
  "an unknown window hides the animated row rather than offering a 422",
  !rowIds(clipRows(ALL, { request: null, duration: null, limits: LIMITS }))
    .includes("webp-anim") &&
    !rowIds(clipRows(ALL, { request: { start_cs: 200 }, duration: undefined, limits: LIMITS }))
      .includes("webp-anim")
)
check(
  "and so does a table that arrived without its limits",
  shape(rowIds(clipRows(ALL, { request: { end_cs: 500 }, duration: 12, limits: null }))) ===
    shape(["clip", "clip-fast"])
)
// `cut: "outro"` has no end bound to measure, so the window falls back to the
// item's duration — an UPPER bound, since the server's cut is earlier. It may
// hide a row that would have been accepted; it never offers one that would not.
check(
  "an outro cut is measured against the item, conservatively",
  rowIds(clipRows(ALL, { request: { cut: "outro" }, duration: 12, limits: LIMITS }))
    .includes("webp-anim") &&
    !rowIds(clipRows(ALL, { request: { cut: "outro" }, duration: 600, limits: LIMITS }))
      .includes("webp-anim")
)
// A user-declared webp profile is capped exactly like the shipped one — the
// rule is the container's, not the id's — while keeping its own label.
const CUSTOM_WEBP = {
  id: "my-gif",
  label: "Loop for chat",
  channel: "fast",
  container: "webp",
}
check(
  "a custom animated profile is capped too, and keeps its name",
  shape(
    clipRows([CUSTOM_WEBP], { request: null, duration: 12, limits: LIMITS }).map(
      (row) => row.label
    )
  ) === shape(["Loop for chat"]) &&
    clipRows([CUSTOM_WEBP], { request: null, duration: 600, limits: LIMITS }).length === 0
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

// ---- the web-version row -------------------------------------------------
//
// The already-encoded playable rendition of a needs-transcode item, offered
// as a download. Its entire gate is "the playback store says done": that
// state is only ever written by the playback path, and playback jobs are only
// started for needs-transcode items — so no playability input is needed, and
// a playable item can never grow the row.

const playbackPreset = { id: PLAYBACK_PRESET, label: "Playback", channel: "fast", container: "mp4" }
const otherPreset = { id: "my-playback", label: "My playback", channel: "fast", container: "mp4" }
const doneState = { state: "done", artifactUrl: "/api/video/artifact?key=x", filename: "a.mp4" }

check(
  "a done playback job with the preset exposed yields the row",
  (() => {
    const row = webVersionRow([playbackPreset], doneState)
    return row !== null && row.preset === playbackPreset && row.label === WEB_VERSION_LABEL
  })()
)
check(
  "the label names a file, not work",
  WEB_VERSION_LABEL === "Web version"
)
// Every non-done state hides the row: nothing exists to be "already there".
for (const state of [
  { state: "idle" },
  { state: "requesting" },
  { state: "queued", position: 2 },
  { state: "running", progress: 0.5 },
  { state: "failed", error: "no", sticky: true },
  { state: "failed", error: "no", sticky: false },
]) {
  check(
    `no row while the playback job is ${state.state}${"sticky" in state ? ` (sticky=${state.sticky})` : ""}`,
    webVersionRow([playbackPreset], state) === null
  )
}
// The preset must be the PLAYBACK preset by id — the one the playback path
// actually encoded with — not merely any preset tagged for the playback
// surface. A policy that withholds it hides the row (hide, never disable).
check(
  "no row when the policy withholds the playback preset",
  webVersionRow([], doneState) === null &&
    webVersionRow([otherPreset], doneState) === null
)
check(
  "the row finds the playback preset among others by id",
  webVersionRow([otherPreset, playbackPreset], doneState)?.preset === playbackPreset
)

// ---- the wait's deadline ------------------------------------------------
//
// `exportClip` waits on the job store through a promise. Without a deadline
// that promise never settles when the stream connects and then says nothing (a
// job the pool lost, a relay that buffers text/event-stream) — and the per-item
// busy guard sits in the `finally` behind it, so the item would refuse every
// later export for the life of the tab. The race is the pure half of the fix.

check(
  "a wait that never settles loses to its deadline",
  (await raceDeadline(new Promise(() => {}), 5, () => "deadline")) === "deadline"
)
check(
  "work that lands first wins, and the deadline value is never produced",
  (await raceDeadline(
    Promise.resolve("done"),
    50,
    () => {
      throw new Error("the deadline callback ran on a settled wait")
    }
  )) === "done"
)
// The timer is cleared on BOTH outcomes: a ten-minute setTimeout left armed
// after a fast encode holds the loop (and this process) open for the rest of
// it. A pending handle would keep node alive well past the assertions below.
const cleared = await Promise.all([
  raceDeadline(Promise.resolve(1), 10 * 60 * 1000, () => 2),
  raceDeadline(new Promise((resolve) => setTimeout(() => resolve(1), 1)), 60_000, () => 2),
])
check(
  "and a settled race leaves no timer holding the process open",
  shape(cleared) === shape([1, 1]),
  shape(cleared)
)

process.exit(all ? 0 : 1)
