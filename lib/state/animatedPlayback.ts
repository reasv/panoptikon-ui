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
//   * ONE Map of registered elements.
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

interface Entry {
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

const entries = new Map<HTMLVideoElement, Entry>()

let observer: IntersectionObserver | null = null
let scrollBound = false
let fastScroll = false
let settleTimer: ReturnType<typeof setTimeout> | undefined

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
  bindScroll()
  return () => {
    observer?.unobserve(video)
    const entry = entries.get(video)
    if (entry) apply(video, entry, false)
    entries.delete(video)
    if (entries.size === 0) teardown()
  }
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

function bindScroll(): void {
  if (scrollBound) return
  // Capture phase for both: neither `scroll` nor `play` bubbles, so this is the
  // only way ONE listener can see every scroller and every media element on the
  // page — the grid's, the filmstrip's, and the document's. Passive, because
  // neither must ever be able to delay what it only observes.
  document.addEventListener("scroll", onScroll, { capture: true, passive: true })
  document.addEventListener("play", onPlay, { capture: true, passive: true })
  document.addEventListener("pause", onPause, { capture: true, passive: true })
  scrollBound = true
}

function teardown(): void {
  observer?.disconnect()
  observer = null
  if (scrollBound) {
    document.removeEventListener("scroll", onScroll, { capture: true })
    document.removeEventListener("play", onPlay, { capture: true })
    document.removeEventListener("pause", onPause, { capture: true })
    scrollBound = false
  }
  clearTimeout(settleTimer)
  settleTimer = undefined
  fastScroll = false
}

function onScroll(event: Event): void {
  const target = event.target
  if (!target) return
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
 */
function reconcile(): void {
  if (fastScroll) {
    for (const [video, entry] of entries) apply(video, entry, false)
    return
  }
  const visible: HTMLVideoElement[] = []
  for (const [video, entry] of entries) {
    if (entry.ratio < VISIBLE_RATIO) {
      // Off screen: paused, and the user's pause-intent expires here. Leaving
      // the viewport is the natural reset — the next time this cell is on
      // screen it is a fresh look at it, not the one they silenced.
      entry.userPaused = false
      apply(video, entry, false)
      continue
    }
    // A cell the user stopped is neither resumed nor counted against the cap:
    // it is not competing for a decode session, so its slot belongs to a cell
    // that is actually animating.
    if (entry.userPaused) continue
    visible.push(video)
  }
  if (visible.length > MAX_PLAYING) {
    // Only ever sorted in the over-cap case, which is the one the cap exists
    // for. ALREADY PLAYING WINS, then the more visible of the rest: keeping
    // the incumbent is what stops a boundary cell from being started and
    // stopped on alternating callbacks, and among newcomers the cell the user
    // can see more of is the one worth a decode session.
    visible.sort((a, b) => {
      const ea = entries.get(a)!
      const eb = entries.get(b)!
      if (ea.playing !== eb.playing) return ea.playing ? -1 : 1
      return eb.ratio - ea.ratio
    })
    for (let i = MAX_PLAYING; i < visible.length; i += 1) {
      apply(visible[i], entries.get(visible[i])!, false)
    }
    visible.length = MAX_PLAYING
  }
  for (const video of visible) apply(video, entries.get(video)!, true)
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
} as const
