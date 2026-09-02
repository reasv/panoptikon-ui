// Assertions for the pure half of lib/videoTranscode.ts: the wire parsing
// (SSE event / snapshot body / submit response), the badge the play affordance
// renders from it, and the store's own decisions — which are plain JS and are
// covered here by calling them directly. Only the two I/O shells (the
// EventSource and the fetch loop) need a browser, which is exactly why every
// choice they make lives in an exported function instead. Run from the ui
// root:
//
//   node --experimental-strip-types scripts/transcode.test.mjs
//
// The module imports fetchClient (a value, at module scope) — that is why the
// resolver hook below also maps the "@/" alias.

import { createChecker } from "./harness.mjs"
import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  applyJobEvent,
  applyJobEventText,
  claimArtifactRetry,
  clearArtifactRetry,
  getTranscodeState,
  isTerminalState,
  jobIdFromSubmit,
  resetTranscode,
  shouldSubmit,
  sseErrorDisposition,
  stateFromEvent,
  stateFromSubmit,
  transcodeBadge,
  transcodeKey,
} = await import("../lib/videoTranscode.ts")

const { check, finish } = createChecker()
const shape = (value) => JSON.stringify(value)

// ---- events: the server's tagged envelope ------------------------------
//
// TranscodeJobSnapshot is `{id}` flattened over a TranscodeJobEvent tagged by
// `state` (snake_case) — the same object arrives over SSE and from the
// snapshot GET, which is why one parser serves both.

check(
  "a queued event carries its 1-based position",
  shape(stateFromEvent({ id: "j", state: "queued", position: 3 })) ===
    shape({ state: "queued", position: 3 }),
  shape(stateFromEvent({ id: "j", state: "queued", position: 3 }))
)
check(
  "a queued event with a nonsense position falls back to the head",
  stateFromEvent({ state: "queued", position: 0 }).position === 1
)
check(
  "a running event carries fractional progress",
  shape(stateFromEvent({ state: "running", progress: 0.42 })) ===
    shape({ state: "running", progress: 0.42 })
)
check(
  "progress is null when the server cannot compute one",
  stateFromEvent({ state: "running", progress: null }).progress === null
)
check(
  "progress is clamped to 0..1",
  stateFromEvent({ state: "running", progress: 1.4 }).progress === 1 &&
    stateFromEvent({ state: "running", progress: -2 }).progress === 0
)
check(
  "a done event takes the artifact URL verbatim (never rebuilt client-side)",
  stateFromEvent({
    state: "done",
    artifact: {
      key: "abc-def",
      mime_type: "video/mp4",
      size_bytes: 12,
      url: "/api/video/artifact?key=abc-def",
    },
  }).artifactUrl === "/api/video/artifact?key=abc-def"
)
check(
  "a done event with no URL is a failure, not a stuck job",
  stateFromEvent({ state: "done", artifact: {} }).state === "failed"
)
check(
  "a failed event carries the server's message",
  stateFromEvent({ state: "failed", error: "ffmpeg exited 1", cancelled: false })
    .error === "ffmpeg exited 1"
)
check(
  "a cancelled job is just a failure to the client",
  stateFromEvent({ state: "failed", error: "cancelled", cancelled: true })
    .state === "failed"
)
check(
  "an unknown state is unusable (null), never a silent idle",
  stateFromEvent({ state: "reticulating" }) === null &&
    stateFromEvent(null) === null &&
    stateFromEvent("queued") === null
)

// ---- submit: the four outcomes -----------------------------------------

