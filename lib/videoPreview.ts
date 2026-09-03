/**
 * WHAT A HOVERED VIDEO CELL PLAYS, and what it has to ask the server for to
 * play it (docs/video-hover-preview-implementation.md V2–V4, V11).
 *
 * THREE RUNGS, cheapest first, and the choice between them is arithmetic on
 * the row plus the browser's own answer about the file — never a guess:
 *
 *   - `"direct"` — this browser can decode the ORIGINAL (the playability
 *     ladder says `playable`) AND the whole file is within the server's byte
 *     cap, so the cell mounts a muted `<video>` on the file URL. The cap is
 *     not caution: `preload="none"` plus a `play()` was MEASURED pulling
 *     9.9 MB of a 15.7 MB clip in a three-second hover, because a media
 *     element buffers ahead as fast as the link allows and does not stop at
 *     "the first seconds";
 *   - `"trim"` — the file is too big for that, or this browser cannot open its
 *     container, but the VIDEO STREAM would play inside an mp4. The server
 *     stream-copies its first 16 seconds (`preview-trim`: `-c:v copy`, no
 *     audio, cut on a keyframe) — the item's own bytes, no re-encode, and a
 *     bounded count of them, which is what the cap is applied to;
 *   - `"transcode"` — no copy can make it playable, so the `preview` preset
 *     re-encodes the first 16 seconds silent at ≤ 480p. The only rung that
 *     costs the server real work, and the only one behind the toggle's "All";
 *   - `"none"` — the item is not a video, nothing could show it, or the
 *     resolved capability turns every rung off. Today's still cell, with no
 *     `<video>` anywhere in the grid.
 *
 * A LADDER RATHER THAN A CHOICE, because a rung can fail in ways no row field
 * predicts: a decode error on the original, an ffmpeg that refuses the mux.
 * `previewLadder` returns the rungs to try IN ORDER, and a rung that failed
 * for an item is never tried again for it this session.
 *
 * NOTHING HERE IS ASKED BEFORE THE DWELL FIRES. The rung is decided at render
 * time because it decides which PICTURE the cell plans (lib/cellPicture.ts) —
 * the 1x1 frame rather than the 2x2 mosaic, and whether a hover swap belongs
 * to a preview or to today's image swap — but the URL it names is not
 * requested, and the transcode is not submitted, until the 200 ms dwell fires.
 *
 * Pure apart from the two runtime seams at the bottom (the preview slot, which
 * is six lines of bookkeeping over lib/videoTranscode.ts's store), so
 * scripts/videopreview.test.mjs executes the decisions under plain node.
 */
import {
  isPlaybackDowngraded,
  videoCodecPlayableInMp4,
  videoPlayability,
  type CanPlayType,
  type Playability,
  type PlayabilityItem,
} from "./videoPlayability"
import {
  cancelTranscode,
  startTranscode,
  transcodeBadge,
  transcodeKey,
  type TranscodeState,
} from "./videoTranscode"
import type { HoverPreviewCapability } from "./state/hoverPreviewPref"

/** The re-encode rung's preset (V3, backend B1). */
export const PREVIEW_PRESET = "preview"

/**
 * The stream-copy rung's preset: mp4, `-c:v copy`, no audio, cut on the last
 * keyframe inside the window. Nothing is re-encoded, so it finishes in about
 * the time it takes to read the input — which is why its progress ring barely
 * shows.
 */
export const PREVIEW_TRIM_PRESET = "preview-trim"

/**
 * How much of a video a preview shows. The wire wants centiseconds; the row's
 * `duration` is seconds, so both spellings of the one number live here.
 */
export const PREVIEW_MAX_SECONDS = 16
export const PREVIEW_MAX_CS = PREVIEW_MAX_SECONDS * 100

export type PreviewRung = "direct" | "trim" | "transcode" | "none"

/** The two rungs that ask the server for something. */
export type PreviewJobRung = "trim" | "transcode"

/** The trim half of the preview's `POST /api/video/transcode` body. */
export interface PreviewRequest {
  preset: typeof PREVIEW_PRESET | typeof PREVIEW_TRIM_PRESET
  /** Absent when the whole file is already inside the cap — see below. */
  end_cs?: number
}

/** No rung: one frozen array, so an empty ladder is memo-stable as a prop. */
export const NO_PREVIEW_RUNGS: readonly PreviewRung[] = Object.freeze([])

