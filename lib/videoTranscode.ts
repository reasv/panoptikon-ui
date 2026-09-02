import React from "react"
import { fetchClient } from "@/lib/api"
// Type-only: this module must not pull the playability ladder's runtime in
// (and vice versa) — the two are composed by the hosts, not by each other.
import type { Playability } from "@/lib/videoPlayability"
// Type-only for a second reason: `@/lib/panoptikon` is a .d.ts, so a VALUE
// import of it would be a runtime module the node test scripts cannot resolve.
import type { components } from "@/lib/panoptikon"
// Relative, not aliased, and pure by construction on the other side (no React,
// no browser globals) — so a node test script that imports this module for its
// parsers pulls the deliverable shape in with it.
import type { DeliverableArtifact } from "./artifactShareMeta"

// The playback half of the transcode surface (docs/video-transcoding-design.md
// §2 and §8): ask the server for a playable rendition of one item, follow the
// job, and hand the host an artifact URL to mount a plain <video> against.
//
// Shape copied from lib/videoEndProbe.ts and the outro-skip store in
// videoPlayerState.ts: a MODULE-level map plus useSyncExternalStore, not React
// state. The gallery and a pin of the same item are two components watching
// one job, and a per-component store would run (and pay for) that encode
// twice.
//
// Keyed by `sha:preset`, never by URL: the file URL carries the selected
// databases, so the same bytes have several URLs in one session — but the
// artifact is content-addressed and identical under every one of them.

export const PLAYBACK_PRESET = "playback"

export type TranscodeState =
  | { state: "idle" }
  /** POSTed, no job id yet. */
  | { state: "requesting" }
  /** 1-based position in the pool's FIFO queue. */
  | { state: "queued"; position: number }
  /** 0..1, or null when the source has no recorded duration to divide by. */
  | { state: "running"; progress: number | null }
  /**
   * `filename` is the SERVER's name for the finished bytes
   * (`ArtifactRef.filename`, implementation plan §3 S3), carried so the clip
   * export can hang it on an `<a download>` without deriving one: the URL is
   * the `key=` form, and a key knows neither the source's path nor whether
   * the request was trimmed. Null when the server sent none — an older
   * gateway, or a payload the defensive parse below could not read. The
   * PLAYBACK path never reads it; it mounts the URL and nothing else.
   *
   * `artifact` is the SAME answer in the shape a delivery needs (the key the
   * server-side clipboard copy addresses, the hash and size the Relay verifies
   * against, the host path it maps). Null when the payload carried no usable
   * `ArtifactRef` — an older gateway, or one the defensive parse could not
   * read — which is why `artifactUrl` and `filename` remain first-class
   * alongside it: the download path must keep working with no artifact object
   * at all.
   */
  | {
      state: "done"
      artifactUrl: string
      filename: string | null
      artifact: DeliverableArtifact | null
    }
  /**
   * `sticky` separates the two failures that used to wear one shape.
   *
   * STICKY is a VERDICT: the job itself reported `failed`, or the POST came
   * back `known_failure`. The server negative-caches that (two strikes and it
   * stops trying), so re-POSTing on every play press is a round trip that buys
   * the same answer — it is cached for the session and a reload retries.
   *
   * NON-STICKY is an ACCIDENT: a refused POST, a dead transport, a poll that
   * gave up. Nothing was learned about the item, so the next press clears it
   * and tries again exactly as if the store had never heard of this key.
   */
  | { state: "failed"; error: string; sticky: boolean }

const IDLE: TranscodeState = { state: "idle" }

/** The job said no. Cached for the session (see `sticky` above). */
function stickyFailure(error: string): TranscodeState {
  return { state: "failed", error, sticky: true }
}

/** Something between here and the job broke. The next press retries. */
function retryableFailure(error: string): TranscodeState {
  return { state: "failed", error, sticky: false }
}

export function isTerminalState(state: TranscodeState): boolean {
  return state.state === "done" || state.state === "failed"
}

// ---- wire parsing (pure) ----------------------------------------------
//
// The SSE payload and the snapshot body are the same object: a
// `TranscodeJobSnapshot`, which is `{id}` flattened over a `TranscodeJobEvent`
// tagged by `state` (snake_case). Parsed defensively rather than cast: this
// data arrives as text through an EventSource, where the type system is a
// suggestion.

