import { cn } from "@/lib/utils"

/**
 * WHO GETS THIS BADGE is `showsMotionBadge` in lib/thumbnailTier.ts, and that
 * expression is the single place to change it.
 *
 * It used to be a local `isPlayableItem(item)` — "a `video/*` mime, or a
 * measured span" — and the question it answered ("does this item move when you
 * open it?") stopped being the right one when grid cells learned to move by
 * themselves. The badge's meaning is now the narrower "this item moves, but it
 * is NOT moving right now" (D8), which no test on the item alone can answer:
 * the same animated GIF earns a badge in a hover-mode cell, earns none in an
 * always-mode one, and earns none below the raw floor where it is animating in
 * its own `<img>`. So the predicate takes the cell's animate mode and the
 * server's floor as well as the row, and it lives beside the other
 * which-picture-is-this-cell-showing decisions rather than here.
 *
 * One thing it kept deliberately: a `video/*` mime counts whatever the browser
 * can actually decode. NOT `isPlayableVideo`
 * (components/gallery/ImageGallery.tsx), which asks whether THIS browser can
 * play the file — an HEVC-in-mp4 it cannot decode is still a video, and a
 * badge that vanished on exactly the files the user is most likely to be
 * confused by would be worse than no badge.
 */

/**
 * The "this one plays" mark for a THUMBNAIL: a ghosted play glyph in the
 * middle of the picture.
 *
 * Until now the only hint that a search result was a video was that its
 * thumbnail happened to be a 2×2 frame mosaic — an artifact of how the
 * thumbnail is generated, which is not a thing a user should have to learn
 * to read.
 *
 * Rules it has to obey, since it sits ON a picture that is also a link, a
 * drag source and a hover surface:
 *
 *   - `pointer-events-none` on the BOX, always. The thumbnail's click-to-open
 *     and its drag both belong to the anchor underneath, and a centered
 *     overlay is exactly where a click or a drag starts. The one exception is
 *     the disc itself under `interactive` (T3): the trigger setting makes the
 *     badge the thing you rest on or click, so that shape — and nothing else
 *     in this overlay — takes pointer events, and its click stops there.
 *   - fades out on hover, unless it is that trigger (see `interactive`) or a
 *     preview job is pending on it. The corners fill with verb buttons and the grid
 *     card swaps to `object-contain` at that moment — the badge has already
 *     said what it had to say by then, and inspecting a frame is when you
 *     least want something drawn over the middle of it. (Drop the
 *     `group-hover:opacity-0` to keep it up; every host already establishes
 *     the `group`.)
 *   - readable on ANY content. An SVG rather than a lucide icon so the
 *     translucent disc and the glyph are one shape with one shadow: a
 *     white-on-transparent icon disappears into a bright frame, and a solid
 *     chip stops being ghostly. The disc carries the contrast, the ring
 *     carries the edge, and the drop shadow covers the case where both the
 *     frame and the ring are pale.
 *
 * `aria-hidden`: the same fact is already in the metadata line's duration
 * field and in the item's own type, both of which are real text.
 */
/**
 * The badge ring's circumference in the SVG's own user units (`r = 22` in a
 * 48×48 viewBox). Every dash length below is a fraction of it.
 */
const RING_CIRCUMFERENCE = 2 * Math.PI * 22
/** How much of the ring the indeterminate sweep paints. */
const SWEEP_FRACTION = 0.22

