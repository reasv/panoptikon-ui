// Assertions for useVideoTrim's end-of-playback modes in lib/videoTrim.ts —
// the §8 "hook semantics" contract of docs/video-end-action-design.md. No
// test runner and no DOM in this repo, so the hook runs against a hand-driven
// fake <video> under a ~50-line React hook runtime (scripts/fake-react.mjs,
// substituted for "react" by scripts/react-hooks.mjs). Run from the ui root:
//
//   node --experimental-strip-types scripts/endaction.test.mjs
//
// Exits non-zero on the first failing assertion set.
//
// EVENT TIMING. The fake fires everything SYNCHRONOUSLY by default, which is
// convenient but NOT uniformly stricter than a browser — that claim was wrong
// and this comment used to make it. Synchronous dispatch is tighter for
// re-entrancy (a handler runs in the middle of the assignment that caused it)
// and LOOSER for ordering: a browser QUEUES `seeking` and `pause`, so they
// land after the handler that caused them has finished and can overwrite
// state that handler just set. That is a real defect class the synchronous
// fake cannot see, so the fake has a `queued: true` mode — `seeking` and
// `pause` accumulate and are dispatched by an explicit `video.flushEvents()`
// — plus a `seekSnap` option (the readback of a seek lands δ seconds early,
// as an engine snapping to a frame boundary does). The park path is covered
// under both.

import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)
register("./react-hooks.mjs", import.meta.url)

const { render, reset } = await import("./fake-react.mjs")
const { useVideoTrim } = await import("../lib/videoTrim.ts")