type JobEvent = components["schemas"]["TranscodeJobEvent"]
type JobSnapshot = components["schemas"]["TranscodeJobSnapshot"]
type SubmitResponse = components["schemas"]["TranscodeSubmitResponse"]
type ArtifactRef = components["schemas"]["ArtifactRef"]
type QueuedEvent = Extract<JobEvent, { state: "queued" }>
type RunningEvent = Extract<JobEvent, { state: "running" }>
type DoneEvent = Extract<JobEvent, { state: "done" }>
type FailedEvent = Extract<JobEvent, { state: "failed" }>

/**
 * The variant tags, pinned to the generated schema. Nothing below type-checks
 * the payload (it is text off a wire), so this `satisfies` is what makes a
 * server-side rename a tsc error here instead of a silent `null` verdict —
 * an unparseable event at runtime, which is the failure mode with no symptom.
 */
const JOB_STATE = {
  queued: "queued",
  running: "running",
  done: "done",
  failed: "failed",
} as const satisfies Record<string, JobEvent["state"]>

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

/**
 * Read one field off a defensively-parsed record. The VALUE stays `unknown`
 * (every caller narrows it), but the NAME is checked against the generated
 * schema type — the same pinning the tags get above, at each read site.
 */
function field<T>(record: Record<string, unknown>, key: keyof T & string): unknown {
  return record[key]
}

/** A wire field as a non-empty string, or null. The parse's one narrowing. */
function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null
}

/**
 * The finished artifact in the shape a DELIVERY needs, off the same
 * defensively-parsed record the `done` state is built from. Both parse sites
 * (the job event and the `hit` submit response) carry an identical
 * `ArtifactRef`, so both read it through here.
 *
 * `key` is what makes the object exist: the server-side clipboard copy
 * addresses an artifact by key and by nothing else, so a payload without one
 * is not deliverable however much else it carried — null, and the caller's
 * download path (which needs only the URL) takes over. Everything else
 * degrades to null field by field: an absent `sha256` or `path` disqualifies
 * the relay leg (see `relayEligibleArtifact`) rather than failing it, and an
 * absent size is left null rather than coerced to 0, which is a legitimate
 * value.
 *
 * `url` is passed in already validated — the caller has to prove it is a
 * usable string before there is a `done` state at all, and reading the field
 * twice could only produce two different answers.
 */
function deliverableArtifact(
  artifact: Record<string, unknown> | null,
  url: string,
): DeliverableArtifact | null {
  if (!artifact) return null
  const key = text(field<ArtifactRef>(artifact, "key"))
  if (!key) return null
  const size = field<ArtifactRef>(artifact, "size_bytes")
  return {
    key,
    url,
    filename: text(field<ArtifactRef>(artifact, "filename")),
    size: typeof size === "number" && isFinite(size) && size >= 0 ? size : null,
    sha256: text(field<ArtifactRef>(artifact, "sha256")),
    path: text(field<ArtifactRef>(artifact, "path")),
  }
}

/** One snapshot (SSE event or polled body) as a state, or null if unusable. */
export function stateFromEvent(payload: unknown): TranscodeState | null {
  const event = asRecord(payload)
  if (!event) return null
  switch (field<JobEvent>(event, "state")) {
    case JOB_STATE.queued: {
      const position = field<QueuedEvent>(event, "position")
      return {
        state: "queued",
        position: typeof position === "number" && position > 0 ? position : 1,
      }
    }
    case JOB_STATE.running: {
      const progress = field<RunningEvent>(event, "progress")
      return {
        state: "running",
        progress:
          typeof progress === "number" && isFinite(progress)
            ? Math.max(0, Math.min(1, progress))
            : null,
      }
    }
    case JOB_STATE.done: {
      const artifact = asRecord(field<DoneEvent>(event, "artifact"))
      const url = artifact ? field<ArtifactRef>(artifact, "url") : null
      // A done event with no artifact URL is a server the client cannot
      // follow; treat it as a failure rather than a permanent "running". NOT
      // sticky: the job succeeded, so a re-POST hits the cache and is likelier
      // to produce a usable envelope than to repeat this one.
      if (typeof url !== "string" || !url) {
        return retryableFailure("The finished rendition has no URL")
      }
      // A MISSING name is not a failure: the bytes are there, and the clip
      // export has its own fallback. Only the URL is load-bearing.
      const filename = artifact ? field<ArtifactRef>(artifact, "filename") : null
      return {
        state: "done",
        artifactUrl: url,
        filename: typeof filename === "string" && filename ? filename : null,
        artifact: deliverableArtifact(artifact, url),
      }
    }
    case JOB_STATE.failed: {
      const error = field<FailedEvent>(event, "error")
      // The job's own verdict — the one failure that is cached for the
      // session, because the server caches it too.
      return stickyFailure(
        typeof error === "string" && error ? error : "The transcode failed"
      )
    }
    default:
      return null
  }
}