check(
  "outcome=hit short-circuits straight to done",
  shape(
    stateFromSubmit({
      outcome: "hit",
      artifact: {
        key: "k",
        url: "/api/video/artifact?key=k",
        filename: "holiday-clip.mp4",
      },
    })
  ) ===
    shape({
      state: "done",
      artifactUrl: "/api/video/artifact?key=k",
      filename: "holiday-clip.mp4",
      // The deliverable half of the same ArtifactRef — what "Copy, don't
      // download" hands to the clipboard. Pinned in full by
      // scripts/artifactShare.test.mjs; here only so this shape stays honest.
      artifact: {
        key: "k",
        url: "/api/video/artifact?key=k",
        filename: "holiday-clip.mp4",
        size: null,
        sha256: null,
        path: null,
      },
    })
)
// The download name is the SERVER's (ArtifactRef.filename), on both the hit
// and the done event: the URL is the `key=` form, and a key knows neither the
// source's path nor whether the request was trimmed. Playback never reads it;
// lib/videoClip.ts hangs it on an <a download>.
check(
  "the server's download name rides on the done event too",
  stateFromEvent({
    state: "done",
    artifact: { key: "k", url: "/u", filename: "holiday-clip.mp4" },
  }).filename === "holiday-clip.mp4"
)
check(
  "a missing name is null, never a failure — only the URL is load-bearing",
  stateFromEvent({ state: "done", artifact: { key: "k", url: "/u" } })
    .filename === null &&
    stateFromEvent({ state: "done", artifact: { key: "k", url: "/u" } })
      .state === "done"
)
check(
  "outcome=created reads the embedded job snapshot",
  shape(
    stateFromSubmit({
      outcome: "created",
      job: { id: "j1", state: "queued", position: 2 },
    })
  ) === shape({ state: "queued", position: 2 })
)
check(
  "outcome=joined is indistinguishable from created (same envelope)",
  stateFromSubmit({
    outcome: "joined",
    job: { id: "j1", state: "running", progress: 0.1 },
  }).state === "running"
)
check(
  "outcome=known_failure arrives as a job already born failed",
  stateFromSubmit({
    outcome: "known_failure",
    job: { id: "j1", state: "failed", error: "unencodable", cancelled: false },
  }).error === "unencodable"
)
check(
  "a hit with no artifact URL is a failure",
  stateFromSubmit({ outcome: "hit" }).state === "failed"
)
check(
  "a jobless non-hit response is a failure",
  stateFromSubmit({ outcome: "created" }).state === "failed"
)

check(
  "the job id is read off the snapshot, and only when there is one",
  jobIdFromSubmit({ outcome: "created", job: { id: "j1", state: "queued" } }) ===
    "j1" &&
    jobIdFromSubmit({ outcome: "hit", artifact: { url: "/x" } }) === null
)

// ---- terminality: what closes the EventSource --------------------------

check(
  "done and failed are terminal; nothing else is",
  isTerminalState({ state: "done", artifactUrl: "/x" }) &&
    isTerminalState({ state: "failed", error: "e" }) &&
    !isTerminalState({ state: "idle" }) &&
    !isTerminalState({ state: "requesting" }) &&
    !isTerminalState({ state: "queued", position: 1 }) &&
    !isTerminalState({ state: "running", progress: null })
)

// ---- the badge ---------------------------------------------------------

check(
  "queued renders as #N",
  transcodeBadge({ state: "queued", position: 4 }).text === "#4"
)
check(
  "running renders as a whole percentage",
  transcodeBadge({ state: "running", progress: 0.426 }).text === "43%"
)
check(
  "unknown progress renders as an ellipsis, not 0%",
  transcodeBadge({ state: "running", progress: null }).text === "…" &&
    transcodeBadge({ state: "requesting" }).text === "…"
)
check(
  "a failure is flagged so the host can swap the glyph",
  transcodeBadge({ state: "failed", error: "boom" }).error === true
)
check(
  "idle and done render nothing at all",
  transcodeBadge({ state: "idle" }) === null &&
    transcodeBadge({ state: "done", artifactUrl: "/x" }) === null
)

// ---- sticky vs non-sticky failure --------------------------------------
//
// Only the JOB's own verdict is cached for the session. Everything else that
// can produce a `failed` state is an accident of the exchange, and the next
// press has to be allowed to repeat it.

check(
  "a job-reported failure is sticky",
  stateFromEvent({ state: "failed", error: "unencodable", cancelled: false })
    .sticky === true
)
check(
  "known_failure comes back sticky through the submit envelope",
  stateFromSubmit({
    outcome: "known_failure",
    job: { id: "j", state: "failed", error: "unencodable", cancelled: false },
  }).sticky === true
)
check(
  "a malformed submit response is NOT sticky",
  stateFromSubmit(null).sticky === false &&
    stateFromSubmit({ outcome: "created" }).sticky === false &&
    stateFromSubmit({ outcome: "hit" }).sticky === false
)
check(
  "a done event with no URL is not sticky either (the encode succeeded)",
  stateFromEvent({ state: "done", artifact: {} }).sticky === false
)
check(
  "sticky failures dedup the next press; non-sticky ones clear and retry",
  shouldSubmit(undefined) === true &&
    shouldSubmit({ state: "idle" }) === true &&
    shouldSubmit({ state: "requesting" }) === false &&
    shouldSubmit({ state: "queued", position: 1 }) === false &&
    shouldSubmit({ state: "running", progress: 0.5 }) === false &&
    shouldSubmit({ state: "done", artifactUrl: "/x" }) === false &&
    shouldSubmit({ state: "failed", error: "e", sticky: true }) === false &&
    shouldSubmit({ state: "failed", error: "e", sticky: false }) === true
)

