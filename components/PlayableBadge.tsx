import { cn } from "@/lib/utils"

/**
 * Does this item MOVE when you open it?
 *
 * Two ways to be true, and the second is the reason this is a predicate
 * rather than a mime test at the call site:
 *
 *   - a `video/*` mime, whatever the browser can actually decode. NOT
 *     `isPlayableVideo` (components/gallery/ImageGallery.tsx), which asks
 *     whether THIS browser can play the file — an HEVC-in-mp4 it cannot
 *     decode is still a video, and a badge that vanished on exactly the
 *     files the user is most likely to be confused by would be worse than
 *     no badge;
 *   - a measured span, which is how an animated GIF/WebP/AVIF is recorded
 *     (`duration > 0` — the same three-state column ItemMetaLine reads, where
 *     null is unprobed and 0 is a still). Those play in this app too, and a
 *     still frame of an animation raises exactly the question this badge
 *     exists to answer.
 *
 * If the badge should be videos ONLY, this expression is the single place to
 * say so.
 */
export function isPlayableItem(item: SearchResult): boolean {
    if (item.type?.startsWith("video/")) return true
    return !!item.duration && item.duration > 0
}

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
export function PlayableBadge({ className }: { className?: string }) {
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
                "transition-opacity duration-200 group-hover:opacity-0",
                className,
            )}
        >
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
            </svg>
        </div>
    )
}