/**
 * The POST response as a state. `hit` short-circuits the whole job dance —
 * the bytes already exist — and `known_failure` arrives as a job already born
 * failed, so it needs no special case at all.
 */
export function stateFromSubmit(payload: unknown): TranscodeState {
  const body = asRecord(payload)
  // Every failure below is NON-sticky: a response this malformed says nothing
  // about the item, only about the exchange, and pressing play again is the
  // user asking to re-run exactly that exchange. (`outcome` is a bare string
  // in the schema, so there is no enum to pin `"hit"` against.)
  if (!body) return retryableFailure("The server sent no job")
  if (field<SubmitResponse>(body, "outcome") === "hit") {
    const artifact = asRecord(field<SubmitResponse>(body, "artifact"))
    const url = artifact ? field<ArtifactRef>(artifact, "url") : null
    const filename = artifact ? field<ArtifactRef>(artifact, "filename") : null
    if (typeof url === "string" && url) {
      return {
        state: "done",
        artifactUrl: url,
        filename: typeof filename === "string" && filename ? filename : null,
        artifact: deliverableArtifact(artifact, url),
      }
    }
    return retryableFailure("The cached rendition has no URL")
  }
  // `known_failure` arrives as a job already born failed, so it needs no
  // special case — and comes back sticky from stateFromEvent, which is the
  // whole point of the distinction.
  return (
    stateFromEvent(field<SubmitResponse>(body, "job")) ??
    retryableFailure("The server sent no job")
  )
}

/** The job id to follow, when the submit created or joined one. */
export function jobIdFromSubmit(payload: unknown): string | null {
  const body = asRecord(payload)
  const job = body ? asRecord(field<SubmitResponse>(body, "job")) : null
  const id = job ? field<JobSnapshot>(job, "id") : null
  return typeof id === "string" && id ? id : null
}

/**
 * The one-glyph status the play affordance shows while a job runs
 * (MediaControls' `progress` prop). Null while there is nothing to say.
 */
export function transcodeBadge(
  state: TranscodeState
): { text: string; error?: boolean } | null {
  switch (state.state) {
    case "requesting":
      return { text: "…" }
    case "queued":
      return { text: `#${state.position}` }
    case "running":
      return state.progress == null
        ? { text: "…" }
        : { text: `${Math.round(state.progress * 100)}%` }
    case "failed":
      return { text: state.error, error: true }
    default:
      return null
  }
}

// ---- the store ---------------------------------------------------------

const states = new Map<string, TranscodeState>()
const listeners = new Map<string, Set<() => void>>()
// One automatic re-POST per key for an artifact the element could not load
// (see `claimArtifactRetry`). Never cleared by a reset — that is what makes it
// a bound rather than a loop.
const artifactRetries = new Set<string>()

/**
 * WHOSE JOB IS IT (video-hover-preview V4). One entry per key with a job in
 * flight, carrying the id and — the load-bearing half — whether THIS store
 * created it or joined one that was already running for somebody else.
 *
 * `cancelTranscode` acts on `created` entries only: a joined job belongs to
 * whoever asked first (the gallery player, a pin, another surface's press),
 * and cancelling it would take their encode away to save work nobody was
 * doing.
 */
const jobs = new Map<string, { id: string; created: boolean }>()
/** How to stop following one key's job: an SSE close, or a poller's stop. */
const followers = new Map<string, () => void>()
/**
 * Keys whose job THIS client cancelled, and whose late events must be ignored.
 *
 * Without it a cancellation is a STICKY FAILURE: the pool settles a cancelled
 * job by reporting `failed`, `stateFromEvent` reads that as the job's own
 * verdict (which it caches for the session), and the next hover over the same
 * cell would refuse to resubmit — for a job the user ended by moving the
 * pointer. Cleared by the next `startTranscode` on the key.
 */
const cancelled = new Set<string>()

