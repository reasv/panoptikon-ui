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
//   - LEFT: the sidebar is an OVERLAY by design, and the bounds do NOT
//     reserve it. What it gets instead is a MINIMUM CLEARANCE that engages
//     only in the overlap case — see the left-edge note below, which is the
//     record of two earlier attempts that were both worse.
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
// WHY THE LEFT EDGE IS ALLOWED TO DO WHAT THE BOTTOM EDGE MAY NOT, since the
// shapes look identical and the difference is a judgement, not a mechanism.
// `--pinboard-left-inset` IS shown-scoped, and the clearance below really
// does narrow the box (it is an operand of the width, not only the
// transform), so opening the sidebar from the viewer's own Data View button
// re-lays-out a playing <video> — the same class of event the bottom TRAP
// above exists to forbid. It is kept anyway, and the distinction that
// decides it is DELIBERATE versus INCIDENTAL. The bottom-edge failure was a
// HOVER: the band revealed itself under a resting pointer, so the picture
// resized with no user intent behind it at all, repeatedly, and the user
// could not even name what they had done. Every path that changes
// --pinboard-left-inset now is an act: pressing Data View, the dock's
// settings toggle, Esc, a click outside. A deliberate act that moves the
// picture to make room for the thing it just asked for is a layout change
// the user authored.
//
// The alternative — transform-only, never touching the width — was
// considered and rejected: it cannot keep the clearance the requirement
// actually states ("there must be a clearance between them at all times")
// for items wide enough that no shift alone clears the panel, which is
// exactly the case the narrowing exists for. ESCAPE HATCH if the snap proves
// objectionable in QA: drop CLEARED_WIDTH from the width's min() and keep
// only clearanceShift, accepting partial overlap on wide items. That is a
// two-line change (the width operand and the shift's `w`), and it trades a
// guarantee for a smoother frame — do not make it silently.
//
// LEFT EDGE — MINIMUM CLEARANCE, NOT A RESERVATION. The rule the sidebar
// gets is: the box is viewport-centred and does not move for the sidebar,
// UNLESS it would otherwise overlap it, in which case it is narrowed and
// pushed just far enough to clear it by GAP — down to a FLOOR, past which
// the overlap is accepted rather than shrinking the picture to nothing (see
// CLEARED_WIDTH). Nothing moves in the ordinary case, which is the whole
// requirement — a sidebar opening beside a picture that already fits beside
// it must not shift the picture.
//
// TRAP (left, first attempt): adding the sidebar's width to the bounds. The
// mounted-for-the-session lifetime that makes such a var safe as a bottom
// edge is exactly what makes it wrong as a left one: the reservation never
// goes away, so the surface sat a full sidebar-width right of centre at all
// times, for a panel that is usually hidden.
//
// TRAP (left, second attempt): a SHOWN-scoped left inset on the BOUNDS. The
// fitted box is `min(100%, heightTerm * ratio, capPx)` and `100%` is the
// bounds' width, so for any item wide enough for the 100% term to bind
// (ratio above ~2.1 at 2560×1440) a moving left edge changes the box's
// WIDTH, and the aspect ratio turns that into a HEIGHT change. "It only
// slides sideways" is false — which is precisely why the clearance below
// puts the sidebar term in the width's own min() and moves the box with a
// transform, instead of touching the bounds at all. The bounds are still
// the two symmetric 12vw edges they always were.
const BOUNDS_LEFT = "12vw"
const BOUNDS_RIGHT = "12vw"
// The bounds' width as a LITERAL — the same quantity `width: 100%` resolves
// to inside them (100vw - 12vw - 12vw), needed as a literal because the
// clearance transform below has to restate the painted width outside the
// width property, where `100%` would resolve against the frame's own box.
//
// The two are exactly equal, with no scrollbar caveat: the app's body is
// `overflow-hidden` (app/layout.tsx), so the initial containing block a
// fixed element resolves percentages against is the full viewport, which is
// what `vw` measures. If that ever changes, `100%` becomes the smaller of
// the two and this literal starts overflowing the bounds by the scrollbar's
// width.
const BOUNDS_WIDTH = "76vw"
// The sidebar overlay's published width — SHOWN-scoped, so it is absent
// (0px) whenever no sidebar is covering the left edge, and the clearance
// terms below go inert on their own with no second gate to keep in sync.
const SIDEBAR = "var(--pinboard-left-inset, 0px)"
// The gap kept between the sidebar's right edge and the picture. Small on
// purpose: this is a "do not touch" clearance, not a layout margin.
const SIDEBAR_GAP = "16px"
// The smallest the fitted box may be on its LONGER side. A thumbnail-sized
// item scaled to its natural cap would be a postage stamp in the middle of
// the board, so the cap is raised uniformly until the long side reaches this
// — uniformly, because the promise is "see it properly", not "see it
// stretched" (§8.2). Declared here rather than beside its other use below
// because the clearance floor is the same promise: never annihilate the
// subject.
const MIN_PREVIEW_PX = 320
// The widest the painted content may be and still fit between the sidebar
// (plus its gap) and the bounds' right edge. Inert when the sidebar is
// hidden: 100vw - 0px - 16px - 12vw = 88vw - 16px, which is far wider than
// the 76vw the bounds already impose, so this operand can only ever bind
// while a sidebar is actually on screen.
//
// FLOORED, and the floor is not defensive tidiness — without it this operand
// ERASES THE PICTURE. The sidebar's own width has a floor of its own
// (`w-[min(26rem,90vw)]` below `lg`), so on a narrow window S can approach
// the whole viewport and `100vw - S - 16px - 12vw` goes to zero and then
// negative. Reproduced at an inner width of 980 with a 950px sidebar: the
// width resolved to 0 (2px rendered — the frame's own borders), and the
// clearance transform still evaluated, parking that sliver outside the
// bounds' right edge. At the flat 416px rung it starts binding below a 491px
// viewport; at the 90vw rung it is negative at EVERY width. Overlapping a
// sidebar on a window too narrow to hold both is the better trade, so the
// operand bottoms out at the same minimum the natural cap uses.
const CLEARED_WIDTH =
    `max(${MIN_PREVIEW_PX}px,`
    + ` 100vw - ${SIDEBAR} - ${SIDEBAR_GAP} - ${BOUNDS_RIGHT})`

