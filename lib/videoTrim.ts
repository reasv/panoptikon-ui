import React from "react"
import { TrimRange } from "./pinboardCrop"

// Two trim points closer than this (seconds) behave as a freeze frame
const FREEZE_EPS = 0.02

// A forward step larger than this (seconds) between two checks is a user
// seek, not playback advancing — seeks past the end point must not trigger
// the loop jump
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
      const crossed =
        end != null &&
        !video.paused &&
        prev < end &&
        now >= end &&
        now - prev < MAX_PLAYBACK_STEP
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