/**
 * The store key. Content-addressed, never a URL — see the header.
 *
 * `endCs` adds a third segment when present, in lib/videoClip.ts's spelling
 * (`e<cs>`) and deliberately so: it is the same bound asking for the same
 * bytes, so two callers that trim a file identically land on one key and one
 * encode. Absent leaves the two-segment key every existing caller mints
 * unchanged, so nothing that predates the preview rung moves.
 */
export function transcodeKey(
  sha256: string,
  preset: string = PLAYBACK_PRESET,
  endCs?: number | null
): string {
  const base = `${sha256}:${preset}`
  return endCs == null ? base : `${base}:e${endCs}`
}

function setState(key: string, next: TranscodeState) {
  states.set(key, next)
  // A settled key has no job to cancel and nothing left to follow. Dropping
  // the bookkeeping here rather than at each terminal site is what keeps
  // `ownsTranscodeJob` from claiming an encode that finished minutes ago.
  if (isTerminalState(next)) {
    jobs.delete(key)
    followers.delete(key)
  }
  const bucket = listeners.get(key)
  if (bucket) for (const listener of bucket) listener()
}

function subscribeKey(key: string | null, onChange: () => void): () => void {
  if (!key) return () => {}
  let bucket = listeners.get(key)
  if (!bucket) {
    bucket = new Set()
    listeners.set(key, bucket)
  }
  bucket.add(onChange)
  return () => {
    bucket.delete(onChange)
    if (bucket.size === 0) listeners.delete(key)
  }
}

/** The current state for a key. Exported for the node tests and the hosts. */
export function getTranscodeState(key: string): TranscodeState {
  return states.get(key) ?? IDLE
}

// ---- the seam lib/videoClip.ts drives -----------------------------------
//
// The clip export runs the SAME exchange as playback — POST, follow, done —
// against a DIFFERENT key: its jobs carry trim bounds, and the store key
// above deliberately does not (`sha:preset` is the whole point of the
// playback dedup). Rather than grow this store a second key vocabulary, the
// three verbs a follower needs are exported and `videoClip.ts` mints its own
// keys with a third segment (see `clipStoreKey` there). Keys are opaque
// strings to everything below, so the two namespaces cannot collide as long
// as one of them always carries that extra segment.
//
// Nothing here is a second store: one map, one listener table, one SSE
// implementation with one poll fallback.

/** Write one state for an arbitrary key (the `requesting` seed, a refusal). */
export function setTranscodeState(key: string, next: TranscodeState) {
  setState(key, next)
}

/**
 * Drop a key from the store entirely.
 *
 * For keys that are MINTED rather than derived: a composition is followed
 * under `compose:<jobId>`, and a job id is a fresh UUID every time, so its
 * entry can never be reused and would otherwise sit in the map for the life of
 * the tab — one per animated save. The playback and clip keys are
 * content-addressed (`sha:preset[:window]`), which is exactly why they are
 * kept: their whole purpose is to be found again.
 *
 * Called only once the terminal state has been CONSUMED (the download fired,
 * the receipt shown). Listeners are notified so anything still subscribed sees
 * `idle` rather than a stale verdict.
 */
export function forgetTranscodeState(key: string) {
  states.delete(key)
  const bucket = listeners.get(key)
  if (bucket) for (const listener of bucket) listener()
}

/** Subscribe to one key. Returns the unsubscribe. */
export function subscribeTranscodeKey(key: string, onChange: () => void): () => void {
  return subscribeKey(key, onChange)
}

/**
 * Follow a job onto `key`: SSE while it gets through, the snapshot poller
 * when it does not. Terminal states land in the store, so a caller waits by
 * subscribing rather than by being called back.
 */
export function followTranscodeJob(key: string, jobId: string) {
  followJob(key, jobId)
}

/**
 * Apply one snapshot to a key. Returns the state it produced, or null when the
 * payload was unusable — and ignores ANYTHING that arrives after a terminal
 * state, which is what keeps a late SSE frame (or a poll tick racing the
 * stream it just replaced) from reviving a job that is already done.
 */
export function applyJobEvent(key: string, payload: unknown): TranscodeState | null {
  // A key this client cancelled (V4): the pool settles the job by reporting
  // `failed`, which would otherwise be cached as a verdict about the FILE and
  // stop the next hover resubmitting. See `cancelled`.
  if (cancelled.has(key)) return null
  const current = states.get(key)
  if (current && isTerminalState(current)) return null
  const next = stateFromEvent(payload)
  if (!next) return null
  setState(key, next)
  return next
}

