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
import { FREEZE_EPS, OUTRO_GUARD_MS, outroCutPoint } from "./videoTrim"

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

/**
 * The `cut` a preview request names when the item's detected outro governs
 * its end (docs/video-outro-skip-design.md; the clip route's own spelling).
 * NAMED, NOT MEASURED: the server resolves it from `content_end_ms` on the
 * file's own timeline and takes the earlier of it and `end_cs`, so the
 * artifact's key moves exactly when the cut does — an outro past the 16 s
 * window resolves to the window's own key, one inside it to a key of its own.
 */
export const PREVIEW_CUT_OUTRO = "outro" as const

export type PreviewRung = "direct" | "trim" | "transcode" | "none"

/** The two rungs that ask the server for something. */
export type PreviewJobRung = "trim" | "transcode"

/** The trim half of the preview's `POST /api/video/transcode` body. */
export interface PreviewRequest {
  preset: typeof PREVIEW_PRESET | typeof PREVIEW_TRIM_PRESET
  /** Absent when the whole file is already inside the cap — see below. */
  end_cs?: number
  /** Present when the outro governs the end — see `previewOutroCut`. */
  cut?: typeof PREVIEW_CUT_OUTRO
}

/** No rung: one frozen array, so an empty ladder is memo-stable as a prop. */
export const NO_PREVIEW_RUNGS: readonly PreviewRung[] = Object.freeze([])

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
  /**
   * Where the item's detected outro cuts it, in seconds, when that governs
   * the preview (`previewOutroCut`); null otherwise. Shortens the window the
   * stream-copy rung is measured over — never lengthens it.
   */
  outroCutSec?: number | null
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
      previewSliceBytes(input.size, input.duration, input.outroCutSec),
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
 * `size × min(16, outro cut, duration) / duration`. It is an estimate and it
 * is allowed to be one — a variable-bitrate opening can weigh more or less
 * than its share — because the alternative is asking the server to measure
 * every hovered file before the hover means anything.
 *
 * THE OUTRO CUT SHORTENS THE WINDOW, which is what lets a short TikTok take
 * the copy at all: a 12 s file with an 8 s cut was "inside the window whole"
 * before, i.e. its whole weight, and over the cap meant straight to the
 * encoder; two thirds of it may well fit.
 *
 * NULL WHENEVER IT CANNOT BE COMPUTED, which is the case the rule exists for:
 * with no duration on record there is no ratio, so a two-hour film the probe
 * has not reached would otherwise be estimated at its whole weight or at
 * nothing at all. Null fails `withinPreviewCap`, so the rung stands down.
 */
export function previewSliceBytes(
  size: number | null | undefined,
  duration: number | null | undefined,
  outroCutSec?: number | null
): number | null {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return null
  if (
    typeof duration !== "number" ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return null
  }
  const cut =
    typeof outroCutSec === "number" && Number.isFinite(outroCutSec) && outroCutSec > 0
      ? outroCutSec
      : Number.POSITIVE_INFINITY
  return (size * Math.min(PREVIEW_MAX_SECONDS, cut, duration)) / duration
}

/**
 * WHERE THE OUTRO CUTS THIS ITEM FOR A PREVIEW, in seconds — or null when
 * nothing about the row lets the outro govern.
 *
 * The client's HALF of the server's rule (`api/video.rs`), asked BEFORE the
 * request so that naming an outro the server would 404 is a stale-row race
 * and not a routine. The server's three refusals, MIRRORED EXACTLY, in its
 * order:
 *
 *   1. `usable_outro_cut_cs`: no recorded boundary, or a boundary at or past
 *      the item's duration (no card to cut). The server compares against ANY
 *      recorded duration — `Some(0.0)` and a negative included, which every
 *      boundary is "at or past" — and takes the boundary at face value only
 *      when the row has none. So does this: a `duration` of 0 answers null
 *      here even though `outroCutPoint` would have treated it as unknown;
 *   2. `outro_cut_cs`: `floor((content_end_ms − 60) / 10)` — a FLOOR, where
 *      the player's own arithmetic rounds;
 *   3. `validate_bounds(None, Some(cut))`: that centisecond must be more than
 *      `FREEZE_GUARD_CS` (2) past a start of zero, or the clip is a freeze
 *      frame and the handler 404s. A boundary of 85..89 ms rounds to 3 cs on
 *      the client and floors to 2 on the server — a cut the client would have
 *      named and the server refused, which is exactly the routine this
 *      function exists to prevent.
 *
 * Null from any of them means the request names no cut at all. The
 * preference gates it first, so a viewer who turned outro skip off previews
 * the card exactly as the gallery would play it.
 *
 * THE NUMBER RETURNED IS STILL THE CLIENT'S: `outroCutPoint`'s rounded,
 * start-anchored cut (and its own freeze-band verdict stands too). That is
 * what the copy rung's size estimate and the browser-side loop consume; the
 * server's floored centisecond is computed here only to predict its answer.
 *
 * START-ANCHORED ON PURPOSE. At plan time there is no element, so no browser
 * duration to split the difference with; the number is used for the copy
 * rung's size estimate and for whether to name the cut, and the server
 * measures the real one. The direct rung refines it against its own element
 * once metadata arrives (the picture's own layer).
 */
