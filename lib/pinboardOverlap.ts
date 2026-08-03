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
// The changed items themselves never move — the verb's whole point is the
// footprint it just wrote — and statics (anchored pins) are immovable walls:
// they were not overlapped before the verb (an anchor is an obstacle every
// layout packs around), so they only ever appear in the cascade's path, and
// there they are pushed PAST, not through.

import type { LayoutItem } from "react-grid-layout"

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  )
}

/**
 * Push every item colliding with a changed item down until nothing overlaps.
 * Returns the input array itself when nothing had to move, so a verb that
 * created no collision commits exactly what it computed.
 *
 * Order matters and is fixed up front: the immovables (changed items and
 * statics) are obstacles from the start — a static further down the board
 * must block a cascade that reaches it, whatever the processing order — and
 * the movable items are then placed topmost-first, in their ORIGINAL
 * vertical order. That order is what makes one pass enough: when an item is
 * placed, everything that could push it down (anything originally above it,
 * plus every immovable) already has its final position.
 */
export function resolveOverlapsDown(
  layout: LayoutItem[],
  changedKeys: Iterable<string>
): LayoutItem[] {
  const changed = new Set(changedKeys)
  const immovable = (l: LayoutItem) => changed.has(l.i) || l.static === true
  const obstacles: Rect[] = []
  const movers: LayoutItem[] = []
  for (const l of layout) {
    if (immovable(l)) obstacles.push({ x: l.x, y: l.y, w: l.w, h: l.h })
    else movers.push(l)
  }
  // Stable sort on the original geometry: top to bottom, then left to right
  movers.sort((a, b) => a.y - b.y || a.x - b.x)
  const moved = new Map<string, number>()
  for (const l of movers) {
    let y = l.y
    // Each iteration clears the deepest obstacle currently overlapped, so
    // at most one pass per obstacle can be needed; the bound is a guard, not
    // an expected exit.
    for (let guard = 0; guard <= obstacles.length; guard++) {
      let bottom = -1
      for (const o of obstacles) {
        if (overlaps({ x: l.x, y, w: l.w, h: l.h }, o)) {
          bottom = Math.max(bottom, o.y + o.h)
        }
      }
      if (bottom < 0) break
      y = bottom
    }
    if (y !== l.y) moved.set(l.i, y)
    obstacles.push({ x: l.x, y, w: l.w, h: l.h })
  }
  if (moved.size === 0) return layout
  return layout.map((l) => {
    const y = moved.get(l.i)
    return y === undefined ? l : { ...l, y }
  })
}
