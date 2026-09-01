// The grid's animated-loop playback director (F6).
//
// A screenful of animated cells is a screenful of decoding video elements, and
// letting every mounted one run is how a grid of GIFs became a grid of stalls
// in the first place. §2 settles the policy — "a cap on concurrently *playing*
// animations (IntersectionObserver; pause off-screen and during fast scroll)"
// — and this module is the whole of it.
//
// WHY A MODULE-LEVEL DIRECTOR RATHER THAN PER-CELL EFFECTS. The cap is a
// property of the PAGE, not of a cell: no cell can know how many others are
// playing, so a per-cell IntersectionObserver could pause off-screen video but
// could never enforce a total. The cheapest correct shape is therefore one
// registry, and once there is a registry the observer and the scroll listener
// should be shared too — so the page holds:
//
//   * ONE IntersectionObserver, whatever the cell count. Its callback is the
//     only thing that runs while cells enter and leave, and the browser
//     already batches it off the scrolling path.
//   * ONE capture-phase scroll listener on the document. Scroll events do not
//     bubble, but they are dispatched through the capture phase, so a single
//     listener sees the grid's scroller, the filmstrip's, and the window's
//     without any of them having to publish state.
//   * ONE capture-phase `play`/`pause` pair on the document, by the same trick.
//     They are how the director notices playback state it did not cause: the
//     user's own Play/Pause from the browser's video context menu (`pause`
//     becomes an exclusion that survives until the cell scrolls away), and any
//     future route that starts a cell behind the cap's back. An earlier build
//     put `autoplay` on the elements, and the `play` listener was load-bearing
//     rather than defensive there — a cell whose media buffered after the last
//     reconcile started itself and ran past the cap forever (measured: 32
//     visible cells, 32 playing). Dropping `autoplay` closed that route; the
//     listener stays because a cap that anything can walk around is not a cap.
//   * ONE bubble-phase `pointermove`, which records where the pointer is and
//     when it last actually moved. It is what the HOVER ARMING below asks its
//     question of (see canArmHover), and it is the whole standing cost of that
//     feature on a page nobody hovers: a comparison and two writes per event.
//   * ONE Map of registered elements, and ONE hover slot.
//
// HOVER-TO-ANIMATE (docs/grid-hover-animate-implementation.md D6/D7) is
// grafted onto exactly the same shape, and for the same reason: "at most one
// cell may hover-play" is a property of the PAGE, and a cell cannot enforce it.
// The director owns the arming rule, the dwell timer and the single slot;
// `armHoverPlay` is the entire interface, and the cell it answers decides
// nothing about policy. Cells in hover mode mount no `<video>` at all until
// their arm fires, so "the director does not auto-play a hover-mode cell" is
// structural rather than a rule it has to keep.
//
// The elements themselves are inert: no `autoplay`, `preload="none"`. Every
// play() and pause() in the app comes from `apply` below, which means the
// director governs the NETWORK as well as the decode — an off-screen loop has
// not been fetched, not merely paused.
//
// Nothing here runs per animation frame, and nothing runs at all while no
// animated cell is mounted: the last unregister tears the observer and the
// listener back down, so a page of static results carries none of it.
//
// The cells stay dumb by construction — `observeAnimatedCell` is the entire
// interface, and the component that calls it decides nothing about policy.

/**
 * How much of a cell has to be on screen before it plays. Half: a cell peeking
 * over the fold is not being looked at, and starting it there is what makes a
 * fast scroll start (and immediately abandon) a screenful of decodes.
 */
const VISIBLE_RATIO = 0.5

/**
 * The cap on simultaneously PLAYING elements, per §2's "cap on concurrently
 * playing animations". 24 is a screenful at the grid's smallest cell size and
 * comfortably inside the finite decode sessions the codec choice was settled
 * around (H.264 software decode, deliberately not AV1). Cells past it stay
 * mounted and keep showing their poster — the still frame is a correct
 * picture, so exceeding the cap costs sharpness of behaviour, never content.
 */