/** The SSE form: the same thing, from one frame's `data` text. */
export function applyJobEventText(key: string, data: string): TranscodeState | null {
  let payload: unknown
  try {
    payload = JSON.parse(data)
  } catch {
    // A malformed frame is a dropped sample and nothing else. Never a state
    // change, and never a reason to tear the stream down.
    return null
  }
  return applyJobEvent(key, payload)
}

/**
 * May a press submit for this key? Idle and never-seen obviously yes; a live
 * job joins instead (dedup per `sha:preset`, which is what stops a pin and the
 * gallery from encoding the same item twice). A failure depends on WHOSE it
 * was — see `sticky` on TranscodeState.
 */
export function shouldSubmit(current: TranscodeState | undefined): boolean {
  if (!current || current.state === "idle") return true
  return current.state === "failed" && !current.sticky
}

/**
 * Forget a key's verdict, so the next `startTranscode` re-POSTs. Used by the
 * evicted-artifact recovery: the state has to pass through idle (which pulls
 * the URL out from under the element) or the re-`done` would hand the host the
 * identical `src` string, and an element that already failed on that src never
 * refetches it.
 */
export function resetTranscode(
  sha256: string | null | undefined,
  preset: string = PLAYBACK_PRESET
) {
  if (!sha256) return
  setState(transcodeKey(sha256, preset), IDLE)
}

/**
 * The single retry marker per key. The artifact lives in a global LRU disk
 * cache and can be evicted between the job finishing and the element fetching
 * it, so ONE automatic re-POST (which hits, or starts a fresh job) is worth
 * spending. Returns true the first time only; the second consecutive artifact
 * error has to land somewhere that is not another POST.
 */
export function claimArtifactRetry(key: string): boolean {
  if (artifactRetries.has(key)) return false
  artifactRetries.add(key)
  return true
}

/** Re-arm the retry: the element actually played, so the round trip worked. */
export function clearArtifactRetry(key: string) {
  artifactRetries.delete(key)
}

/**
 * The `detail` string every `ApiError` body carries, or `fallback`. Exported
 * because the clip export shows it verbatim: the 422s the trim bounds can
 * earn ("start_cs is at or past the outro cut…") are written to be read by
 * the person who dragged the marker.
 */
export function errorDetail(error: unknown, fallback: string): string {
  const detail = asRecord(error)?.detail
  return typeof detail === "string" && detail ? detail : fallback
}

/**
 * Ask for (or join) the rendition of one item.
 *
 * Deduplicated per `sha:preset`, and that includes the STICKY failure: a
 * verdict is cached for the session because the server negative-caches it too
 * (two strikes and it stops trying), so re-POSTing on every play press would
 * be a loop that costs a round trip to learn the same answer. A reload retries
 * — the store is memory, and the miss is usually a missing mount or a
 * toolchain that has since been fixed. A NON-sticky failure is treated exactly
 * like idle: nothing was learned, so the press means what it says.
 */
export function startTranscode(options: {
  sha256: string
  dbs: { index_db: string | null; user_data_db: string | null }
  preset?: string
  /**
   * Trim end in centiseconds — the hover preview's 16 s bound (V3). Rides into
   * the KEY as well as the body, because a bounded encode and a whole-file one
   * are different bytes at the same preset.
   */
  endCs?: number | null
}): string {
  const preset = options.preset ?? PLAYBACK_PRESET
  const endCs = options.endCs ?? null
  const key = transcodeKey(options.sha256, preset, endCs)
  // A key can only be un-cancelled by a fresh submit, and this is that submit:
  // clearing here rather than in `cancelTranscode` is what makes the marker
  // cover the whole window in which the settled job's late events arrive.
  cancelled.delete(key)
  if (!shouldSubmit(states.get(key))) return key
  setState(key, { state: "requesting" })
  void submitJob(key, options.sha256, preset, options.dbs, endCs)
  return key
}

/**
 * Did THIS client create the job the submit answered with, or join one that
 * was already running? Pure, so the cancel rule (V4) is node-testable.
 *
 * Anything that is not the literal `"created"` answers false — a `hit` (no job
 * at all), a `joined` (somebody else's), a `known_failure` (a job born dead),
 * and any outcome a later Server invents. False is the safe direction: it can
 * only ever mean "do not cancel".
 */