/**
 * How far right the content must move to clear the sidebar, given the
 * painted width `w` (the SAME expression the width property gets — that is
 * why the width has to be nameable outside itself).
 *
 * The content is centred in the viewport, so its natural left edge is
 * `50vw - w/2`; the deficit against `SIDEBAR + GAP` is the shift, clamped at
 * zero so non-overlapping content gets `translateX(0px)` and does not move
 * at all. With the sidebar hidden the clamp is what makes this inert:
 * `16px - 50vw + w/2 <= 16px - 50vw + 38vw = 16px - 12vw`, negative on any
 * viewport wider than ~133px.
 *
 * The shift is ALSO CAPPED, at `38vw - w/2` — the distance from the centred
 * box's natural right edge (`50vw + w/2`) to the bounds' right edge (88vw).
 * The cap is INERT in every case the uncapped version handled: whenever the
 * clearance operand is unfloored, `w <= 100vw - SIDEBAR - GAP - 12vw`, which
 * rearranges to exactly `SIDEBAR + GAP - 50vw + w/2 <= 38vw - w/2`, so the
 * desired shift is already under the cap and `min()` changes nothing.
 *
 * It exists for the ONE case the floor introduces. With `w` floored at
 * 320px, "shift far enough to clear the sidebar entirely" is a demand the
 * viewport cannot meet, and the uncapped transform met it anyway: measured
 * at an inner width of 980 with a 950px sidebar, the floored 320px box was
 * translated 636px and its right edge landed at 1286 — a picture pushed
 * clean off the screen, which is no better than the 2px sliver the floor was
 * added to prevent. Capped, the same case lands the box hard against the
 * bounds' right edge (measured right edge 862.4 = the bound), overlapping
 * the sidebar. THAT is the accepted trade: on a window too narrow to hold a
 * sidebar and a legible picture side by side, they overlap.
 *
 * So the original claim is restored unconditionally: the content's right
 * edge is never past the bounds' right edge, by the cap when the shift is
 * positive and by the 76vw width cap (`50vw + w/2 <= 88vw`) when it is zero.
 * The cap can never be negative — `w <= 76vw` — so `max(0px, min(…))` is
 * always a real clamp and never inverts.
 *
 * The hidden-sidebar inertness above is unaffected by either change: `w` is
 * still `min(76vw, …)`, so `w/2 <= 38vw` however large the floored operand
 * gets.
 *
 * A TRANSFORM, not a left/margin offset, and it is worth knowing what that
 * buys and costs. Buys: the frame keeps its flex-centred layout position, so
 * the shift is paint-only and the peek layer and the overlaid header —
 * absolutely positioned INSIDE the frame — travel with it for free.
 * Costs: a transformed element becomes the containing block for any
 * `position: fixed` DESCENDANT, and a stacking context. Neither bites here —
 * the frame's subtree (GalleryImageLarge, its video player surface,
 * PeekLayer, ViewerHeader) contains no fixed-position element, Radix layers
 * portal to <body> and are not descendants at all, and the video's
 * fullscreen path uses the native Fullscreen API, whose element is promoted
 * to the top layer and painted outside the ancestor transform chain. Any
 * future fixed-position descendant of the frame WOULD be captured by this:
 * the escape hatch is `position: relative` + `left`, which shifts identically
 * without creating a containing block.
 */
