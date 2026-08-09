import React from "react"

// Measures a video track's TRUE end in the BROWSER's own timeline
// (docs/video-outro-skip-design.md §1), the one number the container
// metadata cannot supply.
//
// Why it exists: the outro cut has to be expressed in browser seconds, but
// ffprobe's timeline and the browser's disagree in both directions at once —
// an mp4 edit list / audio priming delays the video track at the FRONT, and
// an audio tail outlives the video at the BACK — and nothing in either
// duration says how the total discrepancy splits between the two. The
// midpoint heuristic guesses 50/50 and field validation measured ±2 frames of
// per-file scatter around that guess. Measuring instead removes the guess:
//
//   K   = serverDuration − content_end_ms/1000   (both ffprobe video seconds;
//                                                 the card length, exact)
//   cut = probedVideoEnd − K − guard             (browser seconds)
//
// Both unknowns cancel: K is a DIFFERENCE inside one timeline (immune to any
// origin shift) and `probedVideoEnd` is an absolute position in the other, so
// the composed cut needs no browser duration at all.
//
// The measurement is the `mediaTime` of the last presented video frame, via
// `requestVideoFrameCallback` on a throwaway offscreen element. It
// UNDERESTIMATES the track end by up to one frame (the last frame's
// presentation timestamp is its start, not its end) — a bias in the SAFE
// direction, slightly early, of the same order as the jitter the 60 ms guard
// already absorbs, so the guard is unchanged.
//
// Everything here is best-effort: every failure path resolves `null`, and a
// null simply leaves the midpoint heuristic in charge. Firefox (no rVFC at
// all) therefore keeps exactly today's behaviour.

// Whole-probe budget. Generous: it covers a metadata fetch, a seek to the
// tail (a range request into the far end of the file) and, on the nudge path
// below, a fraction of a second of decode. Nothing waits on it — the cut is
// already live on the midpoint value while it runs.
const PROBE_TIMEOUT_MS = 4000

// How long a completed seek is given to present a frame before the probe
// assumes this browser will not composite a paused offscreen video at all
// and switches to the playout nudge.
const NUDGE_DELAY_MS = 700

// How far before the end the nudge restarts from. Large enough to cover a
// few frames at any sane rate, small enough that the muted decode it costs is
// unnoticeable — and it only ever runs when the cheap path already failed.
const NUDGE_WINDOW_SEC = 0.4

// A pinboard can mount dozens of eligible TikToks in one layout pass and each
// probe range-fetches the tail of its file. Four at a time keeps the
// measurement off the critical path of whatever the user is actually
// watching.
const MAX_CONCURRENT = 4

// Keyed by SHA, not by URL: the file URL carries the selected databases as
// query params, so the same bytes have several URLs within one session and
// URL keying would probe the same video again per database switch. One probe
// per video per session, and concurrent mounts of the same video (a pin and
// the gallery, or several pins of one item) share the single in-flight
// promise.
const probes = new Map<string, Promise<number | null>>()

let inFlight = 0
const waiting: Array<() => void> = []

function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight += 1
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    waiting.push(() => {
      inFlight += 1
      resolve()
    })
  })
}

function releaseSlot() {
  inFlight -= 1
  const next = waiting.shift()
  if (next) next()
}

function supported(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof HTMLVideoElement !== "undefined" &&
    "requestVideoFrameCallback" in HTMLVideoElement.prototype
  )
}

