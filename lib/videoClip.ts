import React from "react"
import { fetchClient } from "@/lib/api"
import { downloadURL } from "@/lib/download"
import { FREEZE_EPS } from "@/lib/videoTrim"
import {
  errorDetail,
  followTranscodeJob,
  getTranscodeState,
  isTerminalState,
  jobIdFromSubmit,
  setTranscodeState,
  stateFromSubmit,
  subscribeTranscodeKey,
  type TranscodeState,
} from "@/lib/videoTranscode"
import { toast } from "@/components/ui/use-toast"
// Type-only for the reason lib/videoTranscode.ts documents: `@/lib/panoptikon`
// is a .d.ts, and `@/lib/pinboardCrop` exports TrimRange as a type — a VALUE
// import of either is a runtime module the node test scripts cannot resolve.
import type { components } from "@/lib/panoptikon"
import type { TrimRange } from "@/lib/pinboardCrop"

// Clip export (docs/video-transcoding-implementation.md §3 U2): ask the server
// for a rendition of one item — optionally trimmed — follow the job, and hand
// the finished bytes to the browser as a download.
//
// The exchange is the SAME one lib/videoTranscode.ts runs for playback, and
// deliberately shares its store, its EventSource and its poll fallback. Only
// three things differ, and they are what this module is:
//
//   1. the request carries TRIM BOUNDS, so the store key must too (see
//      `clipStoreKey`);
//   2. the answer is a DOWNLOAD rather than a `src`, so it is one-shot and
//      always re-POSTs (see `exportClip`);
//   3. the progress is USER-FACING, so it rides a toast instead of a badge.

/** Ceiling for the in-progress toast; it is dismissed on every real outcome. */
const PROGRESS_TOAST_MS = 10 * 60 * 1000
const RECEIPT_TOAST_MS = 4000
const ERROR_TOAST_MS = 6000

// ---- the request (pure) -------------------------------------------------

/** The trim half of `POST /api/video/transcode`'s body. */
export type ClipRequest = {
  start_cs?: number
  end_cs?: number
  /** The server-side outro cut. Excludes `end_cs`; composes with `start_cs`. */
  cut?: "outro"
}

/** Seconds on the trim codec's lattice, as the wire's centiseconds. */
function toCs(seconds: number): number {
  return Math.round(seconds * 100)
}

/**
 * The freeze band, in CENTISECONDS — `api/video.rs`'s `FREEZE_GUARD_CS`, and
 * derived from `FREEZE_EPS` so the two cannot drift apart by hand.
 *
 * Applied to the converted bounds rather than to the seconds, unlike
 * `useVideoTrim`'s otherwise identical `end - start <= FREEZE_EPS`. That
 * comparison runs in floats, where a window of exactly two centiseconds does
 * not reliably read as one: `3.02 - 3` is 0.020000000000000018, which clears
 * FREEZE_EPS by a rounding error and would send the server a window it
 * rejects with a 422. The bounds are on the centisecond lattice already
 * (trimWithBound rounds every one of them), so comparing there is both exact
 * and the same arithmetic the server does — a row can no longer offer a clip
 * the server will refuse.
 *
 * The playback and export predicates therefore differ on exactly one input: a
 * two-centisecond window, which plays as a very short loop but exports as a
 * whole-file re-encode instead of an error. That is the right way round —
 * "no disabled ghosts" (§3 U3), and a still belongs to the pinboard's save.
 */
const FREEZE_GUARD_CS = Math.round(FREEZE_EPS * 100)

