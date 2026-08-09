import React from "react"
// `import type`, not a value import: scripts/outroskip.test.mjs loads this
// module under node's type stripping, which erases type-only imports but
// leaves a plain one to fail at runtime against a type-only export.
import type { TrimRange } from "./pinboardCrop"

// Two trim points closer than this (seconds) behave as a freeze frame.
// EXPORTED because it is a contract, not an internal detail: anything that
// COMPOSES a range (the outro default below) has to keep clear of the band
// useVideoTrim treats as a still frame, and a second copy of the literal
// would drift away from this one.
export const FREEZE_EPS = 0.02

// A forward step larger than this (seconds) between two checks is a user
// seek, not playback advancing — seeks past the end point must not trigger
// the loop jump. Stated at 1x: the budget is MEDIA time, and media time
// advances at playbackRate per wall second, so the ceiling scales with the
// rate (see the crossing test).
const MAX_PLAYBACK_STEP = 0.5

// Places (or clears) ONE trim bound, the shared semantics behind every
// set-loop-point verb: the player surface's popover buttons, the pin context
// menu's set-at-playhead items and the gallery's I/O keys. `time` is a
// playhead position in seconds, or null to clear that bound; it is rounded to
// centiseconds, the storage resolution of both the h field and the `vt` param
// (see pinboardCrop.ts). Placing a bound on the wrong side of the other one
// clears the other — the user is redefining the range, not asking for an
// impossible one. Equal bounds are allowed (freeze frame), and both bounds
// unset is the empty trim, spelled null.
export function trimWithBound(
  trim: TrimRange | null,
  which: "start" | "end",
  time: number | null
): TrimRange | null {
  let start = trim?.start ?? null
  let end = trim?.end ?? null
  if (time == null) {
    if (which === "start") start = null
    else end = null
  } else {
    const t = Math.round(time * 100) / 100
    if (which === "start") {
      start = t
      if (end != null && end < t) end = null
    } else {
      end = t
      if (start != null && start > t) start = null
    }
  }
  return start == null && end == null ? null : { start, end }
}

// ---- Outro skip (docs/video-outro-skip-design.md) ---------------------
//
// A detected TikTok end card becomes a DEFAULT for the trim end bound,
// applied at playback time only. It never becomes a user trim by itself and
// is never written to `vt` or the pinboard h field — which is why there is
// no "modified outro trim" state to reason about.

// The detected content end leads the first card frame by up to 60 ms of
// audio bang (detection design §2.3/§10); the guard covers the worst
// measured case. It was 150 ms until field validation: 150 ms costs 4-5
// visible frames on EVERY video to cover a lead whose median is 10 ms, and
// with the cut end-anchored (below) and drag-adjustable per video there is
// no systematic error left for it to absorb. Worst case at 60 ms is ~one
// rAF tick of bang transient on a max-lead file.
const OUTRO_GUARD_MS = 60

