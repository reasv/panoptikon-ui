// Assertions for the pure half of lib/videoTranscode.ts: the wire parsing
// (SSE event / snapshot body / submit response) and the badge the play
// affordance renders from it. The store, the EventSource and the poll
// fallback need a DOM and are not covered here. Run from the ui root:
//
//   node --experimental-strip-types scripts/transcode.test.mjs
//
// The module imports fetchClient (a value, at module scope) — that is why the
// resolver hook below also maps the "@/" alias.

import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  isTerminalState,
  jobIdFromSubmit,
  stateFromEvent,
  stateFromSubmit,
  transcodeBadge,
} = await import("../lib/videoTranscode.ts")

let all = true
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `\n  ${detail}` : ""}`)
  all &&= !!ok
  return ok
}
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
      artifact: { key: "k", url: "/api/video/artifact?key=k" },
    })
  ) === shape({ state: "done", artifactUrl: "/api/video/artifact?key=k" })
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

process.exit(all ? 0 : 1)
