import React from "react"
import { fetchClient } from "@/lib/api"
// Type-only: this module must not pull the playability ladder's runtime in
// (and vice versa) — the two are composed by the hosts, not by each other.
import type { Playability } from "@/lib/videoPlayability"

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
  | { state: "done"; artifactUrl: string }
  | { state: "failed"; error: string }

const IDLE: TranscodeState = { state: "idle" }

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

/** One snapshot (SSE event or polled body) as a state, or null if unusable. */
export function stateFromEvent(payload: unknown): TranscodeState | null {
  const event = asRecord(payload)
  if (!event) return null
  switch (event.state) {
    case "queued": {
      const position = event.position
      return {
        state: "queued",
        position: typeof position === "number" && position > 0 ? position : 1,
      }
    }
    case "running": {
      const progress = event.progress
      return {
        state: "running",
        progress:
          typeof progress === "number" && isFinite(progress)
            ? Math.max(0, Math.min(1, progress))
            : null,
      }
    }
    case "done": {
      const url = asRecord(event.artifact)?.url
      // A done event with no artifact URL is a server the client cannot
      // follow; treat it as a failure rather than a permanent "running".
      if (typeof url !== "string" || !url) {
        return { state: "failed", error: "The finished rendition has no URL" }
      }
      return { state: "done", artifactUrl: url }
    }
    case "failed": {
      const error = event.error
      return {
        state: "failed",
        error: typeof error === "string" && error ? error : "The transcode failed",
      }
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
  if (!body) return { state: "failed", error: "The server sent no job" }
  if (body.outcome === "hit") {
    const url = asRecord(body.artifact)?.url
    if (typeof url === "string" && url) return { state: "done", artifactUrl: url }
    return { state: "failed", error: "The cached rendition has no URL" }
  }
  return stateFromEvent(body.job) ?? { state: "failed", error: "The server sent no job" }
}

/** The job id to follow, when the submit created or joined one. */
export function jobIdFromSubmit(payload: unknown): string | null {
  const id = asRecord(asRecord(payload)?.job)?.id
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

function keyFor(sha256: string, preset: string): string {
  return `${sha256}:${preset}`
}

function setState(key: string, next: TranscodeState) {
  states.set(key, next)
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

function errorDetail(error: unknown, fallback: string): string {
  const detail = asRecord(error)?.detail
  return typeof detail === "string" && detail ? detail : fallback
}

/**
 * Ask for (or join) the rendition of one item.
 *
 * Deduplicated per `sha:preset`, and that includes the TERMINAL states: a
 * `failed` verdict is cached for the session because the server negative-
 * caches it too (two strikes and it stops trying), so re-POSTing on every play
 * press would be a loop that costs a round trip to learn the same answer. A
 * reload retries — the store is memory, and the miss is usually a missing
 * mount or a toolchain that has since been fixed.
 */
export function startTranscode(options: {
  sha256: string
  dbs: { index_db: string | null; user_data_db: string | null }
  preset?: string
}) {
  const preset = options.preset ?? PLAYBACK_PRESET
  const key = keyFor(options.sha256, preset)
  const current = states.get(key)
  if (current && current.state !== "idle") return
  setState(key, { state: "requesting" })
  void submitJob(key, options.sha256, preset, options.dbs)
}

async function submitJob(
  key: string,
  sha256: string,
  preset: string,
  dbs: { index_db: string | null; user_data_db: string | null }
) {
  try {
    const { data, error } = await fetchClient.POST("/api/video/transcode", {
      params: { query: { ...dbs } },
      body: { id: sha256, id_type: "sha256", preset },
    })
    if (error || !data) {
      setState(key, {
        state: "failed",
        error: errorDetail(error, "The server refused the transcode"),
      })
      return
    }
    const next = stateFromSubmit(data)
    setState(key, next)
    if (isTerminalState(next)) return
    const jobId = jobIdFromSubmit(data)
    if (!jobId) {
      setState(key, { state: "failed", error: "The server sent no job id" })
      return
    }
    followJob(key, jobId)
  } catch {
    setState(key, { state: "failed", error: "The transcode request failed" })
  }
}

// ---- following one job -------------------------------------------------

function followJob(key: string, jobId: string) {
  const url = `/api/video/jobs/${encodeURIComponent(jobId)}/events`
  if (typeof EventSource === "undefined") {
    pollJob(key, jobId)
    return
  }
  const source = new EventSource(url)
  // Errors are only fatal in pairs. One is the ordinary transport blip an
  // EventSource reconnects through by itself; a SECOND with no event in
  // between means the stream is not getting here at all (a relay or proxy
  // buffering `text/event-stream` is the known case, design §10) and no
  // number of further reconnects will change that.
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
    let payload: unknown
    try {
      payload = JSON.parse(event.data as string)
    } catch {
      return
    }
    const next = stateFromEvent(payload)
    if (!next) return
    setState(key, next)
    // The server ends the stream after the terminal event. Closing here is
    // not tidiness: an EventSource whose stream ends reconnects forever, and
    // the gateway speaks plain HTTP/1.1, where six connections per origin is
    // the entire budget the grid is already competing for.
    if (isTerminalState(next)) close()
  }
  source.onerror = () => {
    const current = states.get(key)
    if (current && isTerminalState(current)) {
      close()
      return
    }
    errors += 1
    if (errors < 2) return
    close()
    pollJob(key, jobId)
  }
}

// The SSE fallback: the snapshot endpoint carries the identical envelope, so
// the only thing that changes is how often it is read.
const POLL_INTERVAL_MS = 1000

function pollJob(key: string, jobId: string) {
  let stopped = false
  const tick = async () => {
    if (stopped) return
    try {
      const { data, error, response } = await fetchClient.GET(
        "/api/video/jobs/{job_id}",
        { params: { path: { job_id: jobId } } }
      )
      if (response.status === 404) {
        // The pool's terminal ring is time-bounded; a job that aged out of it
        // after we lost the stream is unknowable, not running.
        setState(key, {
          state: "failed",
          error: "The transcode job is no longer available",
        })
        stopped = true
        return
      }
      if (!error && data) {
        const next = stateFromEvent(data)
        if (next) {
          setState(key, next)
          if (isTerminalState(next)) {
            stopped = true
            return
          }
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

export function useTranscodeState(
  sha256: string | null | undefined,
  preset: string = PLAYBACK_PRESET
): TranscodeState {
  const key = sha256 ? keyFor(sha256, preset) : null
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
} {
  const { sha256, playability, fileURL, dbs } = options
  const preset = options.preset ?? PLAYBACK_PRESET
  const state = useTranscodeState(sha256, preset)
  const needsTranscode = playability === "needs-transcode"
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
  return {
    url,
    state,
    badge: needsTranscode ? transcodeBadge(state) : null,
    start,
  }
}