/**
 * What to ask the server for, given what the player is currently doing.
 *
 * `trim` is the USER's own trim; `effective` is what the player enforces
 * (lib/videoTrim's `effectiveVideoTrim`, i.e. the user's trim with the outro
 * cut standing in for an absent end bound); `outroGoverns` is
 * `outroSkipGoverns` for the same three inputs. Null means "nothing to trim"
 * — the caller offers a whole-file re-encode instead.
 *
 * THE OUTRO IS NAMED, NOT MEASURED. When the outro default governs, the
 * request carries `cut: "outro"` and the client's own cut point is discarded,
 * however carefully it was computed. The player's number lives in the
 * BROWSER's timeline and is corrected for it (a midpoint anchor, an rVFC end
 * probe — docs/video-outro-skip-design.md §1); ffmpeg reads the file's own
 * timeline, where those corrections would move the cut off the frame the
 * content actually ends on. The server re-derives the boundary from the same
 * `content_end_ms` with the same 60 ms guard and no correction at all, which
 * is the frame-exact answer there. It is also what makes an outro clip and
 * the identical hand-trimmed one ONE cached artifact.
 *
 * A user END bound is always explicit, even on an outro-eligible item —
 * `outroSkipGoverns` is false whenever `trim.end` is set, so that case simply
 * falls through to the branch below. Someone who trimmed into the outro on
 * purpose gets the clip they asked for.
 */
export function clipRequestFor(
  trim: TrimRange | null,
  effective: TrimRange | null,
  outroGoverns: boolean,
): ClipRequest | null {
  if (outroGoverns) {
    // `trim.start`, not `effective.start`: the two are equal here by
    // construction (the default only ever supplies an END), and reading the
    // user's own bound is what the rule means.
    const start = trim?.start ?? null
    return start != null ? { start_cs: toCs(start), cut: "outro" } : { cut: "outro" }
  }
  const start = effective?.start ?? null
  const end = effective?.end ?? null
  if (start == null && end == null) return null
  const startCs = start == null ? null : toCs(start)
  const endCs = end == null ? null : toCs(end)
  // The freeze band: a window this narrow is a still that happens to be
  // spelled as a range. The server rejects it with a 422 pointing at the
  // pinboard's still-image save; there is no reason to spend a round trip
  // learning that, and no reason to show a disabled ghost either — the caller
  // reads null as "offer the untrimmed rows".
  if (endCs != null && endCs - (startCs ?? 0) <= FREEZE_GUARD_CS) return null
  const request: ClipRequest = {}
  if (startCs != null) request.start_cs = startCs
  if (endCs != null) request.end_cs = endCs
  return request
}

/**
 * The store key for one clip job. The playback store keys on `sha:preset`,
 * which is exactly right there (one item has one playable rendition) and
 * exactly wrong here: two different clips of one item under one preset are
 * two different artifacts, and sharing a key would make the second export
 * silently download the first one's bytes.
 *
 * So the key gains a THIRD segment naming the window. The playback keys never
 * have one, so the two namespaces cannot collide — which is what lets both
 * live in one map with one SSE implementation.
 */
export function clipStoreKey(
  sha256: string,
  presetId: string,
  request: ClipRequest | null,
): string {
  const parts: string[] = []
  if (request?.start_cs != null) parts.push(`s${request.start_cs}`)
  if (request?.cut) parts.push(request.cut)
  else if (request?.end_cs != null) parts.push(`e${request.end_cs}`)
  return `${sha256}:${presetId}:${parts.join("") || "full"}`
}

// ---- row labels (pure) --------------------------------------------------

/**
 * The two clip presets that ship. Only these get a derived label: a
 * user-declared profile carries its own, and inventing one for it would both
 * hide the name its author chose and collide with these.
 */
const BUILTIN_CLIP_PRESETS = new Set(["clip", "clip-fast"])

type TranscodePreset = components["schemas"]["TranscodePresetInfo"]
type PresetRow = Pick<TranscodePreset, "id" | "label" | "channel">

/**
 * What one clip row says. `trimmed` is whether `clipRequestFor` returned a
 * request — so a freeze-frame trim reads as untrimmed, which is the point:
 * the row does the whole-file re-encode it names, rather than sitting there
 * disabled explaining a distinction nobody asked about.
 */
export function clipRowLabel(preset: PresetRow, trimmed: boolean): string {
  if (!BUILTIN_CLIP_PRESETS.has(preset.id)) return preset.label
  const fast = preset.channel === "fast"
  if (trimmed) return fast ? "Clip (trimmed, fast)" : "Clip (trimmed)"
  return fast ? "Re-encode (fast)" : "Re-encode"
}

