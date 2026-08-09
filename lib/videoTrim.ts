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
// PROBE PATH (best, and the only one that measures rather than guesses).
// `probedVideoEndSec` is the video track's true end in BROWSER seconds,
// measured once per video by lib/videoEndProbe.ts. With it the discrepancy
// between the two timelines stops mattering:
//
//   K   = serverDuration − contentEnd    (both ffprobe seconds: the card
//                                         length, a difference INSIDE one
//                                         timeline, so exact)
//   cut = probedVideoEnd − K − guard     (browser seconds)
//
// It needs no browser duration at all, and no |delta| sanity test — it is not
// composing two timelines, it is subtracting a known length from a measured
// position. The measurement runs ≤1 frame EARLY (a frame's presentation time
// is its start), which is the safe direction and well inside what the guard
// already absorbs.
//
// MIDPOINT PATH (fallback while the probe is unavailable or still running).
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
// REFINES when the metadata lands, then again when the probe resolves
// (useVideoTrim re-runs its loop effect on an end change without yanking the
// playhead).
//
// PRECEDENCE: probe > midpoint > start-anchored fallback, with an asymmetry
// in how the two anchored paths treat their own nonsense. Inconsistent
// DURATIONS make the item ineligible outright (cutting on numbers already
// known to disagree is worse than not cutting), but a nonsense PROBE result
// only falls THROUGH to the midpoint: the probe is an independent,
// best-effort measurement of a third thing, and a browser that returns
// garbage for it has said nothing about the two durations, which still agree
// with each other. A failed measurement must not be able to kill a feature
// that worked without it.
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
  browserDurationSec?: number | null,
  // The video track's measured end in browser seconds (lib/videoEndProbe.ts),
  // null until it resolves and on every browser that cannot measure it.
  probedVideoEndSec?: number | null
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
  if (serverDur != null) {
    // The measured path. `card > 0` is the same eligibility fact the midpoint
    // path checks (a content end at or past the file end leaves nothing to
    // skip); when it fails, this path is simply not taken and the logic below
    // reaches its own verdict on it. The probe's own sanity is two-sided:
    // a measured end shorter than the card it must contain, or more than a
    // second away from the video stream's own duration (the measured end IS
    // serverDuration plus the track's browser-timeline delay, and a delay of
    // a second is the same two-different-files threshold the midpoint's
    // |delta| bound draws), is a measurement of something else. EVERY
    // rejection here — including a probe cut landing inside the freeze
    // band — falls THROUGH to the unmeasured tiers rather than returning
    // null: a failed measurement must never kill a feature that worked
    // without it (the asymmetry documented in the design's §1).
    const card = serverDur - contentEndMs / 1000
    const probedEnd =
      probedVideoEndSec != null &&
      isFinite(probedVideoEndSec) &&
      Math.abs(probedVideoEndSec - serverDur) < 1
        ? probedVideoEndSec
        : null
    if (card > 0 && probedEnd != null && probedEnd > card) {
      cut = Math.round((probedEnd - card - OUTRO_GUARD_MS / 1000) * 100) / 100
      if (cut > FREEZE_EPS) return cut
    }
  }
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

