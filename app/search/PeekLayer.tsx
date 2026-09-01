"use client"
import { useState } from "react"
import { cn, getFileURL } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"
import { isExtremeAspect } from "@/lib/thumbnailTier"

// The maximized workspace's HOVER PEEK, as a LAYER inside the preview
// surface's box (docs/maximized-pinboard-search-overlay-design.md §8.4) —
// not a surface of its own. It paints the hovered item over whatever the
// viewer is showing WITHOUT unmounting it: a video the viewer is playing
// keeps playing underneath and is revealed still playing when the pointer
// leaves. That is the one property the old two-surface split bought and the
// only part of it that survived the merge.
//
// It stays thumbnail-only for the reason that split existed: mounting a real
// player per hover-sweep would churn video decoders for nothing. What it no
// longer does is buy that with a second framed surface the user can see —
// the frame, the box and the fit belong to the one surface (PreviewSurface),
// which is why this component computes no geometry at all.
//
// OPAQUE and pointer-events-none. Opaque because it must actually hide the
// live content underneath (object-contain letterboxes, and the no-dimensions
// fallback letterboxes a lot); inert because a peek is a glance — every
// control on this screen belongs to the item the user SELECTED, never to the
// one they are passing over.

// Both layers fill the box and are absolutely stacked. No frame of their own
// — border, rounding, background and shadow belong to the surface's frame,
// which clips them (overflow-hidden) whichever subject is displayed.
const LAYER_CLASSES = "absolute inset-0 h-full w-full object-contain"

export function PeekLayer({
    item,
    onAspect,
}: {
    item: SearchResult
    /**
     * What the browser painted for the layer BOTH preview subjects share —
     * the stored thumbnail, and only it (§8.2). Reported up to the box that
     * has to fit it; the ladder's precedence lives there, not here, because
     * the box also weighs this against the item's coded dimensions.
     *
     * TRAP — the dwell upgrade below deliberately does NOT report, and "same
     * file" is exactly why that is not an oversight. The store is keyed per
     * FILE, but the two subjects can paint DIFFERENT IMAGES of one file: the
     * upgrade loads the ORIGINAL (which the browser rotates per EXIF) while
     * GalleryImageLarge paints `thumbnail`, and above the scanner's size
     * thresholds that is a STORED thumbnail re-encoded through `to_rgb8()` +
     * JPEG with no EXIF and no orientation applied
     * (panoptikon/src/jobs/files.rs, generate_thumbnail/encode_image). Let
     * the upgrade report and a 6000x4000 Orientation-6 JPEG dwelt on, then
     * clicked, fixes the box PORTRAIT around a LANDSCAPE stored thumbnail —
     * the picture visibly flips and shrinks on the click, which is the very
     * complaint §8 exists to remove. Restricting the store to this layer
     * makes the box agree with what is painted BY CONSTRUCTION in both
     * subjects, because this URL and GalleryImageLarge's are built from the
     * same expression against the same `dbs`.
     *
     * Accepted consequence: for a large rotated still the box matches the
     * un-rotated thumbnail both surfaces paint and only the upgrade (the
     * rotated original) letterboxes inside it — the pre-P5 behavior for that
     * one case. Small files are served directly by the thumbnail endpoint, so
     * there the reported aspect IS the browser-rotated one and everything is
     * correct. The whole class of problem is the scanner storing coded
     * dimensions and un-rotated thumbnails, which is being fixed separately;
     * once thumbnails carry orientation the two agree everywhere.
     */
    onAspect: (sha: string, ratio: number) => void
}) {
    const [dbs] = useSelectedDBs()
    // A CONTAIN surface (LAYER_CLASSES), and one that MEASURES what it paints
    // — `onAspect` reports naturalWidth/naturalHeight to size the box both
    // preview subjects share. A grid tier is therefore doubly wrong here for
    // an item past aspect 2: it is a crop, so it would show a strip's top
    // screenful, and its aspect is the CROP's, which would size the shared box
    // around a picture the viewer never paints. The default path is what this
    // asks for, with `?size=display` spelled out for the extreme-aspect items
    // whose display rendition the tier work changed (§2, F4) — same bytes, new
    // URL, so a stale cache entry cannot answer it.
    const thumbnailURL = getFileURL(dbs, "thumbnail", "sha256", item.sha256,
        isExtremeAspect(item.width, item.height) ? "display" : undefined)
    // The dwell upgrade (§8): the stored thumbnail shows immediately; for
    // STILL images the original file loads behind it and fades in on load,
    // so a sweep stays cheap (the 200ms open debounce already suppresses
    // most loads) while a dwell gets real resolution. Videos and animations
    // keep the stored thumbnail — no playback in a peek (§8.4) — and an
    // animated image in an <img> WOULD play, so image/* alone is not the
    // gate: `duration > 0` is the scan's measured-animation sentinel on
    // image rows (docs/animated-image-spans-design.md — NULL unmeasured,
    // 0 still, >0 animated). Accepted risk: an animated image whose
    // duration was never measured (pre-backfill row) upgrades and animates;
    // bounded to not-yet-rescanned databases.
    const upgrade =
        item.type.startsWith("image/") &&
        !(item.duration != null && item.duration > 0)
    // Whether the full file has finished decoding. The full img mounts at
    // opacity-0 UNDERNEATH-in-effect (stacked later but transparent) and
    // fades in only on its own onLoad, so a slow full file can never blank
    // the visible thumbnail — the thumbnail layer stays put throughout.
    // Reset per item by the key the surface puts on this component.
    const [fullLoaded, setFullLoaded] = useState(false)
    return (
        // bg-background, not a transparent stack: this layer's whole job is
        // covering the fixed item, and the box is fitted to the PEEKED
        // subject, so the picture underneath shows through any letterbox the
        // two shapes leave over.
        <div className="pointer-events-none absolute inset-0 z-40 bg-background">
            <img
                src={thumbnailURL}
                alt=""
                draggable={false}
                // ref for the cache hit that decodes before React attaches
                // onLoad, onLoad for the network path — the gallery
                // thumbnail's pattern, and the only way a re-hover on a warm
                // image confirms anything at all.
                ref={(el) => {
                    if (el?.naturalWidth && el.naturalHeight) {
                        onAspect(item.sha256, el.naturalWidth / el.naturalHeight)
                    }
                }}
                onLoad={(e) => {
                    const el = e.currentTarget
                    onAspect(item.sha256, el.naturalWidth / el.naturalHeight)
                }}
                className={LAYER_CLASSES}
            />
            {upgrade && (
                <img
                    src={getFileURL(dbs, "file", "sha256", item.sha256)}
                    alt=""
                    draggable={false}
                    // naturalWidth also guards the error case: a full file
                    // that 404s is `complete` too, and fading a broken image
                    // in over a good thumbnail is worse than not upgrading.
                    //
                    // Reports NO aspect — see onAspect's trap. This element
                    // paints a picture the viewer never paints, so its answer
                    // would size the box around something the other subject
                    // cannot show.
                    ref={(el) => {
                        if (el?.complete && el.naturalWidth && el.naturalHeight) {
                            setFullLoaded(true)
                        }
                    }}
                    onLoad={() => setFullLoaded(true)}
                    className={cn(
                        LAYER_CLASSES,
                        "transition-opacity duration-150",
                        fullLoaded ? "opacity-100" : "opacity-0"
                    )}
                />
            )}
        </div>
    )
}
