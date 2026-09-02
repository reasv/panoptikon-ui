// Assertions for video hover previews: the three-layer PREFERENCE resolution
// (lib/state/hoverPreviewPref.ts), the RUNG ladder and the request shape
// (lib/videoPreview.ts), the CANCEL rule and the key's trim segment
// (lib/videoTranscode.ts), the client-config normalization
// (lib/clientConfig.ts) and the V12 frame swap as it reaches the plan
// (lib/cellPicture.ts). The contract is
// docs/video-hover-preview-implementation.md §1, decisions V2–V12, and §4's
// unit list. No test runner in this repo — run it from the ui root:
//
//   node --experimental-strip-types scripts/videopreview.test.mjs
//
// Everything asserted here is pure or is a store decision that touches no
// network: the preference module reaches for localStorage only from inside its
// box functions, the playability ladder takes an injected `canPlayType`, and
// the transcode store's cancel path issues a request only for a job it created
// — which nothing here creates. Exits non-zero on failure.

import { createChecker } from "./harness.mjs"
import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  HOVER_PREVIEW_ALL,
  HOVER_PREVIEW_DIRECT,
  HOVER_PREVIEW_OFF,
  HOVER_PREVIEW_PREF_STORAGE_KEY,
  hoverPreviewCapability,
  hoverPreviewChoice,
  parseHoverPreviewPref,
  resolveHoverPreview,
  withHoverPreviewSlot,
} = await import("../lib/state/hoverPreviewPref.ts")
const {
  PREVIEW_MAX_CS,
  PREVIEW_MAX_SECONDS,
  PREVIEW_PRESET,
  cellPreviewRung,
  previewFeedback,
  previewKey,
  previewRequest,
  previewRung,
} = await import("../lib/videoPreview.ts")
const {
  applyJobEvent,
  cancelTranscode,
  createdOwnJob,
  getTranscodeState,
  ownsTranscodeJob,
  setTranscodeState,
  shouldSubmit,
  transcodeKey,
} = await import("../lib/videoTranscode.ts")
const { noteVideoPlaybackError } = await import("../lib/videoPlayability.ts")
const { deriveClientConfig } = await import("../lib/clientConfig.ts")
const { planCellPicture } = await import("../lib/cellPicture.ts")

const { check, finish } = createChecker()

// ---------------------------------------------------------------------------
// V5–V7: the preference resolution matrix
// ---------------------------------------------------------------------------
//
// Three layers, one direction: the SERVER says what is allowed, and the
// browser preference can only ever subtract from it.

console.log("\n== the preference resolution matrix (V5-V7) ==")
{
  const shape = (capability) => `${capability.direct ? "D" : "-"}${capability.transcode ? "T" : "-"}`
  // The three server answers a client can see, against the three states a
  // preference slot can be in. Nine cells, spelled out rather than derived,
  // because the whole point of the rule is that it is not symmetrical.
  const servers = {
    absent: null,
    denied: hoverPreviewCapability(false, false),
    "originals only": hoverPreviewCapability(true, false),
    allowed: hoverPreviewCapability(true, true),
  }
  const prefs = {
    absent: {},
    on: { direct: true, transcode: true },
    "originals": { direct: true, transcode: false },
    off: { direct: false, transcode: false },
  }
  const expected = {
    "absent/absent": "--", "absent/on": "--", "absent/originals": "--", "absent/off": "--",
    "denied/absent": "--", "denied/on": "--", "denied/originals": "--", "denied/off": "--",
    "originals only/absent": "D-", "originals only/on": "D-",
    "originals only/originals": "D-", "originals only/off": "--",
    "allowed/absent": "DT", "allowed/on": "DT",
    "allowed/originals": "D-", "allowed/off": "--",
  }
  let ok = true
  for (const [serverName, server] of Object.entries(servers)) {
    for (const [prefName, pref] of Object.entries(prefs)) {
      const name = `${serverName}/${prefName}`
      const got = shape(resolveHoverPreview(server, pref))
      if (!check(`server ${serverName}, pref ${prefName} -> ${expected[name]}`,
        got === expected[name], got)) {
        ok = false
      }
    }
  }
  check("the whole matrix agrees", ok)
  // The rule the matrix encodes, stated once as its own assertion: a
  // preference can never turn ON what the server denied.
  check(
    "a pref of ON against a denying server is still off",
    resolveHoverPreview(hoverPreviewCapability(false, false),
      { direct: true, transcode: true }) === HOVER_PREVIEW_OFF
  )
  // Identity, not just equality: the resolved answer is a PROP on hundreds of
  // memoized cards, and a fresh object per render would defeat that memo for
  // every visible card on every scroll frame.
  check(
    "the answer is one of four INTERNED constants (memo-stable as a prop)",
    resolveHoverPreview(hoverPreviewCapability(true, true), {}) === HOVER_PREVIEW_ALL
      && resolveHoverPreview(hoverPreviewCapability(true, true),
        { transcode: false }) === HOVER_PREVIEW_DIRECT
      && resolveHoverPreview(null, {}) === HOVER_PREVIEW_OFF
  )
}