export function PlayableBadge({
    className,
    progress,
    caption,
    countdown,
    interactive,
    elementRef,
    onActivate,
}: {
    className?: string
    /**
     * A PREVIEW TRANSCODE IS PENDING FOR THIS CELL (V11): an indeterminate
     * `"queued"` sweep, or a 0..1 fraction the ring fills to. The ring is the
     * badge's OWN circular edge rather than a second chrome element, because
     * the thing that is loading is the picture the badge sits on.
     *
     * Null — which is every caller but the one previewing cell — is the badge
     * that has always been here, down to the hover fade. Non-null SUPPRESSES
     * that fade, and that is the point rather than an oversight: a pending
     * preview implies the pointer is on the card, so `group-hover:opacity-0`
     * would hide the one thing the user needs to see. It comes back the moment
     * the video plays, which is the moment `progress` goes null again.
     *
     * Rung 0 never sets it: there is nothing to wait for that the poster does
     * not already cover, and a ring for a Range request that resolves in a few
     * hundred milliseconds is noise.
     */
    progress?: "queued" | number | null
    /** A word under the badge — "Transcoding…", "Queued #2" (V11). */
    caption?: string | null
    /**
     * THE FRACTION IS BEING DRIVEN PER FRAME — the trigger countdown (T3),
     * which fills the ring from a `requestAnimationFrame` loop rather than
     * from a job's progress samples. It turns the ring's own 200 ms transition
     * OFF: a value that already moves every frame must not ALSO be
     * interpolated, or the ring lags a fifth of a second behind the pointer
     * and the drain (T4) runs backwards through a queue of stale targets.
     */
    countdown?: boolean
    /**
     * THIS BADGE IS THE TRIGGER (T3/T6): the disc takes pointer events, shows
     * a pointer cursor, gains a touch of contrast on card hover, and does NOT
     * fade with the card's `group-hover` — it is the thing the user is aiming
     * at, so hiding it at the moment they reach for it is the one thing it
     * must not do. The contrast is a stylesheet rule and costs no state.
     *
     * Turned OFF again at the start (the card stops passing it), which is what
     * hands the badge back to its ordinary behaviour: the fade returns, the
     * pointer is by definition on the card, and the badge disappears — while a
     * pending job's ring keeps it up on its own, because `progress` non-null
     * suppresses the same fade.
     */
    interactive?: boolean
    /** The arm's anchor: the SVG itself, which is the shape being aimed at. */
    elementRef?: (element: SVGSVGElement | null) => void
    /** The click path (T3): start the preview at once, countdown skipped. */
    onActivate?: () => void
}) {
    const pending = progress != null
    const fraction = typeof progress === "number"
        ? Math.max(0, Math.min(1, progress))
        : SWEEP_FRACTION
    return (
        <div
            aria-hidden
            className={cn(
                "pointer-events-none absolute inset-0 flex items-center justify-center",
                // Its own container, so the glyph below can size itself
                // against THIS box — which is the picture box, since the
                // badge spans it. `container-type: size` (not inline-size)
                // because the unit that matters is cqmin, and cqmin needs a
                // queryable height as well as a width. Safe here in a way it
                // would not be on a content-sized element: this box is
                // absolutely positioned to inset-0, so its size never
                // depended on its contents in the first place.
                "[container-type:size]",
                "transition-opacity duration-200",
                // The fade stands down while a preview is pending — see the
                // `progress` prop. THIS COUPLES TO `showsMotionBadge`
                // (lib/thumbnailTier.ts), whose "a hover-playing loop keeps
                // its badge because the fade has already hidden it" branch
                // assumes the fade is unconditional: the exception below is
                // the previewing VIDEO cell, which that branch does not cover
                // (a video always earns a badge, whatever is playing).
                //
                // `interactive` suppresses it for the same reason from the
                // other end (T6): under the `"button"` trigger the badge is
                // the target, and a target that fades as the pointer
                // approaches it is not one.
                !pending && !interactive && "group-hover:opacity-0",
                className,
            )}
        >
          {/* A column so the caption sits UNDER the disc rather than across
              it. Present whether or not there is a caption, so the glyph does
              not shift when one appears: an empty second child contributes
              nothing to a column whose gap only applies between children. */}
          <div className="flex flex-col items-center justify-center gap-1">
            {/* PROPORTIONAL to the thumbnail, not a fixed 48px: the same
                badge has to sit on a 150px strip card and on a 5xl grid cell
                several times that, and one size cannot read the same on
                both — it was overbearing on the small ones and lost on the
                large.

                cqmin, so it is the SHORT side that scales it: on a tall
                narrow thumbnail a width-derived size would overflow the
                frame, and on a wide short one it would swamp it. The clamp
                is the two ends the ratio alone gets wrong — a thumbnail
                small enough to make 22% illegible, and one large enough to
                make it a target rather than a hint. */}
            <svg
                ref={elementRef}
                viewBox="0 0 48 48"
                className={cn(
                    "w-[clamp(28px,22cqmin,96px)] h-[clamp(28px,22cqmin,96px)] drop-shadow-[0_1px_3px_rgba(0,0,0,0.45)]",
                    // THE TARGET (T3/T6). `pointer-events-auto` against the
                    // wrapper's `none`, so the only part of this overlay that
                    // takes a pointer is the disc itself — the rest of the
                    // picture stays the anchor's, click and drag included.
                    //
                    // The contrast is three stylesheet rules on card hover and
                    // nothing else: the disc darkens, its ring and its glyph go
                    // to full white. `[&>circle]` reaches the disc alone — the
                    // progress ring is a `<circle>` inside a `<g>`, so the
                    // direct-child selector cannot touch it.
                    interactive && [
                        "pointer-events-auto cursor-pointer",
                        "transition-transform duration-150 group-hover:scale-105",
                        "[&>circle]:transition-all [&>path]:transition-all",
                        "group-hover:[&>circle]:fill-[rgba(15,23,42,0.55)]",
                        "group-hover:[&>circle]:stroke-white",
                        "group-hover:[&>path]:fill-white",
                    ],
                )}
                onClick={interactive && onActivate
                    ? (event) => {
                        // The badge sits INSIDE the grid card's anchor, whose
                        // own click opens the gallery. Both halves are needed:
                        // `preventDefault` stops the anchor's navigation and
                        // `stopPropagation` stops React's synthetic click from
                        // reaching its `onClick`. The card's DRAG is
                        // untouched — `dragstart` is a different event, and
                        // the draggable element is an ancestor.
                        event.preventDefault()
                        event.stopPropagation()
                        onActivate()
                    }
                    : undefined}
            >
                {/* The four alphas are one ghost, tuned together — the disc
                    carries the contrast, the ring the edge, the glyph the
                    reading, the shadow the pale-on-pale case. Scale them as
                    a set: dropping one alone (a fainter glyph over the same
                    disc, say) stops looking translucent and starts looking
                    like a rendering fault. */}
                <circle
                    cx="24"
                    cy="24"
                    r="22"
                    fill="rgba(15,23,42,0.34)"
                    stroke="rgba(255,255,255,0.68)"
                    strokeWidth="2"
                />
                {/* Optically centred, not geometrically: a triangle's visual
                    mass sits behind its leading point, so a glyph centred on
                    the disc's real middle reads as leaning left. */}
                <path d="M20 15.5 L34.5 24 L20 32.5 Z" fill="rgba(255,255,255,0.75)" />
                {/* THE PROGRESS RING (V11), drawn ON the disc's own edge — the
                    same r=22 circle, one unit thicker and at full alpha so it
                    reads as the ring lighting up rather than as a second ring
                    beside it.

                    TWO ELEMENTS, TWO TRANSFORMS, and that split is the fix
                    for a ring that shipped drawn off the disc. The
                    twelve-o'clock start is the <g>'s `rotate(-90 24 24)`,
                    an SVG presentation attribute whose own centre is in the
                    attribute. The indeterminate spin is a CSS animation on
                    the <circle> with a CSS `transform-origin` at the same
                    centre. They must never sit on ONE element: Chromium
                    reads `rotate(-90 24 24)` as `translate(24,24)
                    rotate(-90) translate(-24,-24)` and THEN applies the CSS
                    origin on top, which rotates the ring about (48,48) — the
                    viewBox's bottom-right corner — so the arc landed below
                    the disc, mostly clipped, and the spin interpolated
                    between two unrelated transforms and wandered instead of
                    turning in place. (`transform-box` for SVG defaults to
                    `view-box`, so `24px 24px` on the child is the middle.)

                    The dash pattern is "paint this much, then leave the
                    rest": a fill for a determinate fraction, a sweep for the
                    indeterminate one once it is spun. */}
                {pending && (
                    <g transform="rotate(-90 24 24)">
                        <circle
                            cx="24"
                            cy="24"
                            r="22"
                            fill="none"
                            stroke="rgba(255,255,255,0.95)"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeDasharray={`${RING_CIRCUMFERENCE * fraction} ${RING_CIRCUMFERENCE}`}
                            className={progress === "queued" ? "animate-spin" : undefined}
                            style={{
                                transformOrigin: "24px 24px",
                                // NO transition for the two forms that already
                                // move on their own: the indeterminate sweep
                                // spins, and the countdown is redrawn every
                                // frame (see `countdown`). Only a job's
                                // progress — a handful of samples a second —
                                // wants the ring to interpolate between them.
                                transition: progress === "queued" || countdown
                                    ? undefined
                                    : "stroke-dasharray 200ms linear",
                            }}
                        />
                    </g>
                )}
            </svg>
            {caption && (
                /* Under the disc rather than inside it: the glyph is already
                   there, and a word wrapped around a play triangle is
                   unreadable at the sizes this badge lives at. Scaled off the
                   same container query, floored at a size that is still text
                   on a 150px cell. `whitespace-nowrap` because "Queued #12"
                   breaking in two is worse than overflowing a narrow card. */
                <span className="whitespace-nowrap text-white/90 text-[clamp(9px,6cqmin,15px)] leading-none drop-shadow-[0_1px_3px_rgba(0,0,0,0.65)]">
                    {caption}
                </span>
            )}
          </div>
        </div>
    )
}
