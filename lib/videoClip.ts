import React from "react"
import { fetchClient } from "@/lib/api"
import { downloadURL } from "@/lib/download"
import { FREEZE_EPS } from "@/lib/videoTrim"
import {
  PLAYBACK_PRESET,
  POLL_TIMEOUT_MS,
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
// Relative and pure on the other side, so the node scripts that import this
// module for its request math pull these in without a shim.
import {
  artifactDeliveryMode,
  fallbackFileName,
  type DeliverableArtifact,
} from "./artifactShareMeta"

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
// Long enough to actually read an ffmpeg stderr tail, and Radix pauses the
// timer while the pointer is over the toast (which copying requires anyway).
const ERROR_TOAST_MS = 30000

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
    const startCs = start == null ? null : toCs(start)
    // A ZERO start is elided, exactly as an absent one is (see below).
    return startCs != null && startCs > 0
      ? { start_cs: startCs, cut: "outro" }
      : { cut: "outro" }
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
  // A start of ZERO is elided rather than sent. The two spellings describe the
  // identical encode — ffmpeg is handed no `-ss` either way — but the server
  // hashes the request as it arrives, so `Some(0)` and `None` are two cache
  // keys for one artifact: the same clip asked for by a player parked at the
  // origin and by one that never had a start bound would be encoded twice, and
  // neither would ever hit the other's entry. The whole-file case is the one
  // most likely to be asked for both ways, which is what makes this worth a
  // branch.
  if (startCs != null && startCs > 0) request.start_cs = startCs
  if (endCs != null) request.end_cs = endCs
  // ...and once the zero is gone, a start-only trim at the origin is not a
  // trim at all: an empty request would otherwise read as `trimmed` to every
  // caller and label a whole-file re-encode a clip.
  return request.start_cs == null && request.end_cs == null ? null : request
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
 * The clip presets that SHIP. Only these get a derived label: a user-declared
 * profile carries its own, and inventing one for it would both hide the name
 * its author chose and collide with these.
 *
 * All of them, and the wording is chosen by CONTAINER rather than by id
 * — an mp4/webm row is a video ("Clip", "Re-encode"), a webp/avif row is an
 * animated image and says so. The earlier set named two of the three then
 * shipping, which meant `webp-anim` fell through to the untouched server
 * label: one row in the menu that never learned whether it was about to
 * encode a trim or the whole file, next to two that did.
 */
const BUILTIN_CLIP_PRESETS = new Set(["clip", "clip-fast", "webp-anim", "avif-anim"])

type TranscodePreset = components["schemas"]["TranscodePresetInfo"]
type PresetRow = Pick<TranscodePreset, "id" | "label" | "channel" | "container">
type TranscodeLimits = components["schemas"]["TranscodeLimits"]

/** The animated-image containers, the ones the server puts a length cap on. */
const ANIMATED_CONTAINERS: ReadonlySet<TranscodePreset["container"]> = new Set([
  "webp",
  "avif",
])

/**
 * What one clip row says. `trimmed` is whether `clipRequestFor` returned a
 * request — so a freeze-frame trim reads as untrimmed, which is the point:
 * the row does the whole-file re-encode it names, rather than sitting there
 * disabled explaining a distinction nobody asked about.
 */
export function clipRowLabel(preset: PresetRow, trimmed: boolean): string {
  if (!BUILTIN_CLIP_PRESETS.has(preset.id)) return preset.label
  if (ANIMATED_CONTAINERS.has(preset.container)) {
    // No channel split: one animated-image preset ships per container, and
    // "fast" is not a choice the user is being offered between two rows here.
    const name = preset.container === "avif" ? "Animated AVIF" : "Animated WebP"
    return trimmed ? `${name} (trimmed)` : name
  }
  const fast = preset.channel === "fast"
  if (trimmed) return fast ? "Clip (trimmed, fast)" : "Clip (trimmed)"
  return fast ? "Re-encode (fast)" : "Re-encode"
}

/**
 * How many seconds of output the rows would encode, or null when that is not
 * knowable from here.
 *
 * The same arithmetic `api/video.rs`'s `expected_output_seconds` does, and for
 * the same reason: an animated image is capped by length, so the length has to
 * be computed before a row is offered rather than discovered in a 422.
 *
 * With an end bound it is exact. Without one it is the item's own duration
 * less the start — an UPPER bound, which is the safe direction for a cap, and
 * deliberately also what a `cut: "outro"` request gets: the real cut is
 * earlier (the server resolves it from `content_end_ms`), so this may hide a
 * row that would in fact have been accepted. Hiding a row that would have
 * worked is a smaller lie than offering one that would not, and the trim the
 * user can always place makes the window knowable exactly.
 */
export function clipWindowSeconds(
  request: ClipRequest | null,
  duration: number | null | undefined,
): number | null {
  const startCs = request?.start_cs ?? 0
  if (request?.end_cs != null) {
    return Math.max(0, (request.end_cs - startCs) / 100)
  }
  if (typeof duration !== "number" || !isFinite(duration) || duration <= 0) return null
  return Math.max(0, duration - startCs / 100)
}

/**
 * Whether one preset may be offered for this window. Everything but the
 * animated-image container always may: a long mp4 is exactly what a whole-file
 * re-encode is for, and the server puts no length limit on one.
 *
 * An animated-image row is offered only when the window is both KNOWN and
 * within the server's `max_animated_image_seconds`. Unknown counts as no —
 * the server refuses an unbounded animated encode on an item whose duration it
 * has not recorded, and a row that always 422s is worse than no row.
 */
function clipRowFits(
  preset: PresetRow,
  windowSeconds: number | null,
  limits: TranscodeLimits | null,
): boolean {
  if (!ANIMATED_CONTAINERS.has(preset.container)) return true
  const limit = limits?.max_animated_image_seconds
  if (limit == null || windowSeconds == null) return false
  return windowSeconds <= limit
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
 *
 * HIDE, never disable, is also what the length cap does: an animated-image row
 * for a window over the limit simply is not there. `request` doubles as the
 * trimmed/whole-file signal the labels carry, so the two can never disagree.
 */
export function clipRows<T extends PresetRow>(
  presets: T[],
  context: {
    /** `clipRequestFor`'s answer; null is the whole file, re-encoded. */
    request: ClipRequest | null
    /** The item's recorded duration, in seconds, when the host knows it. */
    duration: number | null | undefined
    /** `useVideoPresets`' limits envelope — live config, not a mirror. */
    limits: TranscodeLimits | null
  },
): { preset: T; label: string }[] {
  const trimmed = context.request != null
  const windowSeconds = clipWindowSeconds(context.request, context.duration)
  return presets
    .filter((preset) => clipRowFits(preset, windowSeconds, context.limits))
    .map((preset) => ({ preset, label: clipRowLabel(preset, trimmed) }))
}

/**
 * The label of the web-version row. Deliberately no work-language ("fast",
 * "re-encode"): the row exists only while the bytes already do, so it names a
 * file, not a job.
 */
export const WEB_VERSION_LABEL = "Web version"

/**
 * The "Web version" row: the playable rendition the PLAYBACK path already
 * encoded, offered as a download next to "Original file". For a
 * needs-transcode item the original is by definition unplayable on the web,
 * and the clip rows would re-encode from scratch under a different cache key —
 * while a fast h264 mp4 of this very file sits in the artifact cache.
 *
 * Gated on the playback store reading `done`, which is the whole rule:
 *
 * - `done` is written ONLY by the playback path (`sha:preset` keys; the clip
 *   export keys always carry a third segment), and playback jobs are only ever
 *   started for needs-transcode items — so a playable item can never grow this
 *   row, and no separate playability input is needed.
 * - In the gallery the download menu only mounts once a needs-transcode item's
 *   rendition exists (`showVideo` requires the artifact URL), so there the row
 *   is present exactly when the menu is.
 * - A pin's context menu can open before the pin ever played; the row simply
 *   is not there yet, rather than turning into a "start an encode" row wearing
 *   an "already there" label.
 *
 * `presets` is the policy-filtered playback-surface list: a policy that
 * withholds the playback preset hides the row, per hide-don't-disable.
 *
 * The row runs through `exportClip` with `request: null` rather than linking
 * the stored artifact URL directly: the artifact lives in a global LRU, and a
 * direct `<a download>` to an evicted entry saves a 404 body as an `.mp4`. The
 * re-POST is a cache hit (instant, the near-certain case) or a fast fresh
 * job, and either way the server's own filename rides back on the answer.
 */
export function webVersionRow<T extends PresetRow>(
  presets: T[],
  playbackState: TranscodeState,
): { preset: T; label: string } | null {
  if (playbackState.state !== "done") return null
  const preset = presets.find((preset) => preset.id === PLAYBACK_PRESET)
  return preset ? { preset, label: WEB_VERSION_LABEL } : null
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

// `fallbackFileName` — the name to save the bytes under when the server sent
// none — now lives in lib/artifactShareMeta.ts, imported above: the delivery
// path needs the identical name for the identical reason (a download that
// substitutes for a copy it could not make), and one spelling of it is what
// keeps the two from drifting.

/**
 * Wait for a key to reach a terminal state, reporting every step on the way.
 *
 * Subscribes BEFORE reading, then reads once: a job that finished between the
 * POST returning and this call (a very fast encode, or a `hit` that arrived
 * as a job) is already terminal in the store, and a listener-only wait would
 * hang forever on an event that has already been delivered.
 *
 * Returns its `cancel` alongside the promise rather than resolving on a
 * deadline itself: the deadline belongs to the caller (which is the only place
 * that knows the job id to cancel), and a wait that gave up must take its
 * listener with it — the store outlives this call, and a subscription left
 * behind would keep calling `onUpdate` into a toast that is already gone.
 *
 * Exported for the pinboard's animated save (lib/pinboardAnimatedExport.ts),
 * which follows a COMPOSE job through the same store: one wait, one deadline
 * pattern, one place where a leaked subscription could be fixed.
 */
export function awaitTerminal(
  key: string,
  onUpdate: (state: TranscodeState) => void,
): { promise: Promise<TranscodeState>; cancel: () => void } {
  let unsubscribe = () => {}
  const promise = new Promise<TranscodeState>((resolve) => {
    const check = () => {
      const state = getTranscodeState(key)
      if (isTerminalState(state)) {
        unsubscribe()
        resolve(state)
        return
      }
      onUpdate(state)
    }
    unsubscribe = subscribeTranscodeKey(key, check)
    check()
  })
  return { promise, cancel: () => unsubscribe() }
}

/**
 * Whichever lands first: the work, or the deadline.
 *
 * Pure, and separated from everything it is used for, because the bug it
 * exists to prevent has no symptom until it has been running for ten minutes:
 * a promise that never settles. The timer is cleared on BOTH outcomes — a
 * ten-minute `setTimeout` left armed after a fast encode holds the event loop
 * (and, in node, the process) open for the rest of it.
 */
export function raceDeadline<T>(
  work: Promise<T>,
  ms: number,
  onDeadline: () => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onDeadline()), ms)
  })
  return Promise.race([work, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

/**
 * Stop an export the client has stopped waiting for. Fire-and-forget: nothing
 * about the toast the user is looking at depends on the answer, and a cancel
 * that fails leaves the job exactly where the timeout already found it.
 *
 * The real bound on a runaway encode is the SERVER's watchdog (the pool kills
 * a job that outlives its own limit); this is the polite half — an abandoned
 * export should not go on holding an encoder slot for ten more minutes just
 * because this tab gave up on hearing about it.
 *
 * Shared with the composition export, whose jobs are heavier still.
 */
export function abandonJob(jobId: string) {
  void fetchClient
    .DELETE("/api/video/jobs/{job_id}", { params: { path: { job_id: jobId } } })
    .catch(() => {})
}

/**
 * Export one clip: POST, follow, then DELIVER — save the bytes as a file, or
 * hand them to `deliver` (the "Copy, don't download" mode, whose deliverer is
 * hooks/artifactShare.ts's `useArtifactDelivery`).
 *
 * ALWAYS RE-POSTS, unlike the playback path's `startTranscode`, which caches
 * its verdict for the session. The two dedup rules answer different
 * questions. Playback asks "is there a rendition to mount" and re-asking
 * costs a round trip for an answer it already has; a download asks "give me
 * these bytes now", and the artifact cache is a global LRU that may well have
 * evicted them since. A re-POST is a cache lookup when they are still there
 * and a fresh job when they are not — which is exactly the difference the
 * user wants papered over. The per-item guard is what makes "always" safe.
 *
 * THE DELIVERY SEAM. Everything up to the terminal state is identical in both
 * modes — one pipeline, one busy guard, one set of error toasts — because the
 * job is the same job; only what happens to the finished artifact differs.
 * Two rules make that split clean:
 *
 *   1. THE RECEIPT BELONGS TO THE DELIVERER. A download's receipt names a
 *      file that landed in Downloads; a copy's names a clipboard, and a copy
 *      that fell back to a download says so instead. Only the deliverer knows
 *      which of those happened (its relay leg can silently become a download
 *      mid-flight), so this function dismisses its progress toast and shows
 *      nothing more. Two receipts for one press would be the alternative.
 *   2. `deliver` NEVER THROWS and never rejects — it owns its own failures —
 *      so there is no error handling around it here, and the per-item busy
 *      guard stays held until it resolves (the `await` is inside the try, the
 *      release is in the finally). A user cannot start a second export while
 *      a multi-GB relay upload of the first is still running.
 *
 * A `done` state whose `artifact` could not be parsed (an older gateway) has
 * no key to copy BY, so it falls back to the download — announced, since the
 * row that was pressed said Copy.
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
  /**
   * Copy mode. Absent (the default) saves the bytes as a file; present, the
   * finished artifact goes here instead — see the seam above. There is no
   * separate verb flag: the presence of a deliverer IS the mode.
   */
  deliver?: (artifact: DeliverableArtifact) => Promise<void>
}): Promise<void> {
  const { sha256, preset, request, rowLabel, dbs, deliver } = options
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
  // `copyText` buys the failure toast the wrap-and-scroll body and the copy
  // button: an ffmpeg stderr tail is unreadable clipped and useless
  // untranscribable.
  const fail = (detail: string) => {
    progress.dismiss()
    toast({
      title: "Clip export failed",
      description: detail,
      duration: ERROR_TOAST_MS,
      copyText: detail,
    })
  }

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
      // The wait has the SAME deadline the poll fallback does, and needs one
      // for a stronger reason: the poller gives up on its own, but an
      // EventSource that connects and then says nothing (a job the pool lost,
      // a relay that buffers the stream) leaves this promise pending forever —
      // with the per-item busy guard behind it, which would then refuse every
      // later export of this item for the life of the tab.
      const wait = awaitTerminal(key, (next) => step(clipProgressText(next)))
      state = await raceDeadline(wait.promise, POLL_TIMEOUT_MS, () => {
        wait.cancel()
        abandonJob(jobId)
        // Retryable, never sticky: nothing was learned about the ITEM here,
        // only about this exchange, so the next press means what it says.
        const timedOut: TranscodeState = {
          state: "failed",
          error: "Gave up waiting for the transcode",
          sticky: false,
        }
        setTranscodeState(key, timedOut)
        return timedOut
      })
    }
    if (state.state === "failed") {
      fail(state.error)
      return
    }
    if (state.state !== "done") {
      fail("The transcode did not finish")
      return
    }
    if (artifactDeliveryMode(state.artifact, deliver != null) === "deliver") {
      // The progress toast goes FIRST: the deliverer opens its own (a relay
      // copy has a materializing leg and an upload of its own to report), and
      // two live progress toasts for one press would stack.
      progress.dismiss()
      // Non-null by the mode above; `deliver` and `state.artifact` are exactly
      // what it tested.
      await deliver!(state.artifact!)
      return
    }
    // The SERVER's name, never a derived one (implementation plan §3 U6, as
    // superseded by S3): the artifact URL is the `key=` form, and a key knows
    // neither the source's path nor whether the request was trimmed, so the
    // only place that name can be computed is where the request still is.
    const filename = state.filename ?? fallbackFileName(sha256, preset.ext)
    downloadURL(state.artifactUrl, filename)
    // The receipt names what actually landed: a whole-file re-encode is a
    // video, not a clip, and the row that started it said so too. In copy mode
    // this line is only reachable with an unaddressable artifact, where the
    // receipt's job is to announce the substitution instead (§FIX 6: a
    // materially different outcome is said out loud, never swapped in
    // silently).
    finish(
      deliver
        ? "Can't copy this file — downloading instead"
        : request
          ? "Clip saved"
          : "Video saved",
      filename,
      RECEIPT_TOAST_MS,
    )
  } catch {
    fail("The transcode request failed")
  } finally {
    setBusy(sha256, false)
  }
}