export function previewOutroCut(
  row: { content_end_ms?: number | null; duration?: number | null },
  outroSkip: boolean
): number | null {
  if (!outroSkip) return null
  const contentEndMs = row.content_end_ms
  if (typeof contentEndMs !== "number" || !Number.isFinite(contentEndMs)) {
    return null
  }
  const duration = row.duration
  // Any recorded duration, zero and negative included — the server's
  // `is_some_and`, not `outroCutPoint`'s "zero is unknown".
  if (
    typeof duration === "number" &&
    !Number.isNaN(duration) &&
    contentEndMs / 1000 >= duration
  ) {
    return null
  }
  if (serverOutroCutCs(contentEndMs) <= SERVER_FREEZE_GUARD_CS) return null
  return outroCutPoint(contentEndMs, duration)
}

/**
 * The centisecond the SERVER will cut at for this boundary — `outro_cut_cs` in
 * `api/video.rs`, guard then floor. `Math.floor` is `div_euclid` for a
 * positive divisor, negatives included.
 */
function serverOutroCutCs(contentEndMs: number): number {
  return Math.floor((contentEndMs - OUTRO_GUARD_MS) / 10)
}

/**
 * The server's `FREEZE_GUARD_CS`, which its own doc derives from the player's
 * `FREEZE_EPS` (0.02 s → 2 cs) — derived the same way here so the two cannot
 * drift apart silently. `validate_bounds` refuses a window at or below it.
 */
const SERVER_FREEZE_GUARD_CS = Math.round(FREEZE_EPS * 100)

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
 *
 * THE OUTRO rides alongside, never instead: when `outroCutSec` is set the
 * body also names `cut: "outro"`, and the server ends the preview at the
 * earlier of the cut and `end_cs`. The window rule above is untouched by it
 * — a 12 s file with an 8 s cut sends the cut and no `end_cs`, a 30 s file
 * with a 26 s cut sends both and resolves to the window — so the request's
 * shape, and with it the key, changes only for the items whose preview does.
 */
export function previewRequest(
  row: { duration?: number | null },
  /** Which rung is asking — the two presets differ, the window does not. */
  rung: PreviewJobRung = "transcode",
  /** `previewOutroCut`'s answer for the row; null names no cut. */
  outroCutSec?: number | null
): PreviewRequest {
  const preset = rung === "trim" ? PREVIEW_TRIM_PRESET : PREVIEW_PRESET
  const duration = row.duration
  const wholeFileFits =
    typeof duration === "number" &&
    Number.isFinite(duration) &&
    duration > 0 &&
    duration <= PREVIEW_MAX_SECONDS
  const cut = outroCutSec != null ? { cut: PREVIEW_CUT_OUTRO } : {}
  return wholeFileFits
    ? { preset, ...cut }
    : { preset, end_cs: PREVIEW_MAX_CS, ...cut }
}

/**
 * The store key one preview lands on. `end_cs` and the cut both ride in it
 * (V4): the server resolves the cut into the artifact's own key, but the
 * client has to tell a capped-and-cut request from a merely capped one
 * before any answer arrives — and the preference flipping must land the next
 * hover on a different slot, not on the other setting's job.
 *
 * THE CUT SEGMENT CARRIES THE ROW'S BOUNDARY, not the wire's literal:
 * `sha:preview-trim:e1600:outro8005`, `sha:preview:outro8005`. Two reasons,
 * both about the slot outliving the row:
 *
 *   - a `done` slot is never forgotten this session, and the server resolves
 *     `"outro"` against the row it holds at request time. A boundary that
 *     MOVES in-session — re-detection, a re-search after the detector ran —
 *     would mint a new key on the server but, under a literal-only segment,
 *     replay the old artifact from the client's slot without ever asking. The
 *     boundary in the segment makes the change a fresh request;
 *   - `sha:preview:outro` is byte for byte `clipStoreKey(sha, "preview",
 *     {cut: "outro"})` (lib/videoClip.ts), and the two namespaces share one
 *     store on the promise that they never meet (lib/videoTranscode.ts, the
 *     seam's header). With the boundary appended they cannot.
 *
 * The raw `content_end_ms` and not the derived cut, because it is the row
 * value that changes when the detector's answer does; and no segment at all
 * without a cut, so an uncut request's key is byte-identical to the one it
 * had before the outro feature existed. The wire body is untouched by any of
 * this: it still says `cut: "outro"` and lets the server resolve it.
 */
export function previewKey(
  sha256: string,
  request: PreviewRequest,
  /** The row's `content_end_ms`; read only when the request names the cut. */
  contentEndMs?: number | null
): string {
  return transcodeKey(
    sha256,
    request.preset,
    request.end_cs ?? null,
    previewCutKey(request, contentEndMs)
  )
}

