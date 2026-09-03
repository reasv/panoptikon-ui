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
 *   - `pointer-events-none`, always. The thumbnail's click-to-open and its
 *     drag both belong to the anchor underneath, and a centered overlay is
 *     exactly where a click or a drag starts.
 *   - fades out on hover. The corners fill with verb buttons and the grid
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

export function PlayableBadge({ className, progress, caption }: {
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
                !pending && "group-hover:opacity-0",
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
                viewBox="0 0 48 48"
                className="w-[clamp(28px,22cqmin,96px)] h-[clamp(28px,22cqmin,96px)] drop-shadow-[0_1px_3px_rgba(0,0,0,0.45)]"
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

                    `rotate(-90 24 24)` starts it at twelve o'clock, which is
                    where a person expects a clock-face fill to begin; the
                    dash pattern is "paint this much, then leave the rest",
                    which is a fill for a determinate fraction and a sweep for
                    the indeterminate one once it is spun.

                    The spin is a `transform` on the ELEMENT, so it composes
                    with the static rotate above by being applied around the
                    same user-space centre — `transform-box` for SVG defaults
                    to `view-box`, so 24px 24px is the viewBox's middle and
                    needs no fill-box override. */}
                {pending && (
                    <circle
                        cx="24"
                        cy="24"
                        r="22"
                        fill="none"
                        stroke="rgba(255,255,255,0.95)"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray={`${RING_CIRCUMFERENCE * fraction} ${RING_CIRCUMFERENCE}`}
                        transform="rotate(-90 24 24)"
                        className={progress === "queued" ? "animate-spin" : undefined}
                        style={{
                            transformOrigin: "24px 24px",
                            transition: progress === "queued"
                                ? undefined
                                : "stroke-dasharray 200ms linear",
                        }}
                    />
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
