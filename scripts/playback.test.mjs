// Assertions for the animated-grid playback POLICY (lib/state/animatedPlayback.ts
// planPlayback). The contract is
// docs/grid-scroll-performance-implementation.md §2 F6: "a cap on concurrently
// playing animations (IntersectionObserver; pause off-screen and during fast
// scroll)". No test runner in this repo — run it from the ui root:
//
//   node --experimental-strip-types scripts/playback.test.mjs
//
// The policy is deliberately element-free — planPlayback is arithmetic over
// {ratio, playing, userPaused} and a boolean — which is what lets these run
// under plain node with no DOM at all. The module around it (the observer, the
// capture-phase listeners, `apply`) touches the document only from inside
// functions, so importing it here starts nothing. Exits non-zero on failure.

import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const { ANIMATED_PLAYBACK, planPlayback } = await import(
  "../lib/state/animatedPlayback.ts"
)
const { VISIBLE_RATIO, MAX_PLAYING } = ANIMATED_PLAYBACK

let all = true
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `\n  ${detail}` : ""}`)
  all &&= !!ok
}

// A cell, with the defaults a freshly registered one carries.
const cell = ({ ratio = 1, playing = false, userPaused = false } = {}) =>
  ({ ratio, playing, userPaused })
const actions = (states, fastScroll = false) =>
  planPlayback(states, fastScroll).map((d) => d.action)
const playingCount = (states, fastScroll = false) =>
  actions(states, fastScroll).filter((a) => a === "play").length

// ---- the visibility threshold ------------------------------------------
//
// Half on screen is the floor: a cell peeking over the fold is not being
// looked at, and starting it there is what makes a fast scroll start (and
// immediately abandon) a screenful of decodes.

{
  const states = [
    cell({ ratio: 0 }),
    cell({ ratio: VISIBLE_RATIO - 0.001 }),
    cell({ ratio: VISIBLE_RATIO }),
    cell({ ratio: 1 }),
  ]
  check(
    "a cell plays from exactly half visible upward, and not below it",
    actions(states).join(",") === "pause,pause,play,play",
    actions(states).join(",")
  )
}

{
  // Leaving the viewport is the natural reset for a pause-by-hand: the next
  // time the cell is on screen it is a fresh look at it.
  const plan = planPlayback(
    [cell({ ratio: 0, userPaused: true }), cell({ ratio: 1, userPaused: true })],
    false
  )
  check(
    "scrolling out clears the user's pause; staying on screen does not",
    plan[0].clearUserPaused === true && plan[1].clearUserPaused === false,
    `${plan[0].clearUserPaused} ${plan[1].clearUserPaused}`
  )
}

// ---- the user's own pause ----------------------------------------------
//
// Two claims, and the second is the one that is easy to get wrong: a cell the
// user stopped is left alone AND does not consume a cap slot. It is not
// competing for a decode session, so its slot belongs to a cell that is
// actually animating.

{
  const states = [cell({ userPaused: true }), cell()]
  check(
    "a user-paused visible cell is neither resumed nor paused again",
    actions(states).join(",") === "skip,play",
    actions(states).join(",")
  )
}

{
  // MAX_PLAYING user-paused cells in front of MAX_PLAYING ordinary ones: if
  // the excluded cells counted against the cap, every ordinary cell would be
  // held at its poster.
  const states = [
    ...Array.from({ length: MAX_PLAYING }, () => cell({ userPaused: true })),
    ...Array.from({ length: MAX_PLAYING }, () => cell()),
  ]
  const plan = actions(states)
  check(
    "user-paused cells do not consume cap slots",
    playingCount(states) === MAX_PLAYING
      && plan.slice(0, MAX_PLAYING).every((a) => a === "skip")
      && plan.slice(MAX_PLAYING).every((a) => a === "play"),
    `${playingCount(states)} of ${MAX_PLAYING}`
  )
}

// ---- the cap, and its boundary -----------------------------------------

{
  const atCap = Array.from({ length: MAX_PLAYING }, () => cell())
  const overByOne = Array.from({ length: MAX_PLAYING + 1 }, () => cell())
  check(
    "exactly MAX_PLAYING visible cells all play",
    playingCount(atCap) === MAX_PLAYING,
    `${playingCount(atCap)}`
  )
  check(
    "one more than the cap plays exactly the cap, and pauses the rest",
    playingCount(overByOne) === MAX_PLAYING
      && actions(overByOne).filter((a) => a === "pause").length === 1,
    `${playingCount(overByOne)}`
  )
}

{
  // Equal intent and equal ratio: the stable sort leaves registration order,
  // so the LAST-registered cell is the one that loses the slot.
  const states = Array.from({ length: MAX_PLAYING + 2 }, () => cell())
  const plan = actions(states)
  check(
    "an over-cap tie drops the last-registered cells, in order",
    plan.slice(0, MAX_PLAYING).every((a) => a === "play")
      && plan.slice(MAX_PLAYING).every((a) => a === "pause"),
    plan.join(",")
  )
}

// ---- incumbency outranks visibility ------------------------------------
//
// Keeping the incumbent is what stops a boundary cell from being started and
// stopped on alternating callbacks. It has to beat a MORE visible newcomer,
// or the flapping comes straight back.

{
  // One newcomer at full visibility, then a capful of barely-visible
  // incumbents. The newcomer is more visible than every one of them and still
  // loses, because it is not already playing.
  const states = [
    cell({ ratio: 1, playing: false }),
    ...Array.from({ length: MAX_PLAYING }, () =>
      cell({ ratio: VISIBLE_RATIO, playing: true })),
  ]
  const plan = actions(states)
  check(
    "a fully visible newcomer loses its slot to barely visible incumbents",
    plan[0] === "pause" && plan.slice(1).every((a) => a === "play"),
    plan.join(",")
  )
}

{
  // Among newcomers alone the tie-break IS visibility: the cell the user can
  // see more of is the one worth a decode session.
  const states = [
    ...Array.from({ length: MAX_PLAYING }, () => cell({ ratio: 0.6 })),
    cell({ ratio: 0.95 }),
  ]
  const plan = actions(states)
  check(
    "among newcomers the more visible cell takes the slot",
    plan[MAX_PLAYING] === "play"
      && plan.filter((a) => a === "pause").length === 1,
    plan.join(",")
  )
}

{
  // The two rules composed: incumbents fill the cap first, and the remaining
  // slots go to the most visible newcomers.
  const incumbents = MAX_PLAYING - 2
  const states = [
    cell({ ratio: 0.55, playing: false }),
    cell({ ratio: 0.99, playing: false }),
    cell({ ratio: 0.75, playing: false }),
    ...Array.from({ length: incumbents }, () =>
      cell({ ratio: 0.51, playing: true })),
  ]
  const plan = actions(states)
  check(
    "incumbents fill the cap, then the most visible newcomers take the rest",
    plan[0] === "pause" && plan[1] === "play" && plan[2] === "play"
      && plan.slice(3).every((a) => a === "play")
      && playingCount(states) === MAX_PLAYING,
    plan.join(",")
  )
}

// ---- fast scroll overrides everything ----------------------------------
//
// Above ~1200 px/s the animations are streaks, and the decode work is pure
// cost on the frames that can least afford it. The override is total — and it
// must NOT clear a pause-by-hand, or a flick past a cell the user silenced
// would un-silence it.

{
  const states = [
    cell({ ratio: 1, playing: true }),
    cell({ ratio: 0 }),
    cell({ ratio: 1, userPaused: true }),
  ]
  const plan = planPlayback(states, true)
  check(
    "fast scroll pauses every cell, whatever its state",
    plan.every((d) => d.action === "pause"),
    plan.map((d) => d.action).join(",")
  )
  check(
    "fast scroll never clears a pause-by-hand",
    plan.every((d) => d.clearUserPaused === false),
    plan.map((d) => d.clearUserPaused).join(",")
  )
}

{
  // A capful of settled, playing cells is the steady state, and the override
  // has to beat it outright rather than merely trimming it.
  const states = Array.from({ length: MAX_PLAYING }, () =>
    cell({ ratio: 1, playing: true }))
  check(
    "fast scroll outranks a fully settled screenful",
    playingCount(states) === MAX_PLAYING && playingCount(states, true) === 0,
    `${playingCount(states)} -> ${playingCount(states, true)}`
  )
}

// ---- the empty and the trivial -----------------------------------------

{
  check("no cells plans nothing", planPlayback([], false).length === 0)
  check("no cells plans nothing under fast scroll",
    planPlayback([], true).length === 0)
  check(
    "the plan is parallel to its input",
    planPlayback([cell(), cell({ ratio: 0 })], false).length === 2)
}

console.log(all ? "\nALL PASS" : "\nFAILURES")
process.exit(all ? 0 : 1)