// The item's outro cut point in seconds, or null when the item is not
// eligible: no `content_end_ms` (never examined, no outro, or the index DB
// has detection off — the API nulls the field then), or a degenerate cut
// point inside the freeze band. Rounded to centiseconds, the storage
// resolution of the trim codec, so a seeded user bound lands on the same
// lattice.
//
// The browser's timeline disagrees with ffprobe's in BOTH directions, and
// field validation measured both on one file (browser duration 0.25 s longer
// than ffprobe's): an origin shift at the front (edit lists / audio priming
// delay the video track — the pure start-anchored cut measured 0.11-0.14 s
// EARLY) and tail padding at the back (the audio track outlives the video —
// the pure end-anchored cut measured 0.11-0.14 s LATE, card flash included).
// The two pure anchors bracket the real boundary: the card's last frame
// cannot outlive the browser timeline, and origin shifts are non-negative.
// With nothing in the metadata to apportion the discrepancy, split it:
//
//   delta = browserDuration − serverDuration   (browser minus ffprobe)
//   cut   = contentEnd + delta/2 − guard       (browser seconds)
//
// — the midpoint of the two anchors, exact on the validated file, error
// bounded by |delta|/2 instead of |delta|. When the timelines agree it IS
// the start-anchored cut. A |delta| of a second or more means the two
// durations do not describe the same file: ineligible, not a guess.
//
// Falls back to the start-anchored `contentEnd − guard` whenever either
// duration is missing — the browser's arrives only with `loadedmetadata`, so
// the fallback is what the first frames of every playback use, and the cut
// REFINES when the metadata lands (useVideoTrim re-runs its loop effect on
// an end change without yanking the playhead).
//
// The eligibility floor is FREEZE_EPS, not zero: a cut at 0.01 s composes
// {start: null, end: 0.01}, which is useVideoTrim's freeze branch — the
// video would show frame 1 and pause, with no user trim anywhere in sight.
// It is the same predicate the composition guard below applies at start 0.
export function outroCutPoint(
  contentEndMs: number | null | undefined,
  // The item's indexed `duration` (ffprobe seconds), and the <video>
  // element's own `duration` once metadata has loaded. Either UNUSABLE
  // (null, undefined, NaN, zero or negative — a duration of 0 is as unknown
  // as no duration at all) selects the start-anchored fallback.
  serverDurationSec?: number | null,
  browserDurationSec?: number | null
): number | null {
  if (contentEndMs == null || !isFinite(contentEndMs)) return null
  const serverDur =
    serverDurationSec != null && isFinite(serverDurationSec) && serverDurationSec > 0
      ? serverDurationSec
      : null
  const browserDur =
    browserDurationSec != null && isFinite(browserDurationSec) && browserDurationSec > 0
      ? browserDurationSec
      : null
  let cut: number
  if (serverDur != null && browserDur != null) {
    const card = serverDur - contentEndMs / 1000
    const delta = browserDur - serverDur
    // A content end at or past the file end leaves no card to skip, and a
    // duration disagreement of a second or more is not padding to split but
    // two files' worth of metadata — both are nonsense to anchor against,
    // ineligible rather than a fallback (a fallback would cut on numbers
    // already known to be inconsistent).
    if (!(card > 0) || Math.abs(delta) >= 1) return null
    cut =
      Math.round((contentEndMs / 1000 + delta / 2 - OUTRO_GUARD_MS / 1000) * 100) / 100
  } else {
    cut = Math.round((contentEndMs - OUTRO_GUARD_MS) / 10) / 100
  }
  return cut > FREEZE_EPS ? cut : null
}

// The <video> element's own duration in seconds, NaN until its metadata
// loads. ONE listener per player, owned by the host: the cut point above
// needs it (end-anchoring) and the rail draws its geometry from it, so a
// second listener would be a second answer to the same question.
// `active` is the host's showVideo — the element is created and destroyed
// under an unchanged ref identity, so the ref alone is not enough to rebind
// on. `resetKey` must change with the ITEM (its sha): a pinboard pin swaps
// `src` in place under an unchanged ref AND unchanged `active` when the
// board reflows, and without the key the departed item's duration would
// survive until the new metadata lands — mis-anchoring the cut against the
// wrong total in the meantime. (The load algorithm does not fire
// `durationchange` when it empties the element, so no event bridges that
// gap.)
export function useVideoDuration(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  active: boolean,
  resetKey?: string
): number {
  const [duration, setDuration] = React.useState(NaN)
  React.useEffect(() => {
    const video = videoRef.current
    if (!active || !video) {
      // The item that just left must never lend its duration to the one
      // arriving (React bails out when it is already NaN)
      setDuration(NaN)
      return
    }
    // Re-running for a new item: the old duration is stale the moment the
    // key changes, not merely once the new metadata arrives. `video.duration`
    // still holds the OLD value until the load algorithm resets it, so seed
    // NaN and let the events (or the update below on a same-item re-run)
    // provide the real number.
    setDuration(NaN)
    const update = () => setDuration(video.duration)
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) update()
    video.addEventListener("loadedmetadata", update)
    video.addEventListener("durationchange", update)
    return () => {
      video.removeEventListener("loadedmetadata", update)
      video.removeEventListener("durationchange", update)
    }
  }, [active, videoRef, resetKey])
  return duration
}

// The trim the PLAYER enforces: the user's trim with the outro cut point
// standing in for an absent end bound. A user end wins even past the cut
// (someone who deliberately trims into the outro is respected — there is no
// min() composition), and a user start alone still skips the outro.
//
// Degenerate-range guard: the default applies only while `cutPoint` clears
// the effective start by more than FREEZE_EPS. The predicate is the exact
// complement of useVideoTrim's `end - start <= FREEZE_EPS` freeze test, not
// a `start >= end` test: a start one centisecond before the cut composes a
// 0.01 s range, which that hook already shows as a still frame and pauses —
// a paused video is never what a start-only trim means.
//
// Returns the user trim itself (same identity) whenever no default applies,
// so hosts can feed the result straight to useVideoTrim and to
// `isEmptyTrim` for the native `loop` attribute.
export function effectiveVideoTrim(
  trim: TrimRange | null,
  cutPoint: number | null,
  skipEnabled: boolean
): TrimRange | null {
  if (!skipEnabled || cutPoint == null) return trim
  const start = trim?.start ?? null
  const end = trim?.end ?? null
  if (end != null) return trim
  if (cutPoint - (start ?? 0) <= FREEZE_EPS) return trim
  return { start, end: cutPoint }
}