// Whether measuring this item's true video end could change its cut point —
// the gate both hosts put on `useVideoEndProbe`. It is exactly the probe
// path's own precondition minus the measurement: an item with no detected
// outro has no cut to refine, and one whose `duration` is unusable has no
// exact card length K to subtract, so the measurement would be spent on a
// path that cannot consume it. (The user preference is the hosts' other
// gate, kept there: a feature that is switched off must not fetch anything.)
// Deliberately NOT gated on the card being positive or on the element being
// shown — that is one arithmetic step past a cheap eligibility test, and the
// probe is wanted BEFORE first play so the first frames already use the
// measured cut.
export function outroProbeEligible(
  contentEndMs: number | null | undefined,
  serverDurationSec?: number | null
): boolean {
  return (
    contentEndMs != null &&
    isFinite(contentEndMs) &&
    serverDurationSec != null &&
    isFinite(serverDurationSec) &&
    serverDurationSec > 0
  )
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

// The spec's own rewind on `play()` after `ended` lands at 0 (seconds); a
// seek landing inside this band while that rewind is armed is read as the
// rewind rather than as the user placing the playhead. A BAND and not
// `=== 0` because the rewind targets exactly 0 but the readback is not
// guaranteed to be exactly 0 in every engine (a seek can snap to a frame
// boundary), and from inside the hook the two are indistinguishable —
// nothing in a `seeking` event says who asked for it.
//
// The honest cost, stated plainly: in non-loop mode this band takes away
// the ability to PLAY FROM the first 50 ms of a video after a natural end.
// A deliberate rail seek into [0, 0.05] followed by play lands at the trim
// start instead of at the position the user chose (only with a trim start
// set — without one there is nothing to jump to, so nothing is lost).
// Accepted: the alternative is an exact-zero test that any engine with an
// inexact readback turns into "replay discards the trim start", which is
// the gesture people actually make, against a 50 ms window at the head of a
// video they have just watched to its end.
const ENDED_REWIND_EPS = 0.05

// How far a seek must land from a park before it counts as the user moving
// away from it (seconds). The park's OWN readback is the reason for a
// tolerance rather than an equality test: `currentTime = end` can come back
// as `end − δ` on an engine that snaps the seek to a frame boundary
// (Firefox is the documented risk), and the `seeking` event that carries
// that readback is queued — it arrives after the park handler has already
// run. The repo elsewhere assumes an exact readback (VideoRail's release
// comment); this is the one site where the consequence of being wrong
// escalates from a pixel to a spurious auto-advance, so it is hardened here.
// A frame at 24 fps is 0.042 s, so 0.1 clears any plausible snap while
// staying far below a deliberate scrub.
const PARK_READBACK_EPS = 0.1

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
//
// `loopAtEnd: false` (docs/video-end-action-design.md §2) replaces both
// wraps with a stop: crossing `end` parks the playhead ON the bound and
// pauses, a natural `ended` leaves the element where the browser parked it,
// and either path calls `onEndReached` — at most once per playback. In that
// mode the hook binds even with no trim at all, since `ended` IS the whole
// mechanism there; the host must correspondingly render the element WITHOUT
// the native `loop` attribute, or `ended` never fires.
export function useVideoTrim({
  videoRef,
  trim,
  active,
  loopAtEnd = true,
  onEndReached,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  trim: TrimRange | null
  active: boolean
  // Defaulted so every caller that passes neither (the pinboard) keeps
  // today's wrap semantics exactly.
  loopAtEnd?: boolean
  onEndReached?: () => void
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

  // Read through a latest-ref so a caller's inline arrow never rebinds the
  // listeners below — the deps take `loopAtEnd` and nothing else new.
  const onEndReachedRef = React.useRef(onEndReached)
  onEndReachedRef.current = onEndReached

  React.useEffect(() => {
    // An empty trim has nothing to enforce ONLY in loop mode, where the
    // native `loop` attribute owns the wrap. Without it the `ended` binding
    // is the mechanism itself and must exist with no bounds at all
    // (docs/video-end-action-design.md §2).
    if (!active || (loopAtEnd && start == null && end == null)) return
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
    // Once per playback. An end bound sitting at the file's own end makes
    // the crossing check and `ended` land in the same tick, and one playback
    // must not advance the host twice. A closure local rather than a React
    // ref BY DESIGN: a rebind clears it, which is the specified behavior and
    // also stops one item's state from reaching the next element.
    let fired = false
    const endReached = () => {
      if (fired) return
      fired = true
      onEndReachedRef.current?.()
    }
    // `play()` on an ENDED element seeks to 0 per spec, which would discard
    // the trim start. The spec runs that seek SYNCHRONOUSLY inside play(),
    // before the `play` event is even queued, so by the time the handler
    // below runs `video.ended` is already false: reading the element there
    // is a belt-and-braces check for engines that deviate, never the arm.
    // The arm has to be a local — and therefore has to be RE-DERIVED from
    // the element at bind time, because an effect rebind while the element
    // sits at its natural end (an outro cut refining, a trim bound moving, a
    // mode change) would otherwise silently disarm the correction and the
    // next replay would start at 0. Deliberately NOT armed by a park AT the
    // end bound: playing on from a park runs the tail out, which is the
    // outro-inspection gesture (design §2).
    let rewound = !loopAtEnd && !!video.ended
    // Where the crossing check last parked the playhead (non-loop mode
    // only), or null. It is what makes "play on from a park runs the tail
    // out" hold even when the park's seek reads back a frame short of the
    // bound: without it the readback sits BELOW `end` again, the next check
    // tick sees a fresh crossing, and the video re-parks — in advance mode
    // auto-advancing off the user's deliberate inspection play, which
    // inverts the design's supersession rule. Cleared by any seek that moves
    // meaningfully away (PARK_READBACK_EPS), and re-set by the next real
    // crossing, so a genuine re-approach still parks.
    let parkedAt: number | null = null
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
      // A standing park floors the "where we were" side of the crossing
      // test: after parking at `end`, every position up to `end` has already
      // been played through and crossed once. Without the floor a park whose
      // readback landed at `end − δ` would cross again a frame later —
      // `prev` follows the readback down through the else branch below — and
      // the tail-inspection play would re-park instead of running out.
      const from = parkedAt != null ? Math.max(prev, parkedAt) : prev
      const crossed =
        end != null &&
        !video.paused &&
        from < end &&
        now >= end &&
        now - prev < maxStep
      if (crossed) {
        if (loopAtEnd) jumpToStart()
        else {
          // Park exactly ON the marker — the same visual language as the
          // click-park inspection gesture — and stop there (design §2).
          // Disarmed BEFORE the seek, which is what tells the seek handler
          // this landing is not the post-`ended` rewind; `parkedAt` is set
          // before it for the same reason, so the seek it causes (whether
          // that event arrives synchronously or queued) is recognized as the
          // park's own and does not clear it.
          rewound = false
          parkedAt = end!
          video.currentTime = end!
          prev = end!
          video.pause()
          endReached()
        }
      } else prev = now
    }
    const tick = () => {
      check()
      raf = requestAnimationFrame(tick)
    }
    const onPlay = () => {
      // A new playback: the end is reachable again
      fired = false
      if (freeze) {
        // "Playing" a zero-length range shows its frame. It never plays, so
        // it never ends, and `onEndReached` never fires for it (design §2).
        jumpToStart()
        video.pause()
        return
      }
      if (!loopAtEnd && start != null && (rewound || video.ended)) {
        // Replay after a natural end: the spec's seek to 0 has discarded the
        // trim start. Both signals because their timing is browser-dependent
        // — by now the rewind may have happened (clearing `ended`) or not.
        video.currentTime = start
      }
      rewound = false
      // A play that starts AT a standing park resumes from the bound, not
      // from a readback a frame short of it — the queued `seeking` the park
      // itself caused may have written that readback into `prev` after the
      // park handler had already set it. `parkedAt` is null in loop mode and
      // whenever no park stands, where this is exactly `video.currentTime`.
      prev = Math.max(video.currentTime, parkedAt ?? -Infinity)
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(tick)
    }
    const onSeeking = () => {
      const now = video.currentTime
      // Any seek away from the origin is the user choosing a position, so it
      // outranks the pending spec rewind; a seek TO the origin while armed is
      // that rewind itself.
      if (rewound && now > ENDED_REWIND_EPS) rewound = false
      // The same question for the park: a seek that lands away from it is
      // the user leaving, and re-arms the crossing check at that bound; one
      // that lands within PARK_READBACK_EPS is the park's own readback — or a
      // scrub so close to the bound (a couple of frame-steps back from a
      // park) that it reads as the tail-inspection gesture. The honest cost
      // of that conflation: a playback started inside the band runs past the
      // bound to the NATURAL end, so in advance mode the outro card plays in
      // full and the advance fires there instead of at the cut. Accepted —
      // the band is two frame-steps wide, and the alternative (an exact
      // test) turns a snapped readback into a spurious auto-advance off the
      // user's own inspection play, which is strictly worse.
      if (parkedAt != null && Math.abs(now - parkedAt) > PARK_READBACK_EPS)
        parkedAt = null
      prev = now
    }
    const onPause = () => cancelAnimationFrame(raf)
    const onEnded = () => {
      if (freeze) return
      if (!loopAtEnd) {
        // Leave the playhead where the browser parked it; the mode's owner
        // decides what comes next (design §2)
        rewound = true
        endReached()
        return
      }
      // Manual wrap-around (native `loop` would restart at 0): reached when
      // no end is set, or the end lies at/past the actual file duration
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
  }, [active, start, end, videoRef, loopAtEnd])
}