/**
 * THE RUNG, from the ladder's verdict and the resolved capability.
 *
 * `playability` is handed in rather than derived: the ladder is a question
 * about THIS BROWSER (an injected `canPlayType`, a session downgrade set) and
 * the hosts already have the answer, while this is the one-line policy over
 * it — which is what makes the policy testable without a DOM.
 *
 * An `unsupported` verdict is `"none"` at both rungs and deliberately so: with
 * the transcode rung off, `videoPlayability` collapses `needs-transcode` into
 * `unsupported`, so the single verdict already carries the gate. Nothing here
 * re-applies it.
 */
/** Everything the ladder weighs that is not the capability. */
export interface PreviewLadderInput {
  /**
   * The playability verdict, asked with the transcode rung ENABLED so it
   * answers the true tri-state — the capability gates are applied below, once,
   * rather than being folded into the ladder's own input.
   */
  playability: Playability
  /**
   * Would this browser decode the item's video stream inside an mp4
   * (`videoCodecPlayableInMp4`)? The stream-copy rung's whole precondition.
   */
  mp4Playable: boolean
  /** The file's size in bytes. Unknown is NOT within any cap — see below. */
  size?: number | null
  /** The item's duration in seconds. Unknown never trims — see below. */
  duration?: number | null
  /** Rungs this item has already failed this session; never tried again. */
  blocked?: Iterable<PreviewRung>
}

/**
 * THE RUNGS TO TRY, IN ORDER.
 *
 * `playability` is handed in rather than derived: the ladder is a question
 * about THIS BROWSER (an injected `canPlayType`, a session downgrade set) and
 * the hosts already have the answer, while this is the policy over it — which
 * is what makes the policy testable without a DOM.
 *
 * An `unsupported` verdict is an EMPTY ladder and not a re-encode: the item
 * has no video stream to show (an audio file in a video container, or one
 * whose only "video" is cover art), so there is nothing for any rung to make
 * playable.
 *
 * `transcode` is appended whenever the capability offers it, even behind a
 * rung that is eligible right now — that is what makes it the FALLBACK when
 * the original will not decode or the mux is refused, which is the ladder's
 * whole reason for being a list.
 */
export function previewLadder(
  input: PreviewLadderInput,
  resolved: HoverPreviewCapability
): readonly PreviewRung[] {
  if (input.playability === "unsupported") return NO_PREVIEW_RUNGS
  const blocked = new Set(input.blocked ?? [])
  const rungs: PreviewRung[] = []
  if (
    resolved.direct &&
    !blocked.has("direct") &&
    input.playability === "playable" &&
    withinPreviewCap(input.size, resolved.maxBytes)
  ) {
    rungs.push("direct")
  }
  if (
    resolved.trim &&
    !blocked.has("trim") &&
    input.mp4Playable &&
    withinPreviewCap(
      previewSliceBytes(input.size, input.duration),
      resolved.maxBytes
    )
  ) {
    rungs.push("trim")
  }
  if (resolved.transcode && !blocked.has("transcode")) rungs.push("transcode")
  return rungs.length === 0 ? NO_PREVIEW_RUNGS : rungs
}

/** The first rung of the ladder above, or `"none"`. */
export function previewRung(
  input: PreviewLadderInput,
  resolved: HoverPreviewCapability
): PreviewRung {
  return previewLadder(input, resolved)[0] ?? "none"
}

/**
 * Is this byte count inside the server's ceiling?
 *
 * UNKNOWN IS NOT. A row with no `size` cannot be shown to be small, and the
 * cap exists precisely because an unbounded hover pulled two thirds of a
 * 15.7 MB file — so the honest answer for a row the scan has not measured is
 * to send it down to a rung whose cost is known. Zero is inside every cap and
 * is left alone: an empty file is not a hazard, only a boring preview.
 */
export function withinPreviewCap(
  bytes: number | null | undefined,
  maxBytes: number
): boolean {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return false
  }
  return bytes <= maxBytes
}

/**
 * HOW BIG THE STREAM COPY WILL BE, estimated the only way a client can: the
 * file's own average rate over the window the copy keeps.
 *
 * `size × min(16, duration) / duration`. It is an estimate and it is allowed
 * to be one — a variable-bitrate opening can weigh more or less than its
 * share — because the alternative is asking the server to measure every
 * hovered file before the hover means anything.
 *
 * NULL WHENEVER IT CANNOT BE COMPUTED, which is the case the rule exists for:
 * with no duration on record there is no ratio, so a two-hour film the probe
 * has not reached would otherwise be estimated at its whole weight or at
 * nothing at all. Null fails `withinPreviewCap`, so the rung stands down.
 */
export function previewSliceBytes(
  size: number | null | undefined,
  duration: number | null | undefined
): number | null {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return null
  if (
    typeof duration !== "number" ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return null
  }
  return (size * Math.min(PREVIEW_MAX_SECONDS, duration)) / duration
}