const MAX_PLAYING = 24

/**
 * Scroll speed past which playback is suspended, in CSS pixels per
 * millisecond (~1200 px/s). Below it the user is reading and the animations
 * are the point; above it they are streaks, and the decode work is pure cost
 * on the frames that can least afford it.
 */
const FAST_SCROLL_PX_PER_MS = 1.2

/**
 * How long after the last fast sample playback resumes. Long enough that the
 * flick-scroll deceleration does not flap play/pause, short enough that
 * "stopped scrolling" and "animations are back" read as the same moment.
 */
const SETTLE_MS = 180

/**
 * How recently the pointer must have actually MOVED for a `pointerenter` to
 * count as the user arriving at a cell (D6).
 *
 * THE WHOLE DEFENCE, and it is against the browser rather than against the
 * user: Chromium re-dispatches boundary events when content scrolls under a
 * STATIONARY cursor, so a wheel scroll through a grid delivers a
 * `pointerenter` for every cell that passes beneath the pointer. Arming on
 * those is how a scroll turns into a trail of started-and-abandoned decodes.
 * A real arrival is always preceded by a real move; a scroll under a still
 * cursor never is.
 */
const HOVER_MOVE_WINDOW_MS = 150

/**
 * How long the pointer has to REST on a cell before it plays (D6). Long
 * enough that sweeping the grid to reach the scrollbar or a corner button
 * starts nothing, short enough that it reads as a response to looking rather
 * than as a delay.
 */
const HOVER_DWELL_MS = 200

/**
 * What the policy needs to know about one registered cell. Spelled as its own
 * type so the planner below can be given plain objects — the policy is
 * arithmetic over three fields and never needs an element (see planPlayback).
 */
export interface PlaybackState {
  /** Last ratio the observer reported. The tie-break when over the cap. */
  ratio: number
  /**
   * What the director last ASKED this element to do. An intent, not a
   * reading: it is the incumbency term in the over-cap ordering, the thing
   * `onPause` compares against to tell a user's pause from the director's own,
   * and deliberately NOT what `apply` gates on — see the note there.
   */
  playing: boolean
  /**
   * The user paused this cell themselves (the video context menu, or any other
   * route to a pause the director did not ask for). While it is set the
   * director leaves the element alone entirely — it neither resumes it nor
   * counts it against the cap. Cleared when the cell leaves the viewport, which
   * is the natural reset: the intent was about the thing on screen, and by the
   * time it comes back it is a new look at it.
   */
  userPaused: boolean
}

/** The registry's own record: the policy fields, and nothing else yet. */
type Entry = PlaybackState

/**
 * What the policy has decided about one cell, by position in the array it was
 * given.
 *
 *   - `"play"` / `"pause"` — hand this to `apply`.
 *   - `"skip"` — LEAVE THE ELEMENT ALONE. It is the user's own pause: the
 *     director neither resumes it nor pauses it again, and (see the cap below)
 *     it is not counted against the cap either.
 *
 * `clearUserPaused` is the one piece of state the policy decides but does not
 * own — the caller writes it back. It is separated out rather than mutated
 * here so the planner stays a function of its inputs.
 */
export interface PlaybackDecision {
  action: "play" | "pause" | "skip"
  clearUserPaused: boolean
}

/**
 * THE POLICY, as arithmetic: which cells should be playing, given what the
 * observer last reported about each and whether the page is scrolling fast.
 *
 * Pure and element-free on purpose. Everything that made this hard to be sure
 * about — the incumbency-first ordering, a user-paused cell being excluded
 * from the playing set AND from the cap it would otherwise consume, the
 * fast-scroll override outranking all of it — is a claim about numbers, and
 * having it here means scripts/playback.test.mjs can pin those claims without
 * a DOM. `reconcile` below maps the answers onto elements and is the only
 * thing that touches one.
 *
 * `states` is in registration order, and the returned array is parallel to it.
 * Ties in the over-cap ordering (same intent, same ratio) therefore resolve to
 * registration order, because the sort is stable.
 */