console.log("\n== the stored preference (V7) ==")
{
  check(
    "the storage key is the settled one",
    HOVER_PREVIEW_PREF_STORAGE_KEY === "panoptikon.hoverPreviewPref",
    HOVER_PREVIEW_PREF_STORAGE_KEY
  )
  const shape = (value) => JSON.stringify(value)
  check("nothing stored reads as both slots absent",
    shape(parseHoverPreviewPref(null)) === shape({}))
  check("unparseable JSON reads as absent",
    shape(parseHoverPreviewPref("{not json")) === shape({}))
  check("a non-object reads as absent",
    shape(parseHoverPreviewPref("42")) === shape({}))
  check("a hand-edited string slot is dropped, not coerced",
    shape(parseHoverPreviewPref('{"direct":"yes","transcode":false}'))
      === shape({ transcode: false }))
  check("both booleans survive a round trip",
    shape(parseHoverPreviewPref(JSON.stringify({ direct: true, transcode: false })))
      === shape({ direct: true, transcode: false }))
  // The control writes BOTH slots, because the three positions are points on
  // one scale: leaving the other slot standing would make "Originals" mean
  // two different things depending on what came before it.
  check("Off writes both slots false",
    shape(withHoverPreviewSlot({ direct: true, transcode: true }, "off"))
      === shape({ direct: false, transcode: false }))
  check("Originals writes direct on and transcode off",
    shape(withHoverPreviewSlot({}, "originals"))
      === shape({ direct: true, transcode: false }))
  check("All writes both slots true",
    shape(withHoverPreviewSlot({ direct: false, transcode: false }, "all"))
      === shape({ direct: true, transcode: true }))
  // The control lights the EFFECTIVE answer (D4's rule), so a stored "all"
  // against a policy that denies the encode reads "Originals".
  check("the lit segment follows the RESOLVED answer",
    hoverPreviewChoice(HOVER_PREVIEW_OFF) === "off"
      && hoverPreviewChoice(HOVER_PREVIEW_DIRECT) === "originals"
      && hoverPreviewChoice(HOVER_PREVIEW_ALL) === "all")
  check("a stored All against a transcode-denying server lights Originals",
    hoverPreviewChoice(resolveHoverPreview(
      hoverPreviewCapability(true, false),
      withHoverPreviewSlot({}, "all"))) === "originals")
}

// ---------------------------------------------------------------------------
// V2/V3: which rung
// ---------------------------------------------------------------------------

console.log("\n== rung selection (V2/V3) ==")
{
  const all = hoverPreviewCapability(true, true)
  const originals = hoverPreviewCapability(true, false)
  check("a playable item takes rung 0 when direct previews are on",
    previewRung("playable", all) === "direct")
  check("...and nothing when they are off",
    previewRung("playable", hoverPreviewCapability(false, true)) === "none")
  check("a needs-transcode item takes rung 1 when the encode is allowed",
    previewRung("needs-transcode", all) === "transcode")
  check("...and nothing when it is not",
    previewRung("needs-transcode", originals) === "none")
  check("an unsupported item takes no rung at either setting",
    previewRung("unsupported", all) === "none"
      && previewRung("unsupported", originals) === "none")
  check("previews entirely off take no rung whatever the verdict",
    previewRung("playable", HOVER_PREVIEW_OFF) === "none"
      && previewRung("needs-transcode", HOVER_PREVIEW_OFF) === "none")
}