/**
 * WHAT THE CELL POSTS.
 *
 * THE RULE, EXACTLY AS IMPLEMENTED: `end_cs` is OMITTED only when the row
 * carries a finite duration greater than zero and at most 16 s; it is SENT in
 * every other case — longer than the cap, and equally when the duration is
 * null, zero, negative, NaN or Infinity.
 *
 * The omission is what makes a 9-second clip one key and one artifact
 * whichever surface asked for it, rather than a trimmed rendition of a file
 * that needed no trimming.
 *
 * The rest of the rule is a DELIBERATE WIDENING of the plan's "present iff
 * duration > 16 s" (verifier finding S6). `duration` is null on a row the
 * probe has not reached, and "we do not know how long it is" is the one case
 * where omitting the bound could hand ffmpeg a two-hour film to encode in full
 * for a thumbnail nobody asked to watch. For every row that carries a real
 * duration the two readings agree exactly.
 */
export function previewRequest(
  row: { duration?: number | null },
  /** Which rung is asking — the two presets differ, the window does not. */
  rung: PreviewJobRung = "transcode"
): PreviewRequest {
  const preset = rung === "trim" ? PREVIEW_TRIM_PRESET : PREVIEW_PRESET
  const duration = row.duration
  const wholeFileFits =
    typeof duration === "number" &&
    Number.isFinite(duration) &&
    duration > 0 &&
    duration <= PREVIEW_MAX_SECONDS
  return wholeFileFits
    ? { preset }
    : { preset, end_cs: PREVIEW_MAX_CS }
}

/** The store key one preview lands on. `end_cs` rides in it (V4). */
export function previewKey(sha256: string, request: PreviewRequest): string {
  return transcodeKey(sha256, request.preset, request.end_cs ?? null)
}

/**
 * THE CELL'S WHOLE QUESTION, in one call: is this row a video, are previews on
 * for it, and if so which rung.
 *
 * SHORT-CIRCUITED BEFORE THE PROBE, which is the point of doing it here rather
 * than in each host: `videoPlayability` reaches for a detached media element
 * and asks it about a codec string, and a grid of static images must not pay
 * that per card per render for an answer it would then throw away.
 *
 * The session DOWNGRADE set is read, never subscribed to: a `playable` item
 * whose element failed to decode in the gallery is `needs-transcode` here from
 * the next render on, and a plain `Set.has` costs the card nothing and
 * re-renders nobody (V3's "a `playable` one that downgraded").
 */
export function cellPreviewLadder(
  row: PreviewRow | null | undefined,
  resolved: HoverPreviewCapability,
  canPlayType?: CanPlayType | null
): readonly PreviewRung[] {
  if (!resolved.direct && !resolved.trim && !resolved.transcode) {
    return NO_PREVIEW_RUNGS
  }
  if (!row?.type?.startsWith("video/")) return NO_PREVIEW_RUNGS
  // Asked with the transcode rung ENABLED so the verdict is the true
  // tri-state; `previewLadder` applies the capability once, in one place.
  const playability = videoPlayability(row, {
    transcodeEnabled: true,
    canPlayType,
  })
  const blocked = new Set(previewRungFailures(row.sha256))
  // The gallery's own decode downgrade blocks the SAME rung a preview decode
  // error does — it is the same evidence about the same bytes. It does not
  // reach the stream copy: a container this browser mis-parses is exactly what
  // a remux fixes, which is why a failed `direct` falls to `trim` rather than
  // straight past it.
  if (isPlaybackDowngraded(row.sha256)) blocked.add("direct")
  return previewLadder(
    {
      playability,
      // Probed only when the rung is on offer: it is a `canPlayType` call, and
      // a grid whose policy denies the copy must not pay for the question.
      mp4Playable: resolved.trim
        ? videoCodecPlayableInMp4(row, { canPlayType })
        : false,
      size: row.size,
      duration: row.duration,
      blocked,
    },
    resolved
  )
}

/** The first rung the cell will try, or `"none"`. */
export function cellPreviewRung(
  row: PreviewRow | null | undefined,
  resolved: HoverPreviewCapability,
  canPlayType?: CanPlayType | null
): PreviewRung {
  return cellPreviewLadder(row, resolved, canPlayType)[0] ?? "none"
}

/** The row fields the ladder reads, on top of the playability ladder's. */
export type PreviewRow = PlayabilityItem & {
  sha256?: string | null
  /** Bytes, from the search row's own `size` column. */
  size?: number | null
  /** Seconds, ffprobe's. */
  duration?: number | null
}