/**
 * The cut's key segment for one request: `outro<content_end_ms>` when the
 * request names the cut, nothing when it does not. A request that names the
 * cut always has a finite boundary behind it (`previewOutroCut` is the only
 * source of both), so the boundary is spelled as it comes; a caller that
 * somehow names the cut without one still cannot land on the bare literal.
 */
export function previewCutKey(
  request: PreviewRequest,
  contentEndMs?: number | null
): string | null {
  return request.cut ? `${PREVIEW_CUT_OUTRO}${contentEndMs}` : null
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
  canPlayType?: CanPlayType | null,
  /**
   * The viewer's outro-skip preference (`useOutroSkipEnabled`), read once
   * per surface and handed down like the capability. False when omitted: a
   * surface that says nothing plans exactly the ladder it always did.
   */
  outroSkip = false
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
      outroCutSec: previewOutroCut(row, outroSkip),
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
  /** The detected outro boundary, ms; null when none or detection is off. */
  content_end_ms?: number | null
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

/**
 * THE RUNGS ONE ARM WILL WALK: the host's plan, minus whatever this item has
 * already failed.
 *
 * TWO SUBTRACTIONS THAT MUST NOT COMPOUND, and this is the whole of that rule.
 * `cellPreviewLadder` subtracts the session map at PLAN time, and the host
 * re-plans on any render — one lands a couple of milliseconds after a failure,
 * because publishing the badge's progress sets host state. A walker that also
 * advanced an INDEX into the live plan would therefore subtract the failed
 * rung twice and land one PAST its fallback: on a two-rung ladder that is
 * `undefined`, i.e. the cell falls off the end and shows nothing for the rest
 * of the session, and on a three-rung one it skips the middle rung after
 * creating and cancelling a real job for it (verifier round 2, §4).
 *
 * So the arm takes ONE SNAPSHOT and walks that. The map still decides where
 * the NEXT arm begins — which is what "never retry a failed rung" is made of —
 * but it can no longer move the ground under an arm in progress.
 *
 * Taken from the map rather than trusting the plan's own subtraction, because
 * the plan may be a render old: a failure recorded by the previous arm reaches
 * this one whether or not the card has re-rendered since.
 */
export function previewArmLadder(
  rungs: readonly PreviewRung[],
  failed: ReadonlySet<PreviewRung>
): readonly PreviewRung[] {
  const walk = rungs.filter((rung) => rung !== "none" && !failed.has(rung))
  return walk.length === 0 ? NO_PREVIEW_RUNGS : walk
}

/** The rung at `step`, or `"none"` once the walk has run off the end. */
export function rungAtStep(
  ladder: readonly PreviewRung[],
  step: number
): PreviewRung {
  return ladder[step] ?? "none"
}

/**
 * IS THIS ELEMENT ERROR EVIDENCE ABOUT THE RUNG?
 *
 * Only while the cell still HOLDS the arm. Letting go — a pointer leave, a
 * scroll that cancels the dwell, the cell scrolling out of the virtual window
 * — unmounts the `<video>`, and unmounting it runs `abortVideo`: clear `src`,
 * call `load()`. That is the spec's ABORT, and the media load algorithm it
 * runs on an empty source is entitled to fire `error` on the way out.
 *
 * An `error` from THAT is a fact about the teardown and not about the file, so
 * recording it would blame a rung for the user moving the pointer — and the
 * record is a SESSION one (`notePreviewRungFailure`), so the item would be
 * demoted for the rest of the tab on the strength of a leave. That is exactly
 * what "never retry the failed rung" must not be made of.
 *
 * The `rung` half is belt and braces: `"none"` is the walked-off-the-end
 * state, which owns no element and therefore has nothing to blame.
 *
 * PURE AND HERE rather than an `if` in the component, because what it decides
 * is a rule about the ladder — see scripts/videopreview.test.mjs, which pins
 * it. Whether `released` is TRUE at the right moment is the component's half
 * and is a browser question: it is written by the `<video>`'s own ref
 * cleanup, which `LoopVideo` runs BEFORE the abort (see the ref there), so the
 * flag is already set by the time the abort's `load()` could queue anything.
 */
export function shouldRecordFailure(state: {
  /** Has the cell let go of the arm — see above. */
  released: boolean
  /** Which rung the element was serving. */
  rung: PreviewRung
}): boolean {
  return !state.released && state.rung !== "none"
}

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
  /** The row's `content_end_ms` — the key's cut segment (`previewKey`). */
  contentEndMs?: number | null
}): string {
  const key = previewKey(options.sha256, options.request, options.contentEndMs)
  if (slot && slot !== key) cancelTranscode(slot)
  slot = key
  startTranscode({
    sha256: options.sha256,
    dbs: options.dbs,
    preset: options.request.preset,
    endCs: options.request.end_cs ?? null,
    // The wire's literal, and the key's spelling of it — see `previewKey`.
    cut: options.request.cut ?? null,
    cutKey: previewCutKey(options.request, options.contentEndMs),
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
