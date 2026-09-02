/**
 * WHAT A HOVERED VIDEO CELL PLAYS, and what it has to ask the server for to
 * play it (docs/video-hover-preview-implementation.md V2–V4, V11).
 *
 * TWO RUNGS, and the choice between them is the browser's own answer about the
 * file rather than a policy or a guess:
 *
 *   - `"direct"` — this browser can decode the ORIGINAL (the playability
 *     ladder says `playable`), so the cell mounts a muted `<video>` on the
 *     file URL. `preload="none"` plus the director's `play()` fetches the moov
 *     atom and the first seconds over Range and nothing else, which is why
 *     this rung carries no duration, size or bitrate gate;
 *   - `"transcode"` — it cannot (`needs-transcode`, including a `playable`
 *     item this session downgraded on a decode error), so the cell asks for
 *     the `preview` preset: the first 16 seconds, silent, short side ≤ 480.
 *     Served out of the same disk cache every other transcode uses, so the
 *     second look at an item costs one cache hit;
 *   - `"none"` — the item is not a video, this browser could show neither, or
 *     the resolved capability turns the rung off. Today's still cell, with no
 *     `<video>` anywhere in the grid.
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

/** The server-side preset a hover preview asks for (V3, backend B1). */
export const PREVIEW_PRESET = "preview"

/**
 * How much of a video a preview shows. The wire wants centiseconds; the row's
 * `duration` is seconds, so both spellings of the one number live here.
 */
export const PREVIEW_MAX_SECONDS = 16
export const PREVIEW_MAX_CS = PREVIEW_MAX_SECONDS * 100

export type PreviewRung = "direct" | "transcode" | "none"

/** The trim half of the preview's `POST /api/video/transcode` body. */
export interface PreviewRequest {
  preset: typeof PREVIEW_PRESET
  /** Absent when the whole file is already inside the cap — see below. */
  end_cs?: number
}

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
export function previewRung(
  playability: Playability,
  resolved: HoverPreviewCapability
): PreviewRung {
  if (playability === "playable") return resolved.direct ? "direct" : "none"
  if (playability === "needs-transcode") {
    return resolved.transcode ? "transcode" : "none"
  }
  return "none"
}

/**
 * WHAT THE CELL POSTS. `end_cs` is present exactly when the file is longer
 * than the cap, and absent when it is not — so a 9-second clip is one key and
 * one artifact whichever surface asked for it, rather than a trimmed rendition
 * of a file that needed no trimming.
 *
 * AN UNKNOWN DURATION SENDS THE BOUND. `duration` is null on a row the probe
 * has not reached, and "we do not know how long it is" is the one case where
 * omitting the bound could hand ffmpeg a two-hour film to encode in full for a
 * thumbnail nobody asked to watch. The plan's rule reads "present iff > 16 s",
 * which is exactly this for every row that carries a duration; this is what it
 * means for the rows that do not.
 */
export function previewRequest(row: {
  duration?: number | null
}): PreviewRequest {
  const duration = row.duration
  const wholeFileFits =
    typeof duration === "number" &&
    Number.isFinite(duration) &&
    duration > 0 &&
    duration <= PREVIEW_MAX_SECONDS
  return wholeFileFits
    ? { preset: PREVIEW_PRESET }
    : { preset: PREVIEW_PRESET, end_cs: PREVIEW_MAX_CS }
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
export function cellPreviewRung(
  row: (PlayabilityItem & { sha256?: string | null }) | null | undefined,
  resolved: HoverPreviewCapability,
  canPlayType?: CanPlayType | null
): PreviewRung {
  if (!resolved.direct && !resolved.transcode) return "none"
  if (!row?.type?.startsWith("video/")) return "none"
  const verdict = videoPlayability(row, {
    // The ladder's own gate on offering a transcode at all IS this rung's
    // gate: with rung 1 off, an item this browser cannot decode is
    // `unsupported`, which `previewRung` answers with "none".
    transcodeEnabled: resolved.transcode,
    canPlayType,
  })
  const downgraded =
    verdict === "playable" && isPlaybackDowngraded(row.sha256)
      ? resolved.transcode
        ? "needs-transcode"
        : "unsupported"
      : verdict
  return previewRung(downgraded, resolved)
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
 * The caption's words come from `transcodeBadge`, the formatter the gallery's
 * play affordance already uses, so a queue position is spelled the one way in
 * both places.
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