// One probe run. Resolves the last video frame's `mediaTime` in seconds, or
// null; never rejects and never outlives PROBE_TIMEOUT_MS.
//
// Lifecycle:
//   1. create a detached <video> (muted, playsInline, preload=metadata) and
//      set `src`; it is NEVER inserted into the document and is NEVER the
//      player's element — no visible video is seeked by this;
//   2. on `loadedmetadata`, read `duration`; arm rVFC and seek to it (the
//      seek clamps to the seekable end and is also what promotes the load
//      past metadata);
//   3. accept the first rVFC tick that reports an END-REGION `mediaTime` and
//      resolve with it. Ticks are filtered because the element may present
//      its FIRST frame while the seek is still in flight, and a `mediaTime`
//      of ~0 would otherwise be reported as the track end; a rejected tick
//      re-arms the callback;
//   4. if the seek completes and nothing is presented within NUDGE_DELAY_MS,
//      restart NUDGE_WINDOW_SEC before the end and play (muted) — some
//      browsers only composite a video that is actually running. Ticks then
//      arrive in order, so this path keeps the MAXIMUM `mediaTime` seen and
//      resolves it at `ended`;
//   5. `error`, an unusable duration, a play() rejection, or the overall
//      timeout resolve null (or the best tick seen, on the nudge path).
// Cleanup runs on EVERY exit: cancel the pending rVFC, drop the listeners,
// pause, and `removeAttribute("src") + load()` to release the decoder and
// abort any in-flight range request.
function runProbe(src: string): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    const el = document.createElement("video")
    el.muted = true
    el.playsInline = true
    el.preload = "metadata"
    // Same-origin (the gateway serves the file), so no crossOrigin attribute
    // is needed — and rVFC metadata is not tainted by pixel-access rules
    // anyway; nothing here reads pixels.

    let settled = false
    let frameHandle = 0
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let nudgeId: ReturnType<typeof setTimeout> | undefined
    let playingOut = false
    let best = -1
    let threshold = 0

    const finish = (value: number | null) => {
      if (settled) return
      settled = true
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      if (nudgeId !== undefined) clearTimeout(nudgeId)
      if (frameHandle) {
        try {
          el.cancelVideoFrameCallback(frameHandle)
        } catch {
          // Cancelling an already-fired handle is harmless everywhere; a
          // throwing implementation must not take the cleanup down with it
        }
      }
      el.removeEventListener("loadedmetadata", onMetadata)
      el.removeEventListener("seeked", onSeeked)
      el.removeEventListener("ended", onEnded)
      el.removeEventListener("error", onError)
      try {
        el.pause()
      } catch {
        // Same
      }
      // Releases the decoder and aborts the tail fetch. Both steps matter:
      // clearing `src` alone leaves the resource selection algorithm holding
      // the old one until the next load().
      el.removeAttribute("src")
      try {
        el.load()
      } catch {
        // Same
      }
      resolve(value)
    }

    const onFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      frameHandle = 0
      const t = metadata?.mediaTime
      if (typeof t === "number" && isFinite(t) && t >= threshold) {
        if (!playingOut) {
          finish(t)
          return
        }
        if (t > best) best = t
      }
      arm()
    }

    const arm = () => {
      if (settled) return
      frameHandle = el.requestVideoFrameCallback(onFrame)
    }

    const onMetadata = () => {
      const dur = el.duration
      if (!isFinite(dur) || dur <= 0) {
        finish(null)
        return
      }
      // The last frame cannot sit further than the whole browser/ffprobe
      // discrepancy below `duration`, and the cut math already refuses a
      // discrepancy of a second or more as two files' worth of metadata. On
      // a video shorter than two seconds that bound would swallow the entire
      // timeline, so it never reaches below the midpoint.
      threshold = dur - Math.min(1, dur / 2)
      arm()
      // Clamps to the seekable end, and promotes the load past `metadata`
      el.currentTime = dur
    }

    const onSeeked = () => {
      if (settled || playingOut || nudgeId !== undefined) return
      nudgeId = setTimeout(() => {
        if (settled || playingOut) return
        // Nothing was composited for the paused, never-rendered element.
        // Run it instead: play() presents frames in order, so from here the
        // answer is the LAST tick, not the first.
        playingOut = true
        const dur = el.duration
        if (!isFinite(dur) || dur <= 0) {
          finish(null)
          return
        }
        try {
          el.currentTime = Math.max(0, dur - NUDGE_WINDOW_SEC)
        } catch {
          finish(null)
          return
        }
        const started = el.play()
        if (started && typeof started.catch === "function") {
          // Autoplay policy blocks even a muted element in some
          // configurations; that is the end of the road for this file
          started.catch(() => finish(best >= 0 ? best : null))
        }
      }, NUDGE_DELAY_MS)
    }

    const onEnded = () => finish(best >= 0 ? best : null)
    const onError = () => finish(best >= 0 ? best : null)

    el.addEventListener("loadedmetadata", onMetadata)
    el.addEventListener("seeked", onSeeked)
    el.addEventListener("ended", onEnded)
    el.addEventListener("error", onError)
    timeoutId = setTimeout(() => finish(best >= 0 ? best : null), PROBE_TIMEOUT_MS)
    el.src = src
    // No load() call: setting `src` already invokes the resource selection
    // algorithm.
  })
}

// The cached, deduplicated, rate-limited entry point. A failure is cached
// too: a file whose tail cannot be probed will not be probed again this
// session — the midpoint heuristic is a complete answer, not a degraded one,
// so retrying would spend range requests to re-learn the same null.
export function probeVideoEnd(src: string, sha: string): Promise<number | null> {
  const cached = probes.get(sha)
  if (cached) return cached
  if (!supported()) {
    // Firefox has no rVFC (and SSR has no document): resolve null WITHOUT
    // caching, so the client pass after hydration is free to try.
    return Promise.resolve(null)
  }
  const started = acquireSlot()
    .then(() => runProbe(src).finally(releaseSlot))
    .catch(() => null)
  probes.set(sha, started)
  return started
}

// The probe result for one item, or null while it is running / unavailable.
// SSR-safe: nothing touches `document` until the effect runs.
//
// Mirrors `useVideoDuration`'s reset discipline — the value resets the moment
// the item changes, never when the next answer happens to arrive — because
// the two feed the same cut point and a departed item's measurement would
// otherwise anchor the arriving item's cut. Keyed on the SHA, never on the
// element ref: the gallery's ref identity changes per item and the pinboard's
// does not, so neither is the item.
//
// Unmounting mid-probe is not a cancellation: the promise stays in the cache
// and keeps resolving for whoever mounts next.
export function useVideoEndProbe(
  src: string | null,
  sha: string | null,
  enabled: boolean
): number | null {
  const [end, setEnd] = React.useState<number | null>(null)
  React.useEffect(() => {
    setEnd(null)
    if (!enabled || !src || !sha) return
    let live = true
    void probeVideoEnd(src, sha).then((value) => {
      if (live) setEnd(value)
    })
    return () => {
      live = false
    }
  }, [src, sha, enabled])
  return end
}