export function createdOwnJob(payload: unknown): boolean {
  const body = asRecord(payload)
  return !!body && field<SubmitResponse>(body, "outcome") === "created"
}

async function submitJob(
  key: string,
  sha256: string,
  preset: string,
  dbs: { index_db: string | null; user_data_db: string | null },
  endCs: number | null
) {
  try {
    const { data, error } = await fetchClient.POST("/api/video/transcode", {
      params: { query: { ...dbs } },
      body: {
        id: sha256,
        id_type: "sha256",
        preset,
        // Omitted rather than sent null when there is no bound: the whole file
        // is the request, and the key above says the same thing.
        ...(endCs == null ? {} : { end_cs: endCs }),
      },
    })
    // The pointer left while the POST was in flight (V4). Nothing has been
    // rendered from this exchange and the store is already back on idle, so
    // the only thing left to do is put the job the server just started back —
    // which is the same DELETE `cancelTranscode` would have issued had the id
    // existed when it ran.
    if (cancelled.has(key)) {
      const lateId = data ? jobIdFromSubmit(data) : null
      if (lateId && createdOwnJob(data)) void deleteJob(lateId)
      return
    }
    if (error || !data) {
      // A refused POST is the SERVER declining to answer, not a verdict about
      // the item: 401/429/503 all land here and all deserve another press.
      setState(key, retryableFailure(errorDetail(error, "The server refused the transcode")))
      return
    }
    const next = stateFromSubmit(data)
    setState(key, next)
    if (isTerminalState(next)) return
    const jobId = jobIdFromSubmit(data)
    if (!jobId) {
      setState(key, retryableFailure("The server sent no job id"))
      return
    }
    jobs.set(key, { id: jobId, created: createdOwnJob(data) })
    followJob(key, jobId)
  } catch {
    setState(key, retryableFailure("The transcode request failed"))
  }
}

/** The cancel request itself. Best effort: a failure changes nothing here. */
async function deleteJob(jobId: string): Promise<void> {
  try {
    await fetchClient.DELETE("/api/video/jobs/{job_id}", {
      params: { path: { job_id: jobId } },
    })
  } catch {
    // The pool ages jobs out and a cancel racing the finish is normal; there
    // is nothing a caller could do with the failure.
  }
}

/**
 * GIVE THE KEY'S JOB BACK (V4).
 *
 * Called when the pointer leaves a previewing cell, or when another cell takes
 * the single preview slot. What it does depends on who owns the job:
 *
 *   - a job THIS store created and that is still running is DELETEd, which
 *     frees the pool's key so a re-hover resubmits and gets a fresh place in
 *     the queue rather than waiting behind an encode nobody is watching;
 *   - a JOINED job is left alone entirely — it is somebody else's, and its
 *     artifact will be a cache hit for whoever comes back;
 *   - a terminal key is left alone: `done` is a cached artifact (the whole
 *     point), and a failure is a verdict, not work in progress.
 *
 * The state is returned to idle either way so the next dwell means what it
 * says, and the marker in `cancelled` is what stops the settled job's own
 * `failed` event landing as a sticky verdict about the file.
 */
export function cancelTranscode(key: string): void {
  const current = states.get(key)
  if (current && isTerminalState(current)) return
  const job = jobs.get(key)
  jobs.delete(key)
  followers.get(key)?.()
  followers.delete(key)
  // Marked even with no id yet: the POST may still be in flight, and
  // `submitJob` reads this to cancel the job it is about to be handed.
  cancelled.add(key)
  setState(key, IDLE)
  if (job?.created) void deleteJob(job.id)
}

/** Did this store create the job standing on `key`? For the tests and hosts. */
export function ownsTranscodeJob(key: string): boolean {
  return jobs.get(key)?.created === true
}

// ---- following one job -------------------------------------------------

/** `EventSource.CLOSED`, by value: the pure decision below runs in node too. */
const SSE_CLOSED = 2
/** Reconnects an ordinary blip is allowed before the poller takes over. */
const SSE_ERROR_BUDGET = 2

/**
 * What one EventSource `error` means. Pure, so the branch that matters most
 * (the one that never reconnects) is node-testable.
 *
 * A CLOSED readyState is the browser saying it has GIVEN UP: a 403 or 502, a
 * response that was not `text/event-stream`, a job id the pool has already
 * aged out. There is no reconnect coming, so waiting for a second error is
 * waiting forever — that is the whole bug this replaces. CONNECTING is the
 * ordinary blip an EventSource recovers from by itself, but only for as long
 * as the budget lasts: a relay buffering `text/event-stream` (design §10)
 * reconnects cheerfully and delivers nothing, and the poller is the only thing
 * that gets through it.
 */