export function planPlayback(
  states: readonly PlaybackState[],
  fastScroll: boolean
): PlaybackDecision[] {
  // The fast-scroll override, and it is total: everything stops, including
  // cells that are fully visible and cells the user paused by hand. Their
  // pause-intent is deliberately NOT cleared — a flick past a cell the user
  // silenced must not un-silence it.
  if (fastScroll) {
    return states.map(() => ({ action: "pause", clearUserPaused: false }))
  }
  const decisions: PlaybackDecision[] = []
  const candidates: number[] = []
  for (let i = 0; i < states.length; i += 1) {
    const state = states[i]
    if (state.ratio < VISIBLE_RATIO) {
      // Off screen: paused, and the user's pause-intent expires here. Leaving
      // the viewport is the natural reset — the next time this cell is on
      // screen it is a fresh look at it, not the one they silenced.
      decisions.push({ action: "pause", clearUserPaused: true })
      continue
    }
    if (state.userPaused) {
      // Neither resumed nor counted against the cap: it is not competing for a
      // decode session, so its slot belongs to a cell that is actually
      // animating.
      decisions.push({ action: "skip", clearUserPaused: false })
      continue
    }
    decisions.push({ action: "play", clearUserPaused: false })
    candidates.push(i)
  }
  if (candidates.length > MAX_PLAYING) {
    // Only ever sorted in the over-cap case, which is the one the cap exists
    // for. ALREADY PLAYING WINS, then the more visible of the rest: keeping
    // the incumbent is what stops a boundary cell from being started and
    // stopped on alternating callbacks, and among newcomers the cell the user
    // can see more of is the one worth a decode session.
    candidates.sort((a, b) => {
      const ea = states[a]
      const eb = states[b]
      if (ea.playing !== eb.playing) return ea.playing ? -1 : 1
      return eb.ratio - ea.ratio
    })
    for (let i = MAX_PLAYING; i < candidates.length; i += 1) {
      decisions[candidates[i]].action = "pause"
    }
  }
  return decisions
}

/**
 * What the arming rule needs to know at the moment of a `pointerenter`.
 * Element-free for the same reason PlaybackState is: the rule is a comparison
 * of two timestamps and a boolean, and scripts/hoveranimate.test.mjs pins it
 * without a DOM.
 */
export interface HoverArmInputs {
  /** `performance.now()` at the entry. */
  now: number
  /** When the pointer last actually moved; 0 = it never has. */
  lastRealMoveAt: number
  /** Is the page scrolling fast enough that the director has suspended? */
  fastScroll: boolean
}

/**
 * MAY THIS ENTRY ARM A HOVER? (D6)
 *
 * Two conditions, and both are about telling a person arriving at a cell from
 * a cell arriving at a stationary pointer:
 *
 *   - a REAL pointer move within the last `HOVER_MOVE_WINDOW_MS`. See that
 *     constant: content scrolling under a still cursor delivers genuine
 *     `pointerenter` events, and nothing about the event itself distinguishes
 *     them from the user reaching for the cell;
 *   - the director is not suspended. A fast scroll is the one state where the
 *     answer is already known for every cell on the page, so an entry during
 *     one is not worth a dwell timer that the next scroll sample would cancel.
 *
 * A future timestamp (a clock read taken before the move it is compared
 * against) fails rather than passing on a negative age — it is a state this
 * cannot be in, and treating it as "moved 0 ms ago" would arm on exactly the
 * events the window exists to refuse.
 */
export function canArmHover(input: HoverArmInputs): boolean {
  if (input.fastScroll) return false
  if (!(input.lastRealMoveAt > 0)) return false
  const age = input.now - input.lastRealMoveAt
  return age >= 0 && age <= HOVER_MOVE_WINDOW_MS
}