// ---- the store: keys, application, terminality --------------------------

const KEY = transcodeKey("aa".repeat(32), "playback")

check(
  "the key is sha:preset — one job per rendition, not per URL",
  KEY === `${"aa".repeat(32)}:playback` &&
    transcodeKey("abc", "playback") !== transcodeKey("abc", "clip")
)
check(
  "a fresh key reads idle without being written first",
  getTranscodeState(KEY).state === "idle"
)

check(
  "a usable event is applied",
  applyJobEvent(KEY, { id: "j", state: "running", progress: 0.5 })?.state ===
    "running" && getTranscodeState(KEY).state === "running"
)
check(
  "malformed SSE JSON is ignored, and leaves the state alone",
  applyJobEventText(KEY, "{not json") === null &&
    applyJobEventText(KEY, "") === null &&
    getTranscodeState(KEY).state === "running" &&
    getTranscodeState(KEY).progress === 0.5
)
check(
  "an unusable (unknown-state) event is ignored the same way",
  applyJobEvent(KEY, { state: "reticulating" }) === null &&
    getTranscodeState(KEY).state === "running"
)
check(
  "a well-formed frame still applies through the text path",
  applyJobEventText(KEY, JSON.stringify({ state: "queued", position: 7 }))
    ?.position === 7
)
check(
  "the terminal event lands",
  applyJobEventText(
    KEY,
    JSON.stringify({
      state: "done",
      artifact: { key: "k", url: "/api/video/artifact?key=k" },
    })
  )?.state === "done"
)
check(
  "anything after a terminal state is ignored (a late frame cannot revive it)",
  applyJobEvent(KEY, { state: "running", progress: 0.1 }) === null &&
    applyJobEventText(
      KEY,
      JSON.stringify({ state: "failed", error: "late", cancelled: false })
    ) === null &&
    getTranscodeState(KEY).state === "done"
)

// Dedup is per sha:preset, so the same item at another preset is a different
// job and the two never see each other's states.
const OTHER = transcodeKey("aa".repeat(32), "clip")
check(
  "a second preset for the same sha is an independent entry",
  getTranscodeState(OTHER).state === "idle" &&
    getTranscodeState(KEY).state === "done"
)

check(
  "reset drops the verdict so the next press re-POSTs",
  (() => {
    resetTranscode("aa".repeat(32), "playback")
    return (
      getTranscodeState(KEY).state === "idle" &&
      shouldSubmit(getTranscodeState(KEY)) === true
    )
  })()
)

// ---- the EventSource's error disposition --------------------------------
//
// The half of `followJob` that is a decision rather than an effect. CLOSED is
// the one that used to hang: the browser has given up reconnecting, so waiting
// for a second error waits forever.

check(
  "a CLOSED EventSource falls back to the poller on the FIRST error",
  sseErrorDisposition({ readyState: 2, consecutiveErrors: 1, terminal: false }) ===
    "fallback"
)
check(
  "a reconnecting EventSource is given its budget first",
  sseErrorDisposition({ readyState: 0, consecutiveErrors: 1, terminal: false }) ===
    "reconnect"
)
check(
  "...and falls back once the budget is spent",
  sseErrorDisposition({ readyState: 0, consecutiveErrors: 2, terminal: false }) ===
    "fallback"
)
check(
  "an error after the terminal event just closes — nothing left to follow",
  sseErrorDisposition({ readyState: 0, consecutiveErrors: 1, terminal: true }) ===
    "close" &&
    sseErrorDisposition({ readyState: 2, consecutiveErrors: 9, terminal: true }) ===
      "close"
)

// ---- the evicted-artifact retry marker ----------------------------------

check(
  "the automatic artifact re-POST is claimable exactly once per key",
  claimArtifactRetry(KEY) === true && claimArtifactRetry(KEY) === false
)
check(
  "a reset does NOT re-arm it (that is what stops the loop)",
  (() => {
    resetTranscode("aa".repeat(32), "playback")
    return claimArtifactRetry(KEY) === false
  })()
)
check(
  "successful playback re-arms it",
  (() => {
    clearArtifactRetry(KEY)
    return claimArtifactRetry(KEY) === true
  })()
)
check(
  "the marker is per key, like everything else in the store",
  claimArtifactRetry(OTHER) === true
)

finish()