export function sseErrorDisposition(options: {
  readyState: number
  consecutiveErrors: number
  terminal: boolean
}): "close" | "reconnect" | "fallback" {
  if (options.terminal) return "close"
  if (options.readyState === SSE_CLOSED) return "fallback"
  return options.consecutiveErrors >= SSE_ERROR_BUDGET ? "fallback" : "reconnect"
}

function followJob(key: string, jobId: string) {
  const url = `/api/video/jobs/${encodeURIComponent(jobId)}/events`
  if (typeof EventSource === "undefined") {
    pollJob(key, jobId)
    return
  }
  const source = new EventSource(url)
  // Registered so `cancelTranscode` can end the stream at the moment it gives
  // the job back — an EventSource left open on a cancelled job is one of the
  // origin's six HTTP/1.1 connections held for nothing, and the grid is
  // already competing for them.
  followers.set(key, () => {
    try {
      source.close()
    } catch {
      // A close() that throws must not take the cancel down with it
    }
  })
  // Consecutive errors, reset by any frame that gets through: a stream that is
  // delivering has no budget to spend.
  let errors = 0
  const close = () => {
    try {
      source.close()
    } catch {
      // A close() that throws must not take the fallback down with it
    }
  }
  source.onmessage = (event: MessageEvent) => {
    errors = 0
    const next = applyJobEventText(key, event.data as string)
    // The server ends the stream after the terminal event. Closing here is
    // not tidiness: an EventSource whose stream ends reconnects forever, and
    // the gateway speaks plain HTTP/1.1, where six connections per origin is
    // the entire budget the grid is already competing for.
    if (next && isTerminalState(next)) close()
  }
  source.onerror = () => {
    errors += 1
    const current = states.get(key)
    const action = sseErrorDisposition({
      readyState: source.readyState,
      consecutiveErrors: errors,
      terminal: current != null && isTerminalState(current),
    })
    if (action === "reconnect") return
    close()
    if (action === "fallback") pollJob(key, jobId)
  }
}

// The SSE fallback: the snapshot endpoint carries the identical envelope, so
// the only thing that changes is how often it is read.
const POLL_INTERVAL_MS = 1000
// ...and for how long. An EventSource held open through a genuinely pending
// job is by design (the server pushes when there is something to say), but a
// poll loop is a request per second forever, and a job the pool silently lost
// would keep one running for the life of the tab.
//
// Exported because the clip export waits on the SAME job through a promise
// (lib/videoClip's `awaitTerminal`), and a wait with no deadline outlives even
// the poller's: an EventSource that never delivers a terminal event would
// leave that promise — and the per-item busy guard behind it — pending
// forever. One number, so the two ways of waiting give up together.
export const POLL_TIMEOUT_MS = 10 * 60 * 1000

function pollJob(key: string, jobId: string) {
  let stopped = false
  const deadline = Date.now() + POLL_TIMEOUT_MS
  // The poller's half of the follower registration (see followJob): a cancel
  // stops the loop rather than leaving a request per second running against a
  // job nobody is waiting for.
  followers.set(key, () => {
    stopped = true
  })
  const tick = async () => {
    if (stopped) return
    // The stream may have delivered the terminal event before this loop's
    // timer came round, and a reset (evicted-artifact recovery) means this
    // loop is following a job nobody is waiting for any more.
    const current = states.get(key)
    if (current && isTerminalState(current)) return
    if (Date.now() >= deadline) {
      setState(key, retryableFailure("Gave up waiting for the transcode"))
      return
    }
    try {
      const { data, error, response } = await fetchClient.GET(
        "/api/video/jobs/{job_id}",
        { params: { path: { job_id: jobId } } }
      )
      if (response.status === 404) {
        // The pool's terminal ring is time-bounded; a job that aged out of it
        // after we lost the stream is unknowable, not failed — the encode may
        // well have landed in the cache, so another press is worth a hit.
        setState(key, retryableFailure("The transcode job is no longer available"))
        stopped = true
        return
      }
      if (!error && data) {
        const next = applyJobEvent(key, data)
        if (next && isTerminalState(next)) {
          stopped = true
          return
        }
      }
    } catch {
      // A transient failure is just a skipped sample
    }
    if (!stopped) setTimeout(() => void tick(), POLL_INTERVAL_MS)
  }
  void tick()
}