const entries = new Map<HTMLVideoElement, Entry>()

let observer: IntersectionObserver | null = null
let listenersBound = false
let fastScroll = false
let settleTimer: ReturnType<typeof setTimeout> | undefined

/**
 * The pointer's last position and the time it last CHANGED. Two numbers and a
 * timestamp, written by the one `pointermove` listener below — this is the
 * entire standing cost of the hover machinery on a page nobody is hovering.
 */
let lastMoveX = NaN
let lastMoveY = NaN
let lastRealMoveAt = 0

/**
 * The ONE hover slot (D7). At most one cell is ever armed or hover-playing:
 * arming another releases this one, which is what makes "entering another
 * stops the previous" a property of the director rather than an agreement
 * between cells that cannot see each other.
 */
interface HoverArm {
  /** The cell's hover root, so a re-entry on the same one is a no-op. */
  root: Element
  onFire: (playing: boolean) => void
  timer: ReturnType<typeof setTimeout> | undefined
  fired: boolean
}
let hoverArm: HoverArm | null = null

/** How many surfaces are watching the pointer (see `trackHoverPointer`). */
let hoverTrackers = 0

/**
 * Last scroll offset seen per scroller, for the velocity sample. A WeakMap so a
 * scroller that goes away with its subtree takes its entry with it.
 */
const lastOffsets = new WeakMap<EventTarget, { at: number; offset: number }>()

/**
 * Register a mounted loop element. Returns the unregister function, so the
 * caller's effect is a one-liner and cannot leak a half-registered element.
 *
 * THE DIRECTOR STARTS PLAYBACK, and nothing else does. The elements carry no
 * `autoplay` and `preload="none"`, so an unregistered — or registered but
 * off-screen — loop has not even fetched its bytes; the first `play()` here is
 * what asks the network for them. That is the point: an earlier build let the
 * element decide and fetched every mounted loop whether or not anyone saw it.
 * The cost is that a cell is its poster until the first observer callback
 * arrives, which the browser delivers as soon as it has computed intersection.
 *
 * The unregister PAUSES on the way out. An element that is unmounting does not
 * care, but one that is merely occluded (the extreme-aspect hover layer) is
 * still on the page and would otherwise go on decoding underneath.
 */
export function observeAnimatedCell(video: HTMLVideoElement): () => void {
  if (typeof window === "undefined") return () => {}
  entries.set(video, { ratio: 0, playing: false, userPaused: false })
  ensureObserver().observe(video)
  bindDocumentListeners()
  return () => {
    observer?.unobserve(video)
    const entry = entries.get(video)
    if (entry) apply(video, entry, false)
    entries.delete(video)
    maybeTeardown()
  }
}

/**
 * Start watching the pointer for a surface that can hover-play cells — the
 * result grid and the gallery filmstrip — and return the release.
 *
 * WHY A HOST CALLS THIS RATHER THAN A CELL. The arming rule asks how long ago
 * the pointer last moved, so the listener that answers it has to be running
 * BEFORE the first `pointerenter`; a listener bound by the first arm attempt
 * would make the first hover on every page the one that does nothing. Hosts
 * mount once and cells mount by the hundred, so the host is the right place —
 * and refcounting means two surfaces on screen at once (the maximized board's
 * strip over a grid) still share one listener.
 *
 * WHAT IT COSTS A SURFACE THAT NOBODY HOVERS: the `pointermove` listener's
 * coordinate compare (see onPointerMove) and the scroll sampler's one property
 * read per scroll event. The sampler is not optional here — `fastScroll` is
 * half the arming rule and both halves of the scroll cancellation, and a
 * hover-mode grid has no registered `<video>` to have bound it, so without this
 * the director would answer "not scrolling" to every arming question. The
 * `play`/`pause` pair rides along because the four have one lifetime; on a page
 * with no registered element they see nothing and answer nothing.
 */