function clearanceShift(w: string): string {
    const wanted = `${SIDEBAR} + ${SIDEBAR_GAP} - 50vw + ${w} / 2`
    const cap = `38vw - ${w} / 2`
    return `translateX(max(0px, min(${wanted}, ${cap})))`
}

// The height as a bare EXPRESSION, so the fit's min() below can take it as an
// operand: min() is its own math context and accepts a parenthesized term
// directly, while `calc(…) * ratio` would nest one math function inside
// another for nothing.
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

/**
 * §8.2's unprobed fallback: the subject carries no dimensions (rows from
 * older scans), so there is no aspect to fit and the box spans the bounds
 * with object-contain letterboxing whatever arrives.
 *
 * It still takes the sidebar clearance, and needs an explicit width to do
 * it — a bounds-spanning box is the WIDEST case there is, so it is the one
 * most certain to overlap an open sidebar. `100%` would have said the same
 * thing about the width, but the shift has to restate it.
 */
export const UNFITTED_BOX_STYLE: CSSProperties = {
    width: `min(${BOUNDS_WIDTH}, ${CLEARED_WIDTH})`,
    height: "100%",
    transform: clearanceShift(`min(${BOUNDS_WIDTH}, ${CLEARED_WIDTH})`),
}

/**
 * The largest box at the given aspect that fits the bounds, capped at the
 * item's natural size (§8.2: a 400px-wide image must not be blown up to the
 * full bounds on a surface whose whole promise is showing it properly),
 * floored as above, and clamped to clear an open sidebar. `width` and
 * `aspectRatio` go on the SAME element — the frame — so the box is exactly
 * the picture and the chrome over it has nothing else to line up with.
 *
 * Expressed in CSS rather than resolved in JS because the bounds' height
 * rides a custom property the dock publishes from a ResizeObserver, and the
 * clearance rides one the sidebar publishes the same way: render-time JS
 * does not know either, and measuring them would size the box a frame late.
 * min() over the constraints with the aspect carried by aspect-ratio gets
 * the exact fit, the natural cap and both live insets without measuring
 * anything.
 *
 * The natural cap is taken on the LONGER side, the one quantity here that
 * survives a rotation: max(coded w, coded h) is the same number whether or not
 * the browser turned the picture, so `ratio` alone decides which way to
 * project it onto the box's WIDTH. That is what lets a corrected aspect keep
 * the right cap without anyone having to know which way the picture turned.
 *
 * Null when the item carries no dimensions (rows from older scans): the caller
 * then paints UNFITTED_BOX_STYLE above, exactly as §8.2 rules.
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
    // The FOURTH operand is the sidebar clearance and it is last for a
    // reason: it is the only one that is usually inert (see CLEARED_WIDTH),
    // so reading the list, the first three are the fit and the fourth is the
    // exception. Narrowing the box is half the rule — a narrowed box is
    // still centred, and still overlaps — so the same expression drives the
    // shift that moves it clear.
    const w =
        `min(${BOUNDS_WIDTH}, (${BOUNDS_HEIGHT}) * ${ratio}, ${capPx}px, ${CLEARED_WIDTH})`
    return {
        width: w,
        aspectRatio: ratio,
        transform: clearanceShift(w),
    }
}