let all = true
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `\n  ${detail}` : ""}`)
  all &&= !!ok
  return ok
}

// ---- environment the hook reads off globals ---------------------------

globalThis.HTMLMediaElement = { HAVE_METADATA: 1 }
let rafQueue = []
let rafSeq = 1
globalThis.requestAnimationFrame = (fn) => {
  const id = rafSeq++
  rafQueue.push([id, fn])
  return id
}
globalThis.cancelAnimationFrame = (id) => {
  rafQueue = rafQueue.filter(([i]) => i !== id)
}
// One generation of callbacks: a tick that re-registers itself does not run
// again until the next frame() — otherwise the loop would never return.
function frame() {
  const due = rafQueue
  rafQueue = []
  for (const [, fn] of due) fn()
}

// ---- the fake element -------------------------------------------------

class FakeVideo {
  // `queued`: dispatch `seeking` and `pause` the way a browser does — from a
  // task, i.e. after the code that caused them has run to completion. Drained
  // by flushEvents(). `seekSnap`: seconds a seek's readback lands EARLY, the
  // frame-boundary snap the park path has to survive.
  constructor(duration = 30, { queued = false, seekSnap = 0 } = {}) {
    this._t = 0
    this.duration = duration
    this.paused = true
    this.ended = false
    this.playbackRate = 1
    this.readyState = 1 // HAVE_METADATA
    this.listeners = new Map()
    this.binds = 0
    this.playCalls = 0
    this.queued = queued
    this.seekSnap = seekSnap
    this._pending = []
  }
  // Production code ASSIGNING currentTime is a seek; playback advancing is
  // not, so the two have separate doors (`advanceTo` below).
  get currentTime() {
    return this._t
  }
  set currentTime(v) {
    // A seek's readback is the position the engine actually landed on, which
    // `seekSnap` models as up to δ EARLIER than the requested one.
    const landed =
      this.seekSnap > 0 && v > this.seekSnap
        ? Math.round((v - this.seekSnap) * 1000) / 1000
        : v
    this._t = landed
    if (landed < this.duration) this.ended = false
    this.fire("seeking")
  }
  // `seeking` and `pause` go through the task queue in `queued` mode;
  // `play` and `ended` are always dispatched where the test asks for them.
  fire(type) {
    if (this.queued && (type === "seeking" || type === "pause"))
      this._pending.push(type)
    else this.emit(type)
  }
  flushEvents() {
    while (this._pending.length) this.emit(this._pending.shift())
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(fn)
    this.binds++
  }
  removeEventListener(type, fn) {
    const l = this.listeners.get(type)
    if (!l) return
    const i = l.indexOf(fn)
    if (i >= 0) l.splice(i, 1)
  }
  emit(type) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn()
  }
  count(type) {
    return (this.listeners.get(type) ?? []).length
  }
  total() {
    let n = 0
    for (const l of this.listeners.values()) n += l.length
    return n
  }
  pause() {
    if (this.paused) return
    this.paused = true
    this.fire("pause")
  }
  // The element's own play(), as the loop-mode wrap calls it
  play() {
    this.playCalls++
    this.startPlaying()
    return Promise.resolve()
  }
  // Autoplay / the user pressing play on a non-ended element
  startPlaying() {
    this.paused = false
    this.ended = false
    this.emit("play")
  }
  // play() on an ENDED element, per spec: the rewind to 0 happens
  // SYNCHRONOUSLY inside play() — clearing `ended` and firing `seeking` —
  // and only then is `play` fired. This is the ONLY replay primitive: a
  // browser that still reads `ended === true` in the `play` handler is
  // deviating from the spec, so the hook must not need that signal.
  replay() {
    this.playCalls++
    if (this.ended) this.currentTime = 0
    this.paused = false
    this.emit("play")
  }
  // Playback progress: no seek, no event but the tickers'
  advanceTo(t) {
    this._t = t
  }
  // Natural end of the media, in the spec's order. Step 3 of the end-of-media
  // steps queues a `timeupdate` BEFORE the task that pauses and fires
  // `ended`, so an observer sees the end position while the element is still
  // unpaused — which is how a bound at the file's own end can cross AND hit
  // `ended` in one playback. Only then does the element pause and fire
  // `pause`, then set and fire `ended`.
  reachEnd() {
    this._t = this.duration
    this.emit("timeupdate")
    if (!this.paused) {
      this.paused = true
      this.fire("pause")
    }
    this.ended = true
    this.emit("ended")
  }
}

// ---- harness ----------------------------------------------------------

function mount({
  trim = null,
  duration = 30,
  bare = false,
  queued = false,
  seekSnap = 0,
  ...rest
} = {}) {
  reset()
  rafQueue = []
  const video = new FakeVideo(duration, { queued, seekSnap })
  const ref = { current: video }
  const props = { trim, active: true, ...rest }
  const rerender = (patch = {}) => {
    Object.assign(props, patch)
    render(() =>
      // `bare` is the pinboard's call shape, key for key: the new options
      // must not merely default correctly, they must be omittable.
      bare
        ? useVideoTrim({ videoRef: ref, trim: props.trim, active: props.active })
        : useVideoTrim({
            videoRef: ref,
            trim: props.trim,
            active: props.active,
            loopAtEnd: props.loopAtEnd,
            onEndReached: props.onEndReached,
          })
    )
  }
  rerender()
  return { video, rerender }
}

function spy() {
  const f = () => {
    f.calls++
  }
  f.calls = 0
  return f
}

// Walk playback up to `to` in steps small enough to read as playback (the
// crossing check rejects a forward jump of MAX_PLAYBACK_STEP or more), one
// rAF per step.
// Returns as soon as the hook acts (pauses, or moves the playhead itself) —
// playback stops being the thing driving the position at that moment, and
// walking on would overwrite what the assertion is about.
function playTo(video, to, step = 0.21) {
  let t = video.currentTime
  while (t < to) {
    t = Math.min(to, Math.round((t + step) * 1000) / 1000)
    video.advanceTo(t)
    frame()
    if (video.paused || video.currentTime !== t) return
  }
}

// ---- loop mode: today's behavior, which must not move -----------------

{
  const { video } = mount({ trim: { start: 2, end: 10 }, bare: true })
  check("bare call seeks to the trim start on show", video.currentTime === 2)
  video.startPlaying()
  playTo(video, 10.05)
  check(
    "bare call still wraps to the trim start on crossing",
    video.currentTime === 2 && !video.paused,
    `t=${video.currentTime} paused=${video.paused}`
  )
}

{
  const { video } = mount({ trim: { start: 2, end: 10 }, bare: true })
  video.startPlaying()
  video.advanceTo(9.8)
  frame()
  video.advanceTo(11)
  frame()
  check(
    "a seek past the end point is not a crossing",
    video.currentTime === 11,
    `t=${video.currentTime}`
  )
}

{
  const { video } = mount({ trim: { start: 2, end: null }, bare: true })
  video.startPlaying()
  video.reachEnd()
  check(
    "bare call wraps a natural end back to the trim start and replays",
    video.currentTime === 2 && video.playCalls === 1,
    `t=${video.currentTime} plays=${video.playCalls}`
  )
}

{
  const { video } = mount({ trim: null, bare: true })
  check(
    "an empty trim in loop mode binds nothing (the native loop attribute owns it)",
    video.total() === 0,
    `${video.total()} listeners`
  )
}

{
  const fired = spy()
  const { video } = mount({
    trim: { start: 2, end: 10 },
    loopAtEnd: true,
    onEndReached: fired,
  })
  video.startPlaying()
  playTo(video, 10.05)
  video.reachEnd()
  check(
    "loop mode never calls onEndReached, even when one is passed",
    fired.calls === 0,
    `${fired.calls} calls`
  )
}

{
  const fired = spy()
  const { video } = mount({
    trim: { start: 5, end: 5.01 },
    loopAtEnd: true,
    onEndReached: fired,
  })
  video.startPlaying()
  check(
    "a freeze range still shows its frame and pauses in loop mode",
    video.currentTime === 5 && video.paused && fired.calls === 0
  )
}

// ---- stop mode: the end bound ----------------------------------------

{
  const fired = spy()
  const { video } = mount({
    trim: { start: 2, end: 10 },
    loopAtEnd: false,
    onEndReached: fired,
  })
  video.startPlaying()
  playTo(video, 10.05)
  check(
    "crossing parks exactly ON the end bound",
    video.currentTime === 10,
    `t=${video.currentTime}`
  )
  check("crossing pauses", video.paused)
  check("crossing fires onEndReached", fired.calls === 1, `${fired.calls} calls`)

  // The corner the guard exists for: an end bound at the file's own end makes
  // both end paths land in one playback.
  video.reachEnd()
  frame()
  check(
    "a natural end after a park does not fire a second time",
    fired.calls === 1,
    `${fired.calls} calls`
  )

  // A new playback re-arms it
  video.currentTime = 5
  video.startPlaying()
  playTo(video, 10.05)
  check(
    "a fresh playback fires again",
    fired.calls === 2 && video.currentTime === 10,
    `${fired.calls} calls, t=${video.currentTime}`
  )
}

{
  const fired = spy()
  const { video } = mount({
    trim: { start: 2, end: 10 },
    duration: 10,
    loopAtEnd: false,
    onEndReached: fired,
  })
  video.startPlaying()
  video.advanceTo(9.9)
  frame()
  // The natural end arrives in the spec's order — which INCLUDES a pre-pause
  // `timeupdate` at the end position (see reachEnd). The still-unpaused
  // checker crosses the bound there and parks; the `ended` that follows is
  // the second end path of the same playback. The once-per-playback guard is
  // what keeps the count at one — deleting it makes this assertion fail.
  video.reachEnd()
  frame()
  check(
    "an end bound at the file's own end fires onEndReached exactly once",
    fired.calls === 1,
    `${fired.calls} calls`
  )
}

// ---- stop mode: the natural end --------------------------------------

{
  const fired = spy()
  const { video } = mount({ trim: null, loopAtEnd: false, onEndReached: fired })
  check(
    "an empty trim in stop mode still binds the ended path",
    video.count("ended") === 1,
    `${video.count("ended")} ended listeners`
  )
  video.startPlaying()
  video.advanceTo(30)
  video.reachEnd()
  check("a natural end fires onEndReached", fired.calls === 1, `${fired.calls} calls`)
  check(
    "a natural end leaves the playhead where the browser parked it",
    video.currentTime === 30 && video.playCalls === 0,
    `t=${video.currentTime} plays=${video.playCalls}`
  )
}

{
  const { video } = mount({ trim: null, loopAtEnd: false })
  video.startPlaying()
  video.reachEnd()
  check("stop mode with no callback is inert, not a crash", video.playCalls === 0)
}

{
  const fired = spy()
  const { video } = mount({
    trim: { start: 5, end: 5.01 },
    loopAtEnd: false,
    onEndReached: fired,
  })
  video.startPlaying()
  check(
    "a freeze range never plays, so it never ends",
    video.currentTime === 5 && video.paused && fired.calls === 0
  )
  video.reachEnd()
  check("…and an ended event on it is ignored too", fired.calls === 0)
}

// ---- stop mode: replay after an end -----------------------------------

{
  const { video } = mount({ trim: { start: 2, end: null }, loopAtEnd: false })
  video.startPlaying()
  video.advanceTo(30)
  video.reachEnd()
  video.replay() // spec: rewinds to 0, clears `ended`, then fires `play`
  check(
    "replay after a natural end starts at the trim start, not 0",
    video.currentTime === 2,
    `t=${video.currentTime}`
  )
}

{
  const { video, rerender } = mount({
    trim: { start: 2, end: null },
    loopAtEnd: false,
  })
  video.startPlaying()
  video.advanceTo(30)
  video.reachEnd()
  // A rebind while the element sits at its natural end — here an outro cut
  // refining into an end bound; a trim nudge or a mode change is the same
  // event. It drops the closure local that arms the correction, so the local
  // has to be RE-DERIVED from the element at bind time. `video.ended` is no
  // help later: the spec's rewind runs inside play(), before the `play`
  // handler, so it reads false by then (replay() below is exactly that).
  rerender({ trim: { start: 2, end: 25 } })
  video.replay()
  check(
    "a rebind while ended re-arms the replay correction",
    video.currentTime === 2,
    `t=${video.currentTime}`
  )
}

{
  const { video } = mount({ trim: { start: 2, end: null }, loopAtEnd: false })
  video.startPlaying()
  video.advanceTo(30)
  video.reachEnd()
  video.currentTime = 12 // the user scrubs: they chose this position
  video.startPlaying()
  check(
    "a user scrub after the end disarms the rewind correction",
    video.currentTime === 12,
    `t=${video.currentTime}`
  )
}

{
  const fired = spy()
  const { video } = mount({
    trim: { start: 2, end: 10 },
    loopAtEnd: false,
    onEndReached: fired,
  })
  video.startPlaying()
  playTo(video, 10.05)
  video.startPlaying()
  check(
    "playing on from a PARK runs the tail out (the outro inspection gesture)",
    video.currentTime === 10 && !video.paused,
    `t=${video.currentTime}`
  )
  // …and keeps running PAST the bound. Stopping the walk at the bound would
  // never exercise the re-crossing the park guard exists for.
  playTo(video, 10.4, 0.01)
  check(
    "…past the bound, without re-parking or firing a second time",
    fired.calls === 1 && !video.paused && video.currentTime === 10.4,
    `calls=${fired.calls} t=${video.currentTime} paused=${video.paused}`
  )
}

// ---- stop mode: the park under a browser's own event timing ------------
//
// The park is the one place where a queued `seeking` can overwrite state the
// handler that caused it just set, and where the readback it carries may be a
// frame short of the bound. Both directions of that readback are covered.

{
  const fired = spy()
  const { video } = mount({
    trim: { start: 2, end: 10 },
    loopAtEnd: false,
    onEndReached: fired,
    queued: true,
    seekSnap: 0.02,
  })
  video.flushEvents() // the show-time seek to the trim start
  video.startPlaying()
  playTo(video, 10.05)
  check(
    "a park whose seek snaps short reads back below the bound",
    video.currentTime === 9.98 && video.paused && fired.calls === 1,
    `t=${video.currentTime} paused=${video.paused} calls=${fired.calls}`
  )
  // The park's own queued `seeking` and `pause`, arriving after its handler
  video.flushEvents()
  video.startPlaying() // the inspection play, from the parked position
  playTo(video, 10.4, 0.01)
  check(
    "…and the inspection play runs the tail out instead of re-parking",
    fired.calls === 1 && !video.paused && video.currentTime === 10.4,
    `calls=${fired.calls} t=${video.currentTime} paused=${video.paused}`
  )
  video.currentTime = 5 // the user goes back: the bound is armed again
  video.flushEvents()
  video.startPlaying()
  playTo(video, 10.05)
  check(
    "…while a seek back before the bound parks and fires again",
    fired.calls === 2 && video.paused && video.currentTime === 9.98,
    `calls=${fired.calls} t=${video.currentTime} paused=${video.paused}`
  )
}

{
  const fired = spy()
  const { video } = mount({
    trim: { start: 2, end: 10 },
    loopAtEnd: false,
    onEndReached: fired,
    queued: true,
  })
  video.flushEvents()
  video.startPlaying()
  playTo(video, 10.05)
  video.flushEvents()
  check(
    "an exact readback parks on the bound under queued events, unchanged",
    video.currentTime === 10 && video.paused && fired.calls === 1,
    `t=${video.currentTime} paused=${video.paused} calls=${fired.calls}`
  )
  video.startPlaying()
  playTo(video, 10.4, 0.01)
  check(
    "…and the tail out is the same there",
    fired.calls === 1 && !video.paused && video.currentTime === 10.4,
    `calls=${fired.calls} t=${video.currentTime} paused=${video.paused}`
  )
}

// ---- rebinding --------------------------------------------------------

{
  const a = spy()
  const b = spy()
  const { video, rerender } = mount({
    trim: { start: 2, end: null },
    loopAtEnd: false,
    onEndReached: a,
  })
  const bound = video.binds
  rerender({ onEndReached: b })
  check(
    "a new callback identity does not rebind the listeners",
    video.binds === bound,
    `${bound} -> ${video.binds}`
  )
  video.startPlaying()
  video.reachEnd()
  check(
    "…and the latest callback is the one that runs",
    a.calls === 0 && b.calls === 1,
    `a=${a.calls} b=${b.calls}`
  )
}

{
  const { video, rerender } = mount({ trim: { start: 2, end: 10 }, loopAtEnd: true })
  const bound = video.binds
  rerender({ loopAtEnd: false })
  check("a mode change rebinds", video.binds > bound, `${bound} -> ${video.binds}`)
  check(
    "…without leaving the old listeners behind",
    video.count("ended") === 1 && video.count("play") === 1,
    `ended=${video.count("ended")} play=${video.count("play")}`
  )
  video.currentTime = 2
  video.startPlaying()
  playTo(video, 10.05)
  check(
    "…and the new mode governs immediately",
    video.currentTime === 10 && video.paused,
    `t=${video.currentTime} paused=${video.paused}`
  )
}

{
  const { video, rerender } = mount({ trim: null, loopAtEnd: false })
  rerender({ active: false })
  check(
    "going inactive unbinds everything",
    video.total() === 0,
    `${video.total()} listeners`
  )
}

console.log(all ? "\nALL PASS" : "\nFAILURES")
process.exit(all ? 0 : 1)