console.log("\n== the cell's whole question (cellPreviewRung) ==")
{
  const all = hoverPreviewCapability(true, true)
  const originals = hoverPreviewCapability(true, false)
  // A browser that plays h264-in-mp4 and nothing else — the shape the ladder's
  // own suite uses, injected so this runs with no DOM.
  const chrome = (type) =>
    /^video\/mp4; codecs="avc1|^video\/mp4; codecs="mp4a/.test(type)
      ? "probably"
      : ""
  const mp4 = { sha256: "aaa", type: "video/mp4", video_codec: "h264", audio_codec: "aac" }
  const hevc = { sha256: "bbb", type: "video/mp4", video_codec: "hevc", audio_codec: "aac" }
  const image = { sha256: "ccc", type: "image/png" }
  check("an h264 mp4 this browser plays is rung 0",
    cellPreviewRung(mp4, all, chrome) === "direct")
  check("an HEVC mp4 it cannot decode is rung 1",
    cellPreviewRung(hevc, all, chrome) === "transcode")
  check("...and is NOTHING when the encode is denied (the ladder collapses it)",
    cellPreviewRung(hevc, originals, chrome) === "none")
  check("a still image is never a preview, whatever is allowed",
    cellPreviewRung(image, all, chrome) === "none")
  check("a null row is never a preview",
    cellPreviewRung(null, all, chrome) === "none")
  // THE SHORT CIRCUIT: with previews off the ladder is not consulted at all,
  // which is what keeps a grid of stills from probing a codec per card. Proven
  // by a probe that throws if it is called.
  const explodes = () => { throw new Error("the probe must not run") }
  check("previews off short-circuit BEFORE the codec probe",
    cellPreviewRung(mp4, HOVER_PREVIEW_OFF, explodes) === "none")
  check("a non-video short-circuits before the probe too",
    cellPreviewRung(image, all, explodes) === "none")
  // THE DOWNGRADE (V3): an item whose element failed to decode in the gallery
  // is needs-transcode here from the next render on, with no subscription.
  noteVideoPlaybackError(mp4.sha256)
  check("a session-downgraded playable item moves to rung 1",
    cellPreviewRung(mp4, all, chrome) === "transcode")
  check("...and to nothing when the encode is denied",
    cellPreviewRung(mp4, originals, chrome) === "none")
}

// ---------------------------------------------------------------------------
// V3/V4: the request and its key
// ---------------------------------------------------------------------------

console.log("\n== the preview request (V3) ==")
{
  const shape = (value) => JSON.stringify(value)
  check("the cap is 16 s, spelled in both units",
    PREVIEW_MAX_SECONDS === 16 && PREVIEW_MAX_CS === 1600,
    `${PREVIEW_MAX_SECONDS}s / ${PREVIEW_MAX_CS}cs`)
  check("a file longer than the cap carries end_cs",
    shape(previewRequest({ duration: 16.01 }))
      === shape({ preset: PREVIEW_PRESET, end_cs: PREVIEW_MAX_CS }))
  check("a file exactly at the cap does NOT (the whole file is one key)",
    shape(previewRequest({ duration: 16 })) === shape({ preset: PREVIEW_PRESET }))
  check("a short file does not either",
    shape(previewRequest({ duration: 3 })) === shape({ preset: PREVIEW_PRESET }))
  // Not "> 16" by the letter, and deliberately: an unknown duration is the one
  // case where omitting the bound could hand ffmpeg a two-hour film.
  check("an UNKNOWN duration sends the bound rather than the whole file",
    shape(previewRequest({ duration: null }))
      === shape({ preset: PREVIEW_PRESET, end_cs: PREVIEW_MAX_CS })
      && shape(previewRequest({}))
        === shape({ preset: PREVIEW_PRESET, end_cs: PREVIEW_MAX_CS }))
  check("a zero or negative duration is unknown, not short",
    shape(previewRequest({ duration: 0 }))
      === shape({ preset: PREVIEW_PRESET, end_cs: PREVIEW_MAX_CS }))
  // The key carries the bound, so a trimmed encode and a whole-file one at the
  // same preset can never be served for each other.
  check("the key carries end_cs when the request does",
    previewKey("sha", previewRequest({ duration: 60 })) === "sha:preview:e1600",
    previewKey("sha", previewRequest({ duration: 60 })))
  check("...and does not when it does not",
    previewKey("sha", previewRequest({ duration: 5 })) === "sha:preview")
  check("an untrimmed key is byte-identical to the two-segment form every "
    + "other caller mints",
    transcodeKey("sha", "playback") === "sha:playback"
      && transcodeKey("sha", "playback", null) === "sha:playback"
      && transcodeKey("sha", "playback", 1600) === "sha:playback:e1600")
}

