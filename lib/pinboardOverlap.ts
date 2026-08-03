// Overlap resolution for footprint-growing verbs on a gravity-off board.
//
// With gravity on, a verb that makes an item bigger (Resize Item / Set Size,
// the rotations' width<->height swap) can simply commit an overlapping
// layout: RGL's vertical compactor pushes the colliders out of the way in
// its own pass. With gravity off there is no such pass — noCompactor.compact
// is a clone — so the verb has to resolve its own collisions, and it must do
// it the way the compactor's push does and no more: colliders move straight
// DOWN by the minimal delta, cascading (a pushed item pushes whatever it
// lands on), and nothing ever settles back up. Settling up is precisely the
// behavior the user turned off.
//
// Two kinds of box never move. Statics (anchored pins) are immovable walls,
// and so are the explicitly HELD keys — the open crop window, which a verb
// fired from another pin must never shove out from under the session. Both
// are pushed PAST, never through, by anything that lands on them, INCLUDING
// a changed box: that mirrors what gravity-on does, where the compactor
// moves the non-static side of such a collision.
//
// Immovability and hotness are separate properties, though. A wall the verb
// ALSO changed — the user runs Set Size or a rotation on the crop item
// itself, or on an anchored pin — keeps its position (held/static wins:
// those verbs write w/h, not x/y) while its grown footprint still pushes
// whatever it grew into, exactly as a non-wall changed box would.
//
// The changed boxes themselves are the verb's whole point, so they keep
// their x always and their y wherever they can: only a wall, or an earlier
// changed box, can displace one.

import type { LayoutItem } from "react-grid-layout"

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// A placed box the cascade has to reckon with. HOT ones start a cascade —
// they are the changed footprints (a wall's included, when the verb changed
// that wall) and the items already displaced by them — while cold ones
// (unchanged walls, and movers that stayed put) only block a box that is
// already on its way down. That distinction is what confines the cascade to
// the changed footprint: an item nothing hot ever touches keeps its
// position, pre-existing overlaps between untouched items included.
interface Obstacle extends Rect {
  hot: boolean
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  )
}

/**
 * Push what the changed footprints hit down until nothing overlaps.
 * Returns the input array itself when nothing had to move, so a verb that
 * created no collision commits exactly what it computed.
 *
 * The pass is ordered, and one pass is enough because of the order:
 *
 *  - Walls (statics and `heldKeys`) are obstacles from the start and never
 *    move, whatever the processing order. A wall that is itself in
 *    `changedKeys` is one of them — immovable, but hot, so the movers it
 *    grew into still get out of its way.
 *  - The changed items are placed next, topmost-first (y, then x, then key
 *    for a total order). Each keeps its x and its y unless it overlaps a
 *    wall or an already-placed changed item, in which case it drops past
 *    it. So the topmost of two changed items that grew into each other
 *    keeps its place and the later one moves — deterministically, without
 *    either of them being left overlapping.
 *  - The movers follow, in their ORIGINAL vertical order, and only those
 *    reached by the cascade move: a mover starts falling only when it
 *    overlaps a changed box or an already-pushed mover, and once falling it
 *    clears every obstacle in its way, walls included. Everything else is
 *    returned untouched, so an overlap that was already in the layout
 *    between two items the change never reaches survives the pass — the
 *    resolver separates what the verb collided, not what it found.
 *
 * Every box the pass places therefore clears every box placed before it,
 * and the only overlaps that can survive are between boxes it left exactly
 * where it found them: untouched movers that already overlapped each other
 * or a cold wall, and any pair of walls — including a changed wall grown
 * onto a static, which the verb caused but no downward move can fix, since
 * neither side is allowed to move at all.
 */
export function resolveOverlapsDown(
  layout: LayoutItem[],
  changedKeys: Iterable<string>,
  // Extra immovable keys for this write. The board passes the open crop
  // item: a verb run on another pin mid-session must not reflow the crop
  // window (see the crop-mode note in GalleryPinBoard's onLayoutChange).
  heldKeys?: Iterable<string>
): LayoutItem[] {
  const changed = new Set(changedKeys)
  const held = heldKeys ? new Set(heldKeys) : null
  const isWall = (l: LayoutItem) => l.static === true || !!held?.has(l.i)
  const obstacles: Obstacle[] = []
  const changedItems: LayoutItem[] = []
  const movers: LayoutItem[] = []
  for (const l of layout) {
    // Held/static wins over changed for POSITION — the invariant is that
    // the crop window does not move, and a verb that resized it wrote w/h,
    // not x/y — but not for hotness: a wall the verb changed keeps its y
    // and still pushes what its new footprint reaches.
    if (isWall(l))
      obstacles.push({ x: l.x, y: l.y, w: l.w, h: l.h, hot: changed.has(l.i) })
    else if (changed.has(l.i)) changedItems.push(l)
    else movers.push(l)
  }
  // Stable sort on the original geometry: top to bottom, then left to
  // right, then by key so equal boxes still have one fixed order.
  const byRow = (a: LayoutItem, b: LayoutItem) =>
    a.y - b.y || a.x - b.x || (a.i < b.i ? -1 : a.i > b.i ? 1 : 0)
  changedItems.sort(byRow)
  movers.sort(byRow)
  // Drop a box until it clears every obstacle it must clear, then record it
  // as an obstacle itself. `coldStart` false means every obstacle can
  // displace it from the start (the changed boxes); true means only a hot
  // one can set it in motion, after which everything blocks it (the
  // movers). Each iteration lands the box on the bottom of the deepest
  // obstacle it currently overlaps, so y strictly increases and no
  // obstacle's bottom can be used twice; the guard is a bound, not an
  // expected exit.
  const settle = (l: LayoutItem, coldStart: boolean): number => {
    let y = l.y
    for (let guard = 0; guard <= obstacles.length + 1; guard++) {
      let bottom = -1
      for (const o of obstacles) {
        if (coldStart && y === l.y && !o.hot) continue
        if (overlaps({ x: l.x, y, w: l.w, h: l.h }, o)) {
          bottom = Math.max(bottom, o.y + o.h)
        }
      }
      if (bottom < 0) break
      y = bottom
    }
    return y
  }
  const moved = new Map<string, number>()
  for (const l of changedItems) {
    const y = settle(l, false)
    if (y !== l.y) moved.set(l.i, y)
    obstacles.push({ x: l.x, y, w: l.w, h: l.h, hot: true })
  }
  for (const l of movers) {
    const y = settle(l, true)
    if (y !== l.y) moved.set(l.i, y)
    obstacles.push({ x: l.x, y, w: l.w, h: l.h, hot: y !== l.y })
  }
  if (moved.size === 0) return layout
  return layout.map((l) => {
    const y = moved.get(l.i)
    return y === undefined ? l : { ...l, y }
  })
}
