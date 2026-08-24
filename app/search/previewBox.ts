import type { CSSProperties } from "react"

// The geometry of the maximized board's preview surface
// (docs/maximized-pinboard-search-overlay-design.md §8.2). ONE surface with
// two subjects — the ephemeral hover peek and the pinned viewer's fixed item
// (§8) — so there is one region and one fit expression here, and both
// subjects are measured by them. That is not a tidiness rule: the peek is a
// LAYER INSIDE the viewer's box (§8.4), and a peek fitted by different rules
// would land beside the frame it is supposed to fill.
//
// The bounds below are the region the surface MAY occupy, NOT the visible
// box: the frame belongs to the fitted box inside them.
//
// Only ONE moving edge is reserved — the bottom dock's band — and the two
// edges are treated differently for reasons that are not symmetric:
//
//   - BOTTOM: the dock is what you are using WHILE the viewer is up (hovering
//     strip cards peeks over it), so a viewer underneath the dock would be
//     unusable. Reserved.
//   - LEFT: the sidebar is a filter panel, not something in play while you
//     are looking at a picture — and it is an OVERLAY by design, which the
//     board and this surface both simply let cover them. Reserving it would
//     push the box permanently off center by the sidebar's whole width for a
//     panel that is usually hidden. Not reserved; when it is open it covers
//     the box's left edge like it covers everything else.
//
// TRAP (bottom): reserve --pinboard-dock-height, NEVER
// --pinboard-bottom-inset. The inset is published only while the dock is
// SHOWN, so reserving it made the box ~400px taller the instant an unpinned
// dock hid, and snap back when the band was hovered — a live <video> being
// re-laid-out mid-playback. The dock var is the same measurement published
// for as long as the dock is MOUNTED, i.e. the whole maximized session, so
// the box's height budget is constant. (A peek can only exist while the dock
// is shown, so the two vars are equal whenever one is being peeked at
// anyway; the mount-scoped one is what protects the fixed item.)
//
// TRAP (left): do not "fix" the sidebar overlapping the box by adding its
// width back here. That was tried, and the mounted-for-the-session lifetime
// that makes such a var safe against resizes is exactly what makes it wrong
// as a left edge: the reservation never goes away, so the surface sat a full
// sidebar-width right of centre at all times. A SHOWN-scoped left inset is
// not the answer either — the fitted box is `min(100%, heightTerm * ratio,
// capPx)` and `100%` is the bounds' width, so for any item wide enough for
// the 100% term to bind (ratio above ~2.1 at 2560×1440) a moving left edge
// changes the box's WIDTH, and the aspect ratio turns that into a height
// change. "It only slides sideways" is false.
const BOUNDS_LEFT = "12vw"
const BOUNDS_RIGHT = "12vw"
// The height as a bare EXPRESSION, so the fit's min() below can take it as an
// operand: min() is its own math context and accepts a parenthesized term
// directly, while `calc(…) * ratio` would nest one math function inside
// another for nothing. There is no width counterpart: with the height riding
// a custom property the bounds are no longer a literal, and a fitted box that
// is a CHILD of the bounds gets its width limit from `100%`.
//
// NOTHING is subtracted from this for chrome. The viewer's header is
// absolutely positioned OVER the picture (§8.3), which is precisely what
// makes fixing a peek a no-op for the box: a header in flow takes its height
// out of this budget, so the picture re-fitted smaller the instant it
// appeared — the shrink the user rejected. If a control ever needs a row of
// its own here, that shrink comes back with it.
const BOUNDS_HEIGHT = "92vh - var(--pinboard-dock-height, 0px)"

/** The region the surface occupies, whichever subject it is displaying. */
export const PREVIEW_BOUNDS: CSSProperties = {
    top: "4vh",
    left: BOUNDS_LEFT,
    right: BOUNDS_RIGHT,
    height: `calc(${BOUNDS_HEIGHT})`,
}

// The smallest the fitted box may be on its LONGER side. A thumbnail-sized
// item scaled to its natural cap would be a postage stamp in the middle of
// the board, so the cap is raised uniformly until the long side reaches this
// — uniformly, because the promise is "see it properly", not "see it
// stretched" (§8.2).
const MIN_PREVIEW_PX = 320

/**
 * The largest box at the given aspect that fits the bounds, capped at the
 * item's natural size (§8.2: a 400px-wide image must not be blown up to the
 * full bounds on a surface whose whole promise is showing it properly) and
 * floored as above. `width` and `aspectRatio` go on the SAME element — the
 * frame — so the box is exactly the picture and the chrome over it has
 * nothing else to line up with.
 *
 * Expressed in CSS rather than resolved in JS because the bounds' height
 * rides a custom property the dock publishes from a ResizeObserver:
 * render-time JS does not know it, and measuring it would size the box a
 * frame late. min() over the three constraints with the aspect carried by
 * aspect-ratio gets the exact fit, the natural cap and the live inset without
 * measuring anything.
 *
 * The natural cap is taken on the LONGER side, the one quantity here that
 * survives a rotation: max(coded w, coded h) is the same number whether or not
 * the browser turned the picture, so `ratio` alone decides which way to
 * project it onto the box's WIDTH. That is what lets a corrected aspect keep
 * the right cap without anyone having to know which way the picture turned.
 *
 * Null when the item carries no dimensions (rows from older scans): the caller
 * then keeps the full-bounds box and lets object-contain letterbox, unprobed,
 * exactly as §8.2 rules.
 */
export function fittedBoxStyle(
    ratio: number | null,
    width: number | null | undefined,
    height: number | null | undefined,
): CSSProperties | null {
    if (!ratio || !width || !height) return null
    const longSide = Math.max(MIN_PREVIEW_PX, Math.max(width, height))
    // Clamped to 1px: this operand is a WIDTH, and an aspect extreme enough
    // (a 1×1000 item) projects the long side down to nothing — min() would
    // take that and there would be no preview at all. A degenerate aspect
    // still yields a sliver, but never a box the cap alone erased.
    const capPx = Math.max(
        1,
        Math.round(ratio >= 1 ? longSide : longSide * ratio)
    )
    return {
        width: `min(100%, (${BOUNDS_HEIGHT}) * ${ratio}, ${capPx}px)`,
        aspectRatio: ratio,
    }
}