// ---------------------------------------------------------------------------
// V4: cancel only what this client created
// ---------------------------------------------------------------------------

console.log("\n== cancel-only-if-created (V4) ==")
{
  check("a CREATED outcome is this client's job", createdOwnJob({ outcome: "created" }))
  check("a JOINED one is somebody else's",
    createdOwnJob({ outcome: "joined" }) === false)
  check("a cache HIT has no job at all",
    createdOwnJob({ outcome: "hit" }) === false)
  check("a known_failure is not ours to cancel",
    createdOwnJob({ outcome: "known_failure" }) === false)
  check("an unreadable payload is never ours (the safe direction)",
    createdOwnJob(null) === false
      && createdOwnJob({}) === false
      && createdOwnJob({ outcome: 7 }) === false)
  const key = transcodeKey("zzz", PREVIEW_PRESET, PREVIEW_MAX_CS)
  check("a key with no submit behind it owns no job",
    ownsTranscodeJob(key) === false)
  // A cell that leaves mid-queue: the state goes back to idle so the next
  // dwell means what it says.
  setTranscodeState(key, { state: "queued", position: 3 })
  cancelTranscode(key)
  check("cancelling returns the key to idle",
    getTranscodeState(key).state === "idle")
  check("...so a re-hover may submit again", shouldSubmit(getTranscodeState(key)))
  // THE TRAP the `cancelled` marker exists for: the pool settles a cancelled
  // job by reporting `failed`, and that verdict is cached for the session —
  // so without the marker, leaving a cell would poison it against ever
  // previewing again.
  check("the cancelled job's own `failed` event is IGNORED",
    applyJobEvent(key, { id: "j", state: "failed", error: "cancelled" }) === null
      && getTranscodeState(key).state === "idle")
  // A DONE key is left alone entirely: the artifact is cached, which is the
  // whole point of having run the job.
  const done = transcodeKey("yyy", PREVIEW_PRESET)
  setTranscodeState(done, {
    state: "done", artifactUrl: "/api/video/artifact?key=k", filename: null, artifact: null,
  })
  cancelTranscode(done)
  check("cancelling a DONE key changes nothing",
    getTranscodeState(done).state === "done")
}

// ---------------------------------------------------------------------------
// V11: what the badge says
// ---------------------------------------------------------------------------

console.log("\n== the badge's progress and caption (V11) ==")
{
  const shape = (value) => JSON.stringify(value)
  check("a POST in flight is an indeterminate sweep",
    shape(previewFeedback({ state: "requesting" }))
      === shape({ progress: "queued", caption: "Transcoding…" }))
  check("a queued job names its position through the shared formatter",
    shape(previewFeedback({ state: "queued", position: 2 }))
      === shape({ progress: "queued", caption: "Queued #2" }))
  check("a running job fills the ring",
    shape(previewFeedback({ state: "running", progress: 0.4 }))
      === shape({ progress: 0.4, caption: "Transcoding…" }))
  check("a running job with no measurable progress sweeps instead",
    shape(previewFeedback({ state: "running", progress: null }))
      === shape({ progress: "queued", caption: "Transcoding…" }))
  check("idle and done say nothing",
    previewFeedback({ state: "idle" }) === null
      && previewFeedback({
        state: "done", artifactUrl: "u", filename: null, artifact: null,
      }) === null)
  // A sticky failure shows NOTHING and never retries in the session: a stalled
  // ring and an ffmpeg error under a thumbnail are both worse than the frame
  // the cell already has.
  check("a failure shows nothing",
    previewFeedback({ state: "failed", error: "boom", sticky: true }) === null)
}

// ---------------------------------------------------------------------------
// V8: what the client config publishes
// ---------------------------------------------------------------------------