export function trackHoverPointer(): () => void {
  if (typeof window === "undefined") return () => {}
  hoverTrackers += 1
  bindDocumentListeners()
  let released = false
  return () => {
    if (released) return
    released = true
    hoverTrackers -= 1
    maybeTeardown()
  }
}

/**
 * Arm a hover on one cell (D6/D7), returning the cancel its caller runs on
 * `pointerleave` or unmount.
 *
 * `onFire(true)` lands after the dwell; `onFire(false)` is the director taking
 * the slot back — another cell was entered, or a scroll suspended playback —
 * and is the only way a cell learns to stop that is not its own pointer
 * leaving. The returned cancel does NOT call back: the caller that runs it
 * already knows.
 *
 * Re-entering the SAME root while armed keeps the existing arm rather than
 * restarting the dwell. That is the Chromium re-dispatch again (see
 * HOVER_MOVE_WINDOW_MS): a cell that stays under a stationary pointer through
 * a scroll can be handed repeated entries, and restarting on each would mean a
 * dwell that never completes.
 */
export function armHoverPlay(
  root: Element,
  onFire: (playing: boolean) => void
): () => void {
  if (typeof window === "undefined") return () => {}
  if (hoverArm && hoverArm.root === root) return cancelFor(hoverArm)
  releaseHoverSlot()
  if (!canArmHover({ now: performance.now(), lastRealMoveAt, fastScroll })) {
    return () => {}
  }
  const arm: HoverArm = { root, onFire, timer: undefined, fired: false }
  hoverArm = arm
  arm.timer = setTimeout(() => {
    arm.timer = undefined
    arm.fired = true
    arm.onFire(true)
  }, HOVER_DWELL_MS)
  return cancelFor(arm)
}

function cancelFor(arm: HoverArm): () => void {
  return () => {
    if (hoverArm !== arm) return
    hoverArm = null
    clearTimeout(arm.timer)
  }
}

/** Take the slot back, telling the cell holding it to stop if it had started. */
function releaseHoverSlot(): void {
  const arm = hoverArm
  if (!arm) return
  hoverArm = null
  clearTimeout(arm.timer)
  if (arm.fired) arm.onFire(false)
}

function ensureObserver(): IntersectionObserver {
  if (observer) return observer
  observer = new IntersectionObserver(
    (records) => {
      for (const record of records) {
        const entry = entries.get(record.target as HTMLVideoElement)
        if (entry) entry.ratio = record.intersectionRatio
      }
      reconcile()
    },
    // Two thresholds, not one: a single 0.5 threshold only fires as the ratio
    // CROSSES it, which is all the play/pause decision needs, while 0 is what
    // makes a cell that scrolls fully out report a ratio of 0 rather than
    // keeping its last above-threshold reading. Both are needed for the
    // over-cap ordering to be sorting real numbers.
    { threshold: [0, VISIBLE_RATIO] }
  )
  return observer
}

function bindDocumentListeners(): void {
  if (listenersBound) return
  // Capture phase for all of them: none of `scroll`, `play` or `pause` bubbles,
  // so this is the only way ONE listener can see every scroller and every media
  // element on the page — the grid's, the filmstrip's, and the document's.
  // Passive, because none must ever be able to delay what it only observes.
  document.addEventListener("scroll", onScroll, { capture: true, passive: true })
  document.addEventListener("play", onPlay, { capture: true, passive: true })
  document.addEventListener("pause", onPause, { capture: true, passive: true })
  // `pointermove` needs no capture (it bubbles), and is listed here so the
  // whole set has one lifetime. See onPointerMove for what it costs.
  document.addEventListener("pointermove", onPointerMove, { passive: true })
  listenersBound = true
}

/**
 * Tear the shared machinery down once nothing needs it: no registered loop AND
 * no surface watching the pointer. The two counts are separate because a
 * hover-mode grid has a tracker and, until someone dwells on a cell, not one
 * registered element.
 */
