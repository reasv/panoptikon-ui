// Assertions for the fit-to-cell auto crop in lib/pinboardCrop.ts: the
// centered window, the deep-cut top anchor, and the near-fit letterbox
// guard. No test runner in this repo — run it directly from the ui root:
//
//   node --experimental-strip-types scripts/crop.test.mjs
//
// (the flag is what lets a .mjs import the .ts module; Node 22+). Exits
// non-zero on the first failing assertion set.

import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const { AUTO_CROP_TOP_ANCHOR_CUT, computeAutoCrop } = await import(
  "../lib/pinboardCrop.ts"
)

let all = true
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `\n  ${detail}` : ""}`)
  all &&= !!ok
  return ok
}
const near = (a, b) => Math.abs(a - b) < 1e-9

// A square cell large enough that no cut in these cases is letterbox-exempt
const CELL = 300

check("a perfect fit is no crop", computeAutoCrop(1, CELL, CELL) === null)

check(
  "a near-fit under the letterbox guard is no crop",
  computeAutoCrop(0.99, CELL, CELL) === null
)

{
  // Wide base in a square cell: a deep horizontal cut, still centered —
  // the top-anchor rule is vertical-only
  const c = computeAutoCrop(2, CELL, CELL)
  check(
    "horizontal cuts center regardless of depth",
    c !== null && near(c.x, 0.25) && near(c.w, 0.5) && c.y === 0 && c.h === 1,
    JSON.stringify(c)
  )
}

{
  // Tall base, shallow cut (0.1 of the height, below the threshold):
  // evened out top and bottom
  const c = computeAutoCrop(0.9, CELL, CELL)
  check(
    "shallow vertical cuts stay centered",
    c !== null && near(c.y, 0.05) && near(c.h, 0.9) && c.x === 0 && c.w === 1,
    JSON.stringify(c)
  )
}

{
  // Portrait in a square cell: a third of the height goes, all of it from
  // the bottom — the top edge is preserved exactly
  const c = computeAutoCrop(2 / 3, CELL, CELL)
  check(
    "deep vertical cuts anchor to the top",
    c !== null && c.y === 0 && near(c.h, 2 / 3),
    JSON.stringify(c)
  )
}

{
  // A cut just under the threshold still centers — the anchor engages
  // only past it. (Exact equality is untestable here: 1 - f reintroduces
  // float error, and real aspects never land on the boundary anyway.)
  const f = 1 - (AUTO_CROP_TOP_ANCHOR_CUT - 1e-6)
  const c = computeAutoCrop(f, CELL, CELL)
  check(
    "a cut just under the threshold stays centered",
    c !== null && near(c.y, (1 - f) / 2) && near(c.h, f),
    JSON.stringify(c)
  )
}

process.exit(all ? 0 : 1)