console.log("\n== client-config normalization (V8) ==")
{
  const derive = (hover_preview) => deriveClientConfig({
    capabilities: {},
    client: {},
    hover_preview,
  }).hoverPreview
  const shape = (value) => JSON.stringify(value)
  check("a complete pair is passed through",
    shape(derive({ direct: true, transcode: false }))
      === shape({ direct: true, transcode: false }))
  check("both false is a REPORTED denial, not an absence",
    shape(derive({ direct: false, transcode: false }))
      === shape({ direct: false, transcode: false }))
  // ALL-OR-NOTHING: a half-reported capability is one this client cannot see,
  // and guessing either way is a request the policy may refuse or a preview
  // the user was entitled to and did not get.
  check("a missing member reads as NOT REPORTED", derive({ direct: true }) === null)
  check("a non-boolean member reads as not reported",
    derive({ direct: true, transcode: "yes" }) === null)
  check("an absent field reads as not reported (an older Server)",
    derive(undefined) === null && derive(null) === null)
  check("a non-object reads as not reported", derive(true) === null)
}

// ---------------------------------------------------------------------------
// V12: the frame swap, as it reaches the plan
// ---------------------------------------------------------------------------

console.log("\n== the V12 frame swap ==")
{
  const dbs = { index_db: "stdtest", user_data_db: null }
  const env = (smallCell) => ({
    animatedFloor: { maxFileSize: 1024 * 1024, maxSide: 512 },
    displayLoopTrigger: { maxBytes: 5 * 1024 * 1024, maxShortSide: 4096, maxPixels: 24_000_000 },
    smallCell,
  })
  const video = {
    sha256: "abc", type: "video/mp4", duration: 42,
    size: 20_000_000, width: 1920, height: 1080,
  }
  const plan = (smallCell, rung) =>
    planCellPicture(video, dbs, "grid-s", env(smallCell), rung)

  // PREVIEWS OFF: byte for byte the cells that shipped before this existed.
  check("previews off, small cell: today's frame->mosaic swap",
    plan(true, "none").kind === "videoSmall")
  check("previews off, large cell: today's plain still",
    plan(false, "none").kind === "still")
  check("...and the small cell's two URLs are still the frame and the mosaic",
    plan(true, "none").frame.includes("&big=false")
      && !plan(true, "none").mosaic.includes("big=false"))

  // PREVIEWS ON, SMALL CELL: never swaps to the 2x2 — the same URL twice, so
  // the card mounts no second layer and binds no listeners for it.
  const small = plan(true, "direct")
  check("previews on, small cell: one video plan", small.kind === "video")
  check("...whose base picture IS the single frame",
    small.poster.includes("&big=false"))
  check("...and which therefore never swaps (poster === frame)",
    small.poster === small.frame)

  // PREVIEWS ON, LARGE CELL: the 2x2 base swaps to the 1x1 on hover, which is
  // the waiting placeholder the video fades in over.
  const large = plan(false, "direct")
  check("previews on, large cell: one video plan", large.kind === "video")
  check("...whose base picture is the 2x2 mosaic",
    !large.poster.includes("big=false"))
  check("...and whose hover placeholder is the single frame",
    large.frame.includes("&big=false") && large.poster !== large.frame)

  // Rung 0 names the ORIGINAL file; rung 1 has no URL until its job is done.
  check("rung 0 carries the original file URL",
    typeof large.directSrc === "string" && large.directSrc.includes("/api/items/item/file"),
    String(large.directSrc))
  check("rung 1 carries no src at plan time",
    plan(false, "transcode").directSrc === null)
  check("the rung rides in the plan",
    plan(false, "transcode").rung === "transcode"
      && plan(true, "direct").rung === "direct")

  // An EXTREME-ASPECT video: the crop becomes the preview picture and the
  // whole-image swap stands down, so one gesture has one owner.
  const strip = { ...video, width: 2560, height: 1080 }
  const stripPlan = (rung) =>
    planCellPicture(strip, dbs, "grid-s", env(false), rung)
  check("an extreme-aspect video with previews OFF keeps its image crop and swap",
    stripPlan("none").crop.kind === "image"
      && typeof stripPlan("none").displaySrc === "string")
  check("...and with previews ON gets a video crop and no swap",
    stripPlan("direct").crop.kind === "video"
      && stripPlan("direct").displaySrc === null)
  check("...whose crop never swaps either (there is no single-frame crop)",
    stripPlan("direct").crop.poster === stripPlan("direct").crop.frame)

  // A non-video row is untouched by any of it: the rung is the card's answer
  // and a still card's is always "none", but even a mistaken one must not
  // turn an image into a video cell.
  const image = { sha256: "ddd", type: "image/png", size: 900_000, width: 800, height: 600 }
  check("a still image is never planned as a video cell",
    planCellPicture(image, dbs, "grid-s", env(true), "direct").kind === "still")
}

finish()