// ---- what failed, this session ------------------------------------------
//
// A rung can fail in a way no row field predicts: the browser refuses to
// decode the original, or ffmpeg refuses the mux. Both are facts about THIS
// item and THIS session — a reload re-tests them, because the miss is usually
// a browser build or a toolchain that has since changed — so they live in a
// module map, exactly as lib/videoPlayability.ts's own downgrade set does.
//
// NEVER RETRIED, which is the rule that makes the ladder terminate: a cell
// that fell to the next rung must not climb back on its next mount and fail
// the same way again.

const rungFailures = new Map<string, Set<PreviewRung>>()

/** Record that a rung did not work for this item. */
export function notePreviewRungFailure(
  sha256: string | null | undefined,
  rung: PreviewRung
): void {
  if (!sha256 || rung === "none") return
  const bucket = rungFailures.get(sha256)
  if (bucket) bucket.add(rung)
  else rungFailures.set(sha256, new Set([rung]))
}

/** The rungs this item has already failed. Empty for one that has not. */
export function previewRungFailures(
  sha256: string | null | undefined
): ReadonlySet<PreviewRung> {
  return (sha256 ? rungFailures.get(sha256) : undefined) ?? NO_FAILURES
}

const NO_FAILURES: ReadonlySet<PreviewRung> = new Set()

/** Forget every recorded failure. For the node tests only. */
export function clearPreviewRungFailures(): void {
  rungFailures.clear()
}

/**
 * WHAT THE BADGE SAYS WHILE RUNG 1 IS PENDING (V11).
 *
 * `progress` is `"queued"` for an indeterminate sweep and 0..1 for a filling
 * ring; `null` means the badge is its ordinary self, which covers idle, done
 * and — deliberately — failed: a sticky failure shows nothing and never
 * retries in the session, because a ring that stopped and a caption naming an
 * ffmpeg error are both worse than the still frame the cell already has.
 *
 * THE CAPTIONS, EXACTLY AS IMPLEMENTED: "Queued #n" for a job that HAS a queue
 * position, and "Transcoding…" for both of the other pending states — the job
 * running, and the POST still in flight (`requesting`).
 *
 * That third case is a DELIBERATE READING of V11's two captions (verifier
 * finding S5): `requesting` is before the queue, so there is no position to
 * name, and "Queued" with no number would be a worse sentence than the one
 * that describes what is about to happen. The sweep is shared with the real
 * queued state because both are the same fact on screen — something is
 * happening and nobody can say how far along it is.
 *
 * The queue position's spelling comes from `transcodeBadge`, the formatter the
 * gallery's play affordance already uses, so it reads the one way in both.
 */
export interface PreviewFeedback {
  progress: "queued" | number
  caption: string
}

export function previewFeedback(
  state: TranscodeState
): PreviewFeedback | null {
  const badge = transcodeBadge(state)
  switch (state.state) {
    case "requesting":
      return { progress: "queued", caption: "Transcoding…" }
    case "queued":
      return { progress: "queued", caption: `Queued ${badge?.text ?? ""}`.trim() }
    case "running":
      return {
        progress: state.progress == null ? "queued" : state.progress,
        caption: "Transcoding…",
      }
    default:
      return null
  }
}

// ---- the one in-flight preview (V4) -------------------------------------
//
// ONE PREVIEW JOB PER CLIENT AT A TIME, and the slot is a module value rather
// than component state because the two cells involved in a switch never meet:
// the pointer leaves A and arrives at B, and B has to end A's job without
// knowing A exists.

let slot: string | null = null

/**
 * Claim the slot for one cell's preview and submit (or join) its job. Returns
 * the key the caller subscribes to.
 *
 * Taking the slot from another cell CANCELS that cell's job (see
 * `cancelTranscode`, which only ever gives back a job this client created), so
 * a skim across ten items leaves at most one live encode behind it.
 */
export function startPreviewTranscode(options: {
  sha256: string
  dbs: { index_db: string | null; user_data_db: string | null }
  request: PreviewRequest
}): string {
  const key = previewKey(options.sha256, options.request)
  if (slot && slot !== key) cancelTranscode(slot)
  slot = key
  startTranscode({
    sha256: options.sha256,
    dbs: options.dbs,
    preset: options.request.preset,
    endCs: options.request.end_cs ?? null,
  })
  return key
}

/**
 * Give the slot back on leave. Guarded on identity: by the time a cell's
 * effect cleanup runs, the slot may already belong to the cell the pointer
 * moved to, and releasing it then would cancel the job the user is waiting on.
 */
export function releasePreviewTranscode(key: string): void {
  if (slot !== key) return
  slot = null
  cancelTranscode(key)
}

/** The key currently holding the slot, or null. For the tests. */
export function currentPreviewKey(): string | null {
  return slot
}