function maybeTeardown(): void {
  if (entries.size > 0 || hoverTrackers > 0) return
  observer?.disconnect()
  observer = null
  if (listenersBound) {
    document.removeEventListener("scroll", onScroll, { capture: true })
    document.removeEventListener("play", onPlay, { capture: true })
    document.removeEventListener("pause", onPause, { capture: true })
    document.removeEventListener("pointermove", onPointerMove)
    listenersBound = false
  }
  releaseHoverSlot()
  clearTimeout(settleTimer)
  settleTimer = undefined
  fastScroll = false
  lastRealMoveAt = 0
  lastMoveX = NaN
  lastMoveY = NaN
}

/**
 * THE STANDING COST OF THE HOVER MACHINERY, in full: a comparison of two
 * numbers and, when they differ, two writes and a clock read. No layout is
 * read, nothing is allocated, and nothing per cell runs at all — which is what
 * makes it safe to leave bound for the life of a grid that nobody hovers.
 *
 * The comparison is the point rather than an optimisation: an event whose
 * coordinates are identical to the last one is not the pointer moving, and
 * treating it as one would re-open the very window `canArmHover` closes.
 */
function onPointerMove(event: Event): void {
  const pointer = event as PointerEvent
  if (pointer.clientX === lastMoveX && pointer.clientY === lastMoveY) return
  lastMoveX = pointer.clientX
  lastMoveY = pointer.clientY
  lastRealMoveAt = performance.now()
}

function onScroll(event: Event): void {
  const target = event.target
  if (!target) return
  // SCROLL START CANCELS A PENDING DWELL (D6), at any speed and before any
  // velocity arithmetic. The content under the pointer is moving, so whatever
  // cell the entry named is not the cell that will be there in 200ms — and
  // waiting for the fast-scroll threshold would let a slow drag hand the user
  // an animation on a cell they were only scrolling past. A dwell that has
  // already FIRED is left alone here; it is the pointer leaving the cell, or
  // the suspend below, that stops it.
  if (hoverArm && !hoverArm.fired) cancelFor(hoverArm)()
  // ONE property read per event, the same reading the grid's own scroll
  // listener already takes. Reading a scroller's offset does not invalidate
  // layout, and this runs once per scroll event rather than per frame.
  const offset =
    target === document || target === document.documentElement
      ? window.scrollY
      : (target as HTMLElement).scrollTop ?? 0
  const now = performance.now()
  const previous = lastOffsets.get(target)
  lastOffsets.set(target, { at: now, offset })
  if (!previous) return
  const elapsed = now - previous.at
  // A zero (or absurd) interval says nothing about speed; skip the sample
  // rather than divide by it.
  if (elapsed <= 0 || elapsed > 500) return
  const speed = Math.abs(offset - previous.offset) / elapsed
  if (speed < FAST_SCROLL_PX_PER_MS) return
  clearTimeout(settleTimer)
  settleTimer = setTimeout(settle, SETTLE_MS)
  if (fastScroll) return
  fastScroll = true
  // The suspend takes the hover slot back as well (D6). A hover-played cell is
  // about to be paused by the reconcile below whatever happens, and leaving its
  // <video> mounted over the poster it is indistinguishable from would keep a
  // decode session for a picture that has stopped moving.
  releaseHoverSlot()
  reconcile()
}

/**
 * A registered element started playing without the director having asked. With
 * `autoplay` dropped the browser no longer does this on its own, so the only
 * routes left are the user's (the video context menu's Play) and anything that
 * gets a `play()` past us in future. DEFENSIVE, and kept precisely because the
 * cap is only a cap if nothing can start a cell behind its back: reconcile puts
 * the element back under policy — resumed if it belongs in the playing set,
 * paused if it does not.
 *
 * Cannot recurse: the reconcile it triggers only ever calls `play()` on an
 * element that is currently paused, so a `play` it causes is one it will not
 * cause again.
 */