/**
 * The rows one clip menu shows, in the server's own order. Shared by the
 * player surface's download menu and the pin context menu so the two can
 * never drift.
 *
 * An empty `presets` yields no rows AT ALL, which is the whole capability
 * story: the presets hook fetches nothing without the capability and the
 * server filters the table by the matched policy, so "off" and "this policy
 * offers no clip preset" both arrive here as an empty array — and the callers
 * render no menu rather than a disabled one.
 */
export function clipRows<T extends PresetRow>(
  presets: T[],
  trimmed: boolean,
): { preset: T; label: string }[] {
  return presets.map((preset) => ({ preset, label: clipRowLabel(preset, trimmed) }))
}

/** The one-line description the progress toast carries while a job runs. */
export function clipProgressText(state: TranscodeState): string {
  switch (state.state) {
    case "queued":
      return state.position > 1 ? `Queued — #${state.position}` : "Queued"
    case "running":
      return state.progress == null
        ? "Encoding…"
        : `Encoding — ${Math.round(state.progress * 100)}%`
    case "done":
      return "Saving…"
    default:
      return "Contacting the server"
  }
}

// ---- the per-item busy guard --------------------------------------------
//
// MODULE scope, for the reason lib/menuGuard.ts documents at length: Radix
// unmounts a context menu the instant a row is selected, so a useState flag
// would be destroyed by the very click it guards. Unlike menuGuard's single
// flag this one is KEYED — by the full sha256, so a second export of a
// DIFFERENT item is never blocked by the first — and it is checked and set
// synchronously at the top of `exportClip`, cleared in its finally.
//
// Per ITEM rather than per (item, preset, window): the two exports it stops
// are a double-click on one row and a race between two rows of the same menu,
// and both are the same accident. A user who genuinely wants two clips of one
// video waits for the first.

const busy = new Set<string>()
const busyListeners = new Map<string, Set<() => void>>()

function setBusy(sha256: string, value: boolean) {
  if (value) busy.add(sha256)
  else busy.delete(sha256)
  const bucket = busyListeners.get(sha256)
  if (bucket) for (const listener of bucket) listener()
}

/** Synchronous read, for the check-and-set at the top of the action. */
export function isClipBusy(sha256: string): boolean {
  return busy.has(sha256)
}

/** Subscribed read, so menu rows re-render themselves disabled. */
export function useClipBusy(sha256: string | null | undefined): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      if (!sha256) return () => {}
      let bucket = busyListeners.get(sha256)
      if (!bucket) {
        bucket = new Set()
        busyListeners.set(sha256, bucket)
      }
      bucket.add(onChange)
      return () => {
        bucket.delete(onChange)
        if (bucket.size === 0) busyListeners.delete(sha256)
      }
    },
    [sha256],
  )
  const getSnapshot = React.useCallback(
    () => (sha256 ? busy.has(sha256) : false),
    [sha256],
  )
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false)
}

// ---- the export ---------------------------------------------------------

/**
 * The name to save the bytes under when the server sent none. Only reachable
 * against a gateway older than the `ArtifactRef.filename` field, or a payload
 * the defensive parse could not read — never in normal operation, which is
 * why it does not try to be a good name. The extension matters (the
 * `download` attribute IS the filename, and an extensionless one lands as a
 * file nothing will open); the stem only has to be unambiguous.
 */
function fallbackFileName(sha256: string, ext: string): string {
  return `${sha256.slice(0, 10)}-clip.${ext}`
}

/**
 * Wait for a key to reach a terminal state, reporting every step on the way.
 *
 * Subscribes BEFORE reading, then reads once: a job that finished between the
 * POST returning and this call (a very fast encode, or a `hit` that arrived
 * as a job) is already terminal in the store, and a listener-only wait would
 * hang forever on an event that has already been delivered.
 */
function awaitTerminal(
  key: string,
  onUpdate: (state: TranscodeState) => void,
): Promise<TranscodeState> {
  return new Promise((resolve) => {
    const check = () => {
      const state = getTranscodeState(key)
      if (isTerminalState(state)) {
        unsubscribe()
        resolve(state)
        return
      }
      onUpdate(state)
    }
    const unsubscribe = subscribeTranscodeKey(key, check)
    check()
  })
}

