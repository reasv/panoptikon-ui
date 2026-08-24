import type { CSSProperties } from "react"

// The geometry both preview surfaces of the maximized board share
// (docs/maximized-pinboard-search-overlay-design.md §8.2): the ephemeral
// hover peek (ResultHoverPreview) and the pinned viewer (SearchViewer). One
// module because the two are LAYERED — the peek renders over the open viewer
// (§8.4) — and a peek that fitted its item by different rules would land
// beside the viewer's frame instead of on it.
//
// The bounds below are the region a preview MAY occupy, NOT the visible box:
// the frame belongs to the fitted box inside them. Both edges that can move
// under a surface — the bottom dock's band and the sidebar overlay's width —
// come from custom properties, and each of those is published TWICE with
// different lifetimes. The peek reads the SHOWN-scoped pair, the viewer the
// MOUNT-scoped pair, and that split is the whole point of this module:
//
//   - the peek is a plain <img> that exists only while the bottom dock is
//     shown, so re-laying it out costs nothing and the live insets give it
//     every pixel that is genuinely free;
//   - the viewer can hold a PLAYING <video>, and re-laying out its frame
//     re-lays out the element, the player surface and the click zones
//     mid-playback. It must not move because a panel revealed or hid.
//
// TRAP (bottom, fixed once): reserving --pinboard-bottom-inset here made the
// box ~400px taller the instant an unpinned dock hid, and snap back when the
// band was hovered. --pinboard-dock-height is the same measurement published
// for as long as the dock is MOUNTED — the whole maximized session — so the
// viewer subtracts that instead.
//
// TRAP (left, the same bug wearing the other axis): "it only slides the box
// sideways" is FALSE, and that is why --pinboard-left-inset is not in the
// viewer's bounds either. The fitted box is `min(100%, heightTerm * ratio,
// capPx)` and `100%` is the bounds' width — 76vw MINUS the left inset — so
// for any item wide enough for the 100% term to bind (ratio above ~2.1 at
// 2560×1440) changing the left edge changes the box's WIDTH, and the aspect
// ratio turns that into a height change. Hover-revealing an unpinned sidebar
// would resize a frame around a playing video. --pinboard-sidebar-width is
// the sidebar's width for as long as IT is mounted, which is the same whole
// session, so the viewer's bounds are constant.
//
// The cost of both is a dock-tall / sidebar-wide empty band beside a viewer
// whose panel is hidden, which is exactly the stability being bought.
const PEEK_BOUNDS_LEFT = "calc(12vw + var(--pinboard-left-inset, 0px))"
const VIEWER_BOUNDS_LEFT = "calc(12vw + var(--pinboard-sidebar-width, 0px))"
const BOUNDS_RIGHT = "12vw"
// The height as a bare EXPRESSION, so the fit's min() below can take it as an
// operand: min() is its own math context and accepts a parenthesized term
// directly, while `calc(…) * ratio` would nest one math function inside
// another for nothing. There is no width counterpart: with the left edge
// riding a custom property the bounds' width is no longer a literal, and a
// fitted box that is a CHILD of the bounds gets it from `100%`.
const BOUNDS_HEIGHT = "92vh - var(--pinboard-dock-height, 0px)"

/**
 * The ephemeral peek's bounds: live insets, per the split above. The height
 * still reads the stable dock var, and reads it for a reason that is not
 * stability — the two dock vars are EQUAL whenever the peek is on screen (a
 * card's preview button can only be hovered while the dock is shown), so
 * sharing one expression is free here and keeps the two surfaces' fits
 * identical, which §8.4's layering requires.
 */
export const PEEK_BOUNDS: CSSProperties = {
    top: "4vh",
    left: PEEK_BOUNDS_LEFT,
    right: BOUNDS_RIGHT,
    height: `calc(${BOUNDS_HEIGHT})`,
}

/** The pinned viewer's bounds: mount-scoped on both axes. See above. */
export const VIEWER_BOUNDS: CSSProperties = {
    top: "4vh",
    left: VIEWER_BOUNDS_LEFT,
    right: BOUNDS_RIGHT,
    height: `calc(${BOUNDS_HEIGHT})`,
}

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
 * Expressed in CSS rather than resolved in JS because two of the bounds are
 * custom properties the overlays publish from ResizeObservers: render-time JS
 * does not know them, and measuring them would size the box a frame late.
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