// ---- hooks -------------------------------------------------------------

/**
 * Follow ONE ALREADY-MINTED KEY.
 *
 * The hover preview's key carries a trim bound (`transcodeKey`'s third
 * segment), which `useTranscodeState` below cannot spell — and, more to the
 * point, the component that subscribes is mounted only while a preview is
 * pending, so the key it watches is a value it already holds rather than a
 * derivation. Every other surface keeps the sha-and-preset form.
 */
export function useTranscodeKeyState(key: string): TranscodeState {
  const subscribe = React.useCallback(
    (onChange: () => void) => subscribeKey(key, onChange),
    [key]
  )
  const getSnapshot = React.useCallback(
    () => states.get(key) ?? IDLE,
    [key]
  )
  return React.useSyncExternalStore(subscribe, getSnapshot, () => IDLE)
}

export function useTranscodeState(
  sha256: string | null | undefined,
  preset: string = PLAYBACK_PRESET
): TranscodeState {
  const key = sha256 ? transcodeKey(sha256, preset) : null
  const subscribe = React.useCallback(
    (onChange: () => void) => subscribeKey(key, onChange),
    [key]
  )
  const getSnapshot = React.useCallback(
    () => (key ? states.get(key) ?? IDLE : IDLE),
    [key]
  )
  return React.useSyncExternalStore(subscribe, getSnapshot, () => IDLE)
}

/**
 * Everything a player host needs to mount the right bytes for one item.
 *
 * `url` is the EFFECTIVE playback URL: the original file whenever the browser
 * can play it, the artifact once a needs-transcode item's job is done, and
 * null while there is nothing playable to mount (so the host keeps showing the
 * thumbnail and the play affordance instead of loading a file it cannot
 * decode). Downloads and drag-out never use it — those are always the original
 * file.
 */
export function useVideoPlayback(options: {
  sha256: string | null | undefined
  playability: Playability
  fileURL: string
  dbs: { index_db: string | null; user_data_db: string | null }
  preset?: string
}): {
  url: string | null
  state: TranscodeState
  badge: { text: string; error?: boolean } | null
  start: () => void
  /** True when `url` is the ARTIFACT rather than the item's own file. */
  isArtifact: boolean
  /** The element failed on the artifact: recover it once, then give up. */
  noteArtifactError: () => void
  /** The element started playing: re-arm the one automatic recovery. */
  notePlaying: () => void
} {
  const { sha256, playability, fileURL, dbs } = options
  const preset = options.preset ?? PLAYBACK_PRESET
  const state = useTranscodeState(sha256, preset)
  const needsTranscode = playability === "needs-transcode"
  const isArtifact = needsTranscode && state.state === "done"
  const url = needsTranscode
    ? state.state === "done"
      ? state.artifactUrl
      : null
    : playability === "playable"
      ? fileURL
      : null
  const start = React.useCallback(() => {
    if (!sha256 || !needsTranscode) return
    startTranscode({ sha256, dbs, preset })
  }, [sha256, needsTranscode, dbs, preset])
  // An artifact that will not load is almost always one the global disk cache
  // evicted between `done` and the fetch — the URL is still well-formed, the
  // bytes are simply gone. Re-POSTing recovers it (a hit if it was re-created,
  // a fresh job otherwise), so it is done automatically and exactly ONCE per
  // key; a second consecutive failure is something else entirely and stops
  // here as a non-sticky failure the user can retry by hand.
  const noteArtifactError = React.useCallback(() => {
    if (!sha256 || !needsTranscode) return
    const key = transcodeKey(sha256, preset)
    if (getTranscodeState(key).state !== "done") return
    if (!claimArtifactRetry(key)) {
      setState(key, retryableFailure("The rendition could not be played"))
      return
    }
    resetTranscode(sha256, preset)
    startTranscode({ sha256, dbs, preset })
  }, [sha256, needsTranscode, dbs, preset])
  const notePlaying = React.useCallback(() => {
    if (!sha256) return
    clearArtifactRetry(transcodeKey(sha256, preset))
  }, [sha256, preset])
  return {
    url,
    state,
    badge: needsTranscode ? transcodeBadge(state) : null,
    start,
    isArtifact,
    noteArtifactError,
    notePlaying,
  }
}