/**
 * Export one clip: POST, follow, download, receipt.
 *
 * ALWAYS RE-POSTS, unlike the playback path's `startTranscode`, which caches
 * its verdict for the session. The two dedup rules answer different
 * questions. Playback asks "is there a rendition to mount" and re-asking
 * costs a round trip for an answer it already has; a download asks "give me
 * these bytes now", and the artifact cache is a global LRU that may well have
 * evicted them since. A re-POST is a cache lookup when they are still there
 * and a fresh job when they are not — which is exactly the difference the
 * user wants papered over. The per-item guard is what makes "always" safe.
 */
export async function exportClip(options: {
  sha256: string
  /** The preset row this came from; `ext` names the fallback download. */
  preset: components["schemas"]["TranscodePresetInfo"]
  /** `clipRequestFor`'s answer. Null asks for the whole file, re-encoded. */
  request: ClipRequest | null
  /** The row's own label, so the toasts name what was pressed. */
  rowLabel: string
  dbs: { index_db: string | null; user_data_db: string | null }
}): Promise<void> {
  const { sha256, preset, request, rowLabel, dbs } = options
  if (isClipBusy(sha256)) return
  setBusy(sha256, true)

  const key = clipStoreKey(sha256, preset.id, request)
  // Idle first, so the re-POST above is not swallowed by a terminal state a
  // previous export of the SAME window left behind.
  setTranscodeState(key, { state: "idle" })
  // The row's own label, verbatim: a user-declared profile's name is a proper
  // noun ("Instagram 1080") and case-folding it would be a small lie about
  // what was pressed.
  const progress = toast({
    title: `Preparing ${rowLabel}…`,
    description: "Contacting the server",
    duration: PROGRESS_TOAST_MS,
  })
  const step = (description: string) =>
    progress.update({ id: progress.id, description })
  // Terminal toasts REPLACE the progress one rather than mutating it: a
  // dismiss-and-reissue is the pattern PinboardExportMenu already proves out,
  // and it re-arms the auto-dismiss timer that an in-place duration change
  // would leave sitting at ten minutes.
  const finish = (title: string, description: string, duration: number) => {
    progress.dismiss()
    toast({ title, description, duration })
  }
  const fail = (detail: string) =>
    finish("Clip export failed", detail, ERROR_TOAST_MS)

  try {
    const { data, error } = await fetchClient.POST("/api/video/transcode", {
      params: { query: { ...dbs } },
      body: { id: sha256, id_type: "sha256", preset: preset.id, ...request },
    })
    if (error || !data) {
      // Shown VERBATIM: the 422s a trim can earn are written for the person
      // who dragged the marker ("start_cs is at or past the outro cut: there
      // is no clip between them. Move the start bound back"), and a 404 on an
      // outro cut names the one fact that explains an empty menu row.
      fail(errorDetail(error, "The server refused the transcode"))
      return
    }
    let state = stateFromSubmit(data)
    if (!isTerminalState(state)) {
      const jobId = jobIdFromSubmit(data)
      if (!jobId) {
        fail("The server sent no job id")
        return
      }
      setTranscodeState(key, state)
      followTranscodeJob(key, jobId)
      state = await awaitTerminal(key, (next) => step(clipProgressText(next)))
    }
    if (state.state === "failed") {
      fail(state.error)
      return
    }
    if (state.state !== "done") {
      fail("The transcode did not finish")
      return
    }
    // The SERVER's name, never a derived one (implementation plan §3 U6, as
    // superseded by S3): the artifact URL is the `key=` form, and a key knows
    // neither the source's path nor whether the request was trimmed, so the
    // only place that name can be computed is where the request still is.
    const filename = state.filename ?? fallbackFileName(sha256, preset.ext)
    downloadURL(state.artifactUrl, filename)
    finish("Clip saved", filename, RECEIPT_TOAST_MS)
  } catch {
    fail("The transcode request failed")
  } finally {
    setBusy(sha256, false)
  }
}