function onPlay(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLVideoElement)) return
  const entry = entries.get(target)
  if (!entry) return
  // Starting a cell by hand withdraws an earlier pause-by-hand. Without this
  // the exclusion below would make the user's own Play a no-op that reconcile
  // immediately undoes.
  entry.userPaused = false
  reconcile()
}

/**
 * A registered element stopped. `entry.playing` is what tells the two cases
 * apart, and it is reliable in both directions because `apply` writes the
 * intent BEFORE it touches the element, while the event arrives on a later
 * task:
 *
 *   - intent already `false` — the director's own pause (off screen, over the
 *     cap, fast scroll, occluded). Nothing to do.
 *   - intent still `true` — nobody here asked for this, so it is the user
 *     (the video context menu is the reachable route) or the browser reclaiming
 *     a decoder. Either way the cell should stay stopped: an animation the user
 *     silenced must not come back on the next scroll event.
 *
 * The exclusion is cleared when the cell leaves the viewport (see `reconcile`),
 * so it never becomes permanent state to reason about.
 */
function onPause(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLVideoElement)) return
  const entry = entries.get(target)
  if (!entry || !entry.playing) return
  entry.playing = false
  entry.userPaused = true
}

function settle(): void {
  settleTimer = undefined
  if (!fastScroll) return
  fastScroll = false
  reconcile()
}

/**
 * Bring every registered element in line with the policy. Runs on observer
 * callbacks and on the two fast-scroll transitions — never on a timer and
 * never per frame — and touches an element only when its state should change,
 * so a settled screenful reconciles to zero DOM calls.
 *
 * The DECIDING is planPlayback's; this is the mapping onto elements. Map
 * iteration order is insertion order, which is registration order, which is
 * the order the planner's stable sort breaks ties in.
 */
function reconcile(): void {
  const videos = [...entries.keys()]
  const states = videos.map((video) => entries.get(video)!)
  const decisions = planPlayback(states, fastScroll)
  // EVERY PAUSE BEFORE ANY PLAY, which is what the branch-by-branch version
  // did for free and what keeps the cap from being momentarily exceeded: a
  // cell handing its slot over must have released its decode session before
  // the cell taking it asks for one.
  for (let i = 0; i < videos.length; i += 1) {
    const decision = decisions[i]
    if (decision.clearUserPaused) states[i].userPaused = false
    if (decision.action === "pause") apply(videos[i], states[i], false)
  }
  for (let i = 0; i < videos.length; i += 1) {
    if (decisions[i].action === "play") apply(videos[i], states[i], true)
  }
}

function apply(video: HTMLVideoElement, entry: Entry, playing: boolean): void {
  // The intent is written FIRST, and `onPause` depends on that ordering to tell
  // the director's own pause from the user's.
  entry.playing = playing
  // GATED ON THE ELEMENT, never on the intent above. Anything can have moved
  // the element since the last reconcile — the user through the video context
  // menu, or (in the build that still carried `autoplay`) the browser itself,
  // which left every autoplaying cell past the cap running because the intent
  // still read "not playing" and the call was skipped: measured at 32 visible
  // cells, 32 playing. `paused` is a plain property read, no layout, and it is
  // the only thing that knows the truth.
  if (playing) {
    if (!video.paused) return
    // The rejection is expected traffic, not an error: a pause landing between
    // this call and the frame that would have started it rejects the promise
    // with an AbortError, and an unhandled one is console noise on every fast
    // scroll. Swallowed here rather than reported, because the director's next
    // reconcile is the answer to every reason this can fail.
    void video.play().catch(() => {})
  } else if (!video.paused) {
    video.pause()
  }
}

/** Test seam: the numbers the policy is written in. */
export const ANIMATED_PLAYBACK = {
  VISIBLE_RATIO,
  MAX_PLAYING,
  FAST_SCROLL_PX_PER_MS,
  SETTLE_MS,
  HOVER_MOVE_WINDOW_MS,
  HOVER_DWELL_MS,
} as const
