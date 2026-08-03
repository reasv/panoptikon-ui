// Assertions for lib/pinboardOverlap.ts, the gravity-off overlap resolver.
// No test runner in this repo — run it directly from the ui root:
//
//   node --experimental-strip-types scripts/overlap.test.mjs
//
// (the flag is what lets a .mjs import the .ts module; Node 22+). Exits
// non-zero on the first failing assertion set.

import { resolveOverlapsDown } from "../lib/pinboardOverlap.ts"

const show = (ls) =>
  ls.map((l) => `${l.i}(${l.x},${l.y},${l.w}x${l.h}${l.static ? ",S" : ""})`).join(" ")

const hit = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

// Every pair of boxes in the emitted layout must be disjoint, except pairs
// listed in `allow` (pre-existing overlaps the resolver is asked to leave
// alone).
function noOverlaps(out, allow = []) {
  const allowed = new Set(allow.map((p) => p.slice().sort().join("|")))
  const bad = []
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (!hit(out[i], out[j])) continue
      if (allowed.has([out[i].i, out[j].i].sort().join("|"))) continue
      bad.push(`${out[i].i}/${out[j].i}`)
    }
  }
  return bad
}

function check(name, out, expect, allow = []) {
  const got = Object.fromEntries(out.map((l) => [l.i, l.y]))
  const bad = noOverlaps(out, allow)
  const ok = Object.entries(expect).every(([k, v]) => got[k] === v) && bad.length === 0
  console.log(`${ok ? "PASS" : "FAIL"} ${name}\n  ${show(out)}`)
  if (!ok) {
    console.log(`  expected ${JSON.stringify(expect)} got ${JSON.stringify(got)}`)
    if (bad.length) console.log(`  OVERLAPS: ${bad.join(", ")}`)
  }
  return ok
}

let all = true

// ---- the original six cases -----------------------------------------

// 1. Rotate-style w/h swap: A was 4x2 at (0,0), rotated to 2x4; B sat at
//    (0,2) 4x2 and is now overlapped.
all &= check("rotate swap creates overlap", resolveOverlapsDown([
  { i: "A", x: 0, y: 0, w: 2, h: 4 },
  { i: "B", x: 0, y: 2, w: 4, h: 2 },
], ["A"]), { A: 0, B: 4 })

// 2. Cascade through two items: A grows down onto B, B pushes C.
all &= check("cascade through two items", resolveOverlapsDown([
  { i: "A", x: 0, y: 0, w: 2, h: 5 },
  { i: "B", x: 0, y: 2, w: 2, h: 2 },
  { i: "C", x: 1, y: 4, w: 2, h: 2 },
], ["A"]), { A: 0, B: 5, C: 7 })

// 3. Static in the path: the cascade is pushed PAST the anchor, and the
//    anchor itself never moves.
all &= check("static in the path", resolveOverlapsDown([
  { i: "A", x: 0, y: 0, w: 2, h: 4 },
  { i: "B", x: 0, y: 2, w: 2, h: 2 },
  { i: "S", x: 0, y: 5, w: 2, h: 2, static: true },
], ["A"]), { A: 0, B: 7, S: 5 })

// 4. No overlap: identity, same array back.
const src = [
  { i: "A", x: 0, y: 0, w: 2, h: 2 },
  { i: "B", x: 0, y: 3, w: 2, h: 2 },
  { i: "C", x: 4, y: 0, w: 2, h: 9 },
]
const out4 = resolveOverlapsDown(src, ["A"])
const same = out4 === src
all &= check("no-op when nothing overlaps", out4, { A: 0, B: 3, C: 0 })
console.log(`${same ? "PASS" : "FAIL"} no-op returns the input array identity`)
all &= same

// 5. Items beside/above the changed one are untouched; only the true
//    collider moves, and never upward.
all &= check("bystanders untouched, no upward settle", resolveOverlapsDown([
  { i: "Above", x: 0, y: 0, w: 2, h: 2 },
  { i: "A", x: 0, y: 2, w: 4, h: 4 },
  { i: "Side", x: 6, y: 2, w: 2, h: 2 },
  { i: "Below", x: 0, y: 4, w: 2, h: 2 },
  { i: "Far", x: 0, y: 20, w: 2, h: 2 },
], ["A"]), { Above: 0, A: 2, Side: 2, Below: 6, Far: 20 })

// ---- finding 1: changed items colliding with each other ---------------

// Two changed boxes grown into one another: the topmost keeps its place,
// the later one is pushed down like any mover, and x never changes.
const out6 = resolveOverlapsDown([
  { i: "B", x: 1, y: 2, w: 2, h: 3 },
  { i: "A", x: 0, y: 0, w: 2, h: 4 },
], ["A", "B"])
all &= check("two changed items collide: later one drops", out6, { A: 0, B: 4 })
const xKept = out6.every((l) => l.x === (l.i === "A" ? 0 : 1))
console.log(`${xKept ? "PASS" : "FAIL"} changed items keep their x`)
all &= xKept