// Whether the outro default is what currently ends playback — the state the
// toggle button lights up for and the rail draws a cyan end marker for.
export function outroSkipGoverns(
  trim: TrimRange | null,
  cutPoint: number | null,
  skipEnabled: boolean
): boolean {
  return (
    (trim?.end ?? null) == null &&
    effectiveVideoTrim(trim, cutPoint, skipEnabled)?.end != null
  )
}

// Enforces a playback trim range on a <video>: playback (re)starts from
// `start`, playback *crossing* `end` jumps back to `start`, and
// start === end shows a still frame instead of playing. Seeking is
// deliberately NOT clamped — the user must be able to scrub anywhere to
// place new points; a playhead placed at or beyond the end point plays out
// to the file's natural end and then wraps to `start`. The range only
// reasserts itself at loop boundaries.
// The video element must render without the native `loop` attribute while
// a trim is set (see isEmptyTrim), since loops have to restart from
// `start` rather than 0.
export function useVideoTrim({
  videoRef,
  trim,
  active,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  trim: TrimRange | null
  active: boolean
}) {
  const start = trim?.start ?? null
  const end = trim?.end ?? null

  // Seek to the start point once per video "show", when metadata is ready.
  // Depends only on `active` (trim read through a ref): moving a bound
  // mid-playback must not yank the playhead.
  const trimRef = React.useRef(trim)
  trimRef.current = trim
  React.useEffect(() => {
    if (!active) return
    const video = videoRef.current
    const t = trimRef.current
    if (!video || t?.start == null) return
    const seekToStart = () => {
      video.currentTime = t.start!
      if (t.end != null && t.end - t.start! <= FREEZE_EPS) video.pause()
    }
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      seekToStart()
      return
    }
    video.addEventListener("loadedmetadata", seekToStart, { once: true })
    return () => video.removeEventListener("loadedmetadata", seekToStart)
  }, [active, videoRef])

  React.useEffect(() => {
    if (!active || (start == null && end == null)) return
    const video = videoRef.current
    if (!video) return
    const s = start ?? 0
    const freeze = end != null && end - s <= FREEZE_EPS
    // Crossing detection needs the previous playback position; seeks (ours
    // and the user's) reset it so a jump over the end point doesn't count
    let prev = video.currentTime
    const jumpToStart = () => {
      video.currentTime = s
      prev = s
    }
    let raf = 0
    const check = () => {
      if (freeze) return
      const now = video.currentTime
      // INVARIANT: the seek-vs-playback threshold is media seconds per tick,
      // so it must scale with the speed the media is running at — at 2x the
      // timeupdate fallback (~250 ms wall, the only ticker in a hidden tab)
      // legitimately steps ~0.5 s of media time. Never below the 1x budget:
      // slow motion must not tighten it into missed crossings.
      const maxStep = MAX_PLAYBACK_STEP * Math.max(1, video.playbackRate)
      const crossed =
        end != null &&
        !video.paused &&
        prev < end &&
        now >= end &&
        now - prev < maxStep
      if (crossed) jumpToStart()
      else prev = now
    }
    const tick = () => {
      check()
      raf = requestAnimationFrame(tick)
    }
    const onPlay = () => {
      if (freeze) {
        // "Playing" a zero-length range shows its frame
        jumpToStart()
        video.pause()
        return
      }
      prev = video.currentTime
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(tick)
    }
    const onSeeking = () => {
      prev = video.currentTime
    }
    const onPause = () => cancelAnimationFrame(raf)
    const onEnded = () => {
      // Manual wrap-around (native `loop` would restart at 0): reached when
      // no end is set, or the end lies at/past the actual file duration
      if (freeze) return
      jumpToStart()
      video.play().catch(() => {})
    }
    video.addEventListener("play", onPlay)
    video.addEventListener("pause", onPause)
    video.addEventListener("ended", onEnded)
    video.addEventListener("seeking", onSeeking)
    // rAF gives frame-accurate loop points but freezes in hidden tabs;
    // timeupdate (~4Hz, keeps firing when hidden) is the fallback
    video.addEventListener("timeupdate", check)
    if (!video.paused) onPlay()
    return () => {
      cancelAnimationFrame(raf)
      video.removeEventListener("play", onPlay)
      video.removeEventListener("pause", onPause)
      video.removeEventListener("ended", onEnded)
      video.removeEventListener("seeking", onSeeking)
      video.removeEventListener("timeupdate", check)
    }
  }, [active, start, end, videoRef])
}
