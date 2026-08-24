import type { CSSProperties } from "react"

// The geometry both preview surfaces of the maximized board share
// (docs/maximized-pinboard-search-overlay-design.md §8.2): the ephemeral
// hover peek (ResultHoverPreview) and the pinned viewer (SearchViewer). One
// module because the two are LAYERED — the peek renders over the open viewer
// (§8.4) — and a peek that fitted its item by different rules would land
// beside the viewer's frame instead of on it.
//
// The bounds below are the region a preview MAY occupy, NOT the visible box:
// the frame belongs to the fitted box inside them. ONE set of bounds, shared:
// the two surfaces are layered, and the peek is supposed to land ON the
// viewer's frame, which it cannot do if the two are centered differently.
//
// Only ONE moving edge is reserved — the bottom dock's band — and the two
// surfaces are treated differently on the two axes for reasons that are not
// symmetric:
//
//   - BOTTOM: the dock is what you are using WHILE the viewer is up (hovering
//     strip buttons peeks over it), so a viewer underneath the dock would be
//     unusable. Reserved.
//   - LEFT: the sidebar is a filter panel, not something in play while you
//     are looking at a picture — and it is an OVERLAY by design, which the
//     board and the peek both simply let cover them. Reserving it would push
//     the viewer permanently off center by the sidebar's whole width for a
//     panel that is usually hidden. Not reserved; when it is open it covers
//     the viewer's left edge like it covers everything else.
//
// TRAP (bottom): reserve --pinboard-dock-height, NEVER
// --pinboard-bottom-inset. The inset is published only while the dock is
// SHOWN, so reserving it made the box ~400px taller the instant an unpinned
// dock hid, and snap back when the band was hovered — a live <video> being
// re-laid-out mid-playback. The dock var is the same measurement published
// for as long as the dock is MOUNTED, i.e. the whole maximized session, so
// the viewer's height is constant. The peek shares that expression for a
// different reason: the two dock vars are EQUAL whenever a peek can exist (a
// card's preview button can only be hovered while the dock is shown).
//
// TRAP (left): do not "fix" the sidebar overlapping the viewer by adding its
// width back here. That was tried, and the mounted-for-the-session lifetime
// that makes such a var safe against resizes is exactly what makes it wrong
// as a left edge: the reservation never goes away, so the viewer sat a full
// sidebar-width right of the peek at all times. A SHOWN-scoped left inset is
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
// another for nothing. There is no width counterpart: with the left edge
// riding a custom property the bounds' width is no longer a literal, and a
// fitted box that is a CHILD of the bounds gets it from `100%`.
const BOUNDS_HEIGHT = "92vh - var(--pinboard-dock-height, 0px)"

/**
 * The region both surfaces occupy. ONE object, exported under both names so
 * the layering in §8.4 holds by construction: the peek renders over the open
 * viewer, and two sets of bounds meant the peek landing beside the viewer's
 * frame rather than on it.
 */
export const PREVIEW_BOUNDS: CSSProperties = {
    top: "4vh",
    left: BOUNDS_LEFT,
    right: BOUNDS_RIGHT,
    height: `calc(${BOUNDS_HEIGHT})`,
}

export const PEEK_BOUNDS = PREVIEW_BOUNDS
export const VIEWER_BOUNDS = PREVIEW_BOUNDS

/**
 * The bounds' height as a min() operand for fittedBoxStyle, optionally less a
 * fixed reserve the fitted PICTURE does not get. The peek passes nothing —
 * its box is the whole surface. The viewer passes its header row's height:
 * the header stacks above the picture inside the same bounds, so a picture
 * fitted against the full height would push the frame past them.
 */
export function boundsHeightTerm(reserve?: string) {
    return reserve ? `(${BOUNDS_HEIGHT} - ${reserve})` : `(${BOUNDS_HEIGHT})`
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
 * floored as above. `width` is meant for the box itself, `aspectRatio` for
 * whichever element the picture actually fills — the peek puts both on one
 * div, the viewer splits them across its frame and its picture row.
 *
 * Expressed in CSS rather than resolved in JS because the bounds' height
 * rides a custom property the dock publishes from a ResizeObserver:
 * render-time JS does not know it, and measuring it would size the box a
 * frame late.
 * min() over the three constraints with the aspect carried by aspect-ratio
 * gets the exact fit, the natural cap and the live insets without measuring
 * anything.
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
    heightTerm: string = boundsHeightTerm()
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
        width: `min(100%, ${heightTerm} * ${ratio}, ${capPx}px)`,
        aspectRatio: ratio,
    }
}