// The rotate-right-on-a-selection shape: two side-by-side 4x2 boxes turned
// into 2x4, each landing on the pin below it, plus a mover the pair now
// share. Deterministic and overlap-free whatever order the keys arrive in.
all &= check("selection rotate: mutual + shared collider", resolveOverlapsDown([
  { i: "L", x: 0, y: 0, w: 2, h: 4 },
  { i: "R", x: 1, y: 3, w: 2, h: 4 },
  { i: "M", x: 0, y: 6, w: 4, h: 2 },
], ["L", "R"]), { L: 0, R: 4, M: 8 })

// ---- finding 2: a changed item grown onto a static --------------------

// The static never moves; the CHANGED box drops past it, then its own new
// collisions resolve normally.
all &= check("changed grows onto a static", resolveOverlapsDown([
  { i: "A", x: 0, y: 0, w: 2, h: 4 },
  { i: "S", x: 0, y: 2, w: 2, h: 2, static: true },
  { i: "M", x: 0, y: 4, w: 2, h: 2 },
], ["A"]), { A: 4, S: 2, M: 8 })

// ---- finding 3: the open crop item is immovable ------------------------

// A verb on another pin may not move the crop window: it is a wall, so the
// changed box goes past it instead.
all &= check("changed grows onto the crop item", resolveOverlapsDown([
  { i: "A", x: 0, y: 0, w: 2, h: 4 },
  { i: "CROP", x: 0, y: 2, w: 2, h: 2 },
], ["A"], ["CROP"]), { A: 4, CROP: 2 })

// ... and a cascade that reaches the crop window is pushed past it too.
all &= check("cascade past the crop item", resolveOverlapsDown([
  { i: "A", x: 0, y: 0, w: 2, h: 4 },
  { i: "M", x: 0, y: 2, w: 2, h: 2 },
  { i: "CROP", x: 0, y: 4, w: 2, h: 2 },
], ["A"], ["CROP"]), { A: 0, M: 6, CROP: 4 })

// Without the held key that same board moves the crop item — the wall is
// what the crop session buys, not an accident of the geometry.
all &= check("same board, crop item not held: it moves", resolveOverlapsDown([
  { i: "A", x: 0, y: 0, w: 2, h: 4 },
  { i: "M", x: 0, y: 2, w: 2, h: 2 },
  { i: "CROP", x: 0, y: 4, w: 2, h: 2 },
], ["A"]), { A: 0, M: 4, CROP: 6 })

// ---- a wall that is ALSO changed: immovable, but HOT --------------------

// The verb is run on the crop item itself (Set Size / Resize / Rotate on
// the pin whose crop session is open), so CROP is in changedKeys AND in
// heldKeys. It must keep its position — held wins for x/y — while its grown
// footprint still pushes the mover it landed on.
all &= check("held AND changed: stays put, still pushes", resolveOverlapsDown([
  { i: "CROP", x: 0, y: 0, w: 2, h: 4 },
  { i: "M", x: 0, y: 2, w: 2, h: 2 },
], ["CROP"], ["CROP"]), { CROP: 0, M: 4 })

// Control: the identical board with no crop session open. The held key is
// what pins CROP's position, not the outcome — the mover drops either way.
all &= check("same board with no crop session: same push", resolveOverlapsDown([
  { i: "CROP", x: 0, y: 0, w: 2, h: 4 },
  { i: "M", x: 0, y: 2, w: 2, h: 2 },
], ["CROP"]), { CROP: 0, M: 4 })

// The static twin: a verb run on an anchored pin. Static wins for position
// (the anchor does not move, even though the verb grew it), and the new
// footprint is hot all the same.
all &= check("static AND changed: stays put, still pushes", resolveOverlapsDown([
  { i: "A", x: 0, y: 0, w: 2, h: 4, static: true },
  { i: "M", x: 0, y: 2, w: 2, h: 2 },
], ["A"]), { A: 0, M: 4 })

// ---- finding 5: the cascade follows the changed footprint only --------

// U1/U2 already overlap and nothing the verb touched reaches them: they
// stay exactly where they are (and the whole call is an identity return).
const src10 = [
  { i: "U1", x: 0, y: 0, w: 2, h: 4 },
  { i: "U2", x: 0, y: 2, w: 2, h: 4 },
  { i: "A", x: 6, y: 0, w: 2, h: 2 },
]
const out10 = resolveOverlapsDown(src10, ["A"])
all &= check("pre-existing overlap between untouched movers survives",
  out10, { U1: 0, U2: 2, A: 0 }, [["U1", "U2"]])
const same10 = out10 === src10
console.log(`${same10 ? "PASS" : "FAIL"} untouched pre-existing overlap returns the input array identity`)
all &= same10

// A pre-existing overlap the cascade DOES reach is separated like any
// other collision: A pushes U1, U1 then clears U2.
all &= check("pre-existing overlap inside the cascade is separated",
  resolveOverlapsDown([
    { i: "A", x: 0, y: 0, w: 2, h: 3 },
    { i: "U1", x: 0, y: 2, w: 2, h: 4 },
    { i: "U2", x: 0, y: 4, w: 2, h: 4 },
  ], ["A"]), { A: 0, U1: 3, U2: 7 })

console.log(all ? "\nALL PASS" : "\nFAILURES")
process.exit(all ? 0 : 1)
