"use client"
import { useState } from "react"
import { createPortal } from "react-dom"
import { cn, getFileURL } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"
import { fittedBoxStyle, PEEK_BOUNDS } from "./previewBox"

// The maximized search overlay's hover preview
// (docs/maximized-pinboard-search-overlay-design.md §8): hovering a strip
// card's preview button shows a large centered image over the board,
// replacing the gallery's large-image role while maximized. Built on
// PreviewPopover's conventions — createPortal to <body> (the overlay
// ancestry is position:fixed, not transformed, but body-portaling keeps the
// two preview surfaces identical and immune to any future container
// change), pointer-events-none fixed z-70 (§7: above the overlay panel at
// z-50 and the carry ghost at z-60), the same rounded/border/bg/shadow frame
// and object-contain img — but with a CENTERED box over the board area
// instead of the near-card box math.
//
// The bounds and the fit are in ./previewBox, shared with the pinned viewer
// (§8.3): the two surfaces are LAYERED — this one renders over the open
// viewer without unmounting it (§8.4) — so they must occupy the same region
// and fit an item the same way, or the peek would land beside the viewer's
// frame instead of on it. The var the height subtracts is present by
// construction whenever this renders: a card's preview button can only be
// hovered while the dock's panel is shown.

// How far an element-confirmed aspect must differ from the item-dimensions
// one before the box is resized to it. Purely a no-op filter: an agreeing
// element would otherwise re-lay the box out over a rounding difference. An
// EXIF rotation — the case this exists for — swaps the ratio outright and
// clears this by a mile.
const ASPECT_TOLERANCE = 0.02

export function ResultHoverPreview({ item }: { item: SearchResult }) {
    return createPortal(
        <div
            className="pointer-events-none fixed z-70 flex items-center justify-center"
            style={PEEK_BOUNDS}
        >
            {/* Keyed by content: PreviewImage owns the dwell-upgrade state
                (fullLoaded) and the confirmed aspect, and moving the hover to
                another card must reset both — without the remount, the new
                item's full file would render at opacity-100 from byte zero
                and blank the box while it loads. */}
            <PreviewImage key={item.sha256} item={item} />
        </div>,
        document.body
    )
}

// Both layers share the popover img frame (PreviewPopover's classes) and the
// same box, absolutely stacked. The frame rides the LAYERS, so it hugs the
// fitted box rather than the bounds (§8.2) — and still spans the bounds in
// the no-dimensions fallback, which is today's behavior exactly.
const LAYER_CLASSES =
    "absolute inset-0 h-full w-full rounded-md border bg-background object-contain shadow-xl"

function PreviewImage({ item }: { item: SearchResult }) {
    const [dbs] = useSelectedDBs()
    const thumbnailURL = getFileURL(dbs, "thumbnail", "sha256", item.sha256)
    // The dwell upgrade (§8): the stored thumbnail shows immediately; for
    // STILL images the original file loads behind it and fades in on load,
    // so a sweep stays cheap (the 200ms open debounce already suppresses
    // most loads) while a dwell gets real resolution. Videos and animations
    // keep the stored thumbnail — no playback in the preview (§8) — and an
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
    // Reset per item by the key on this component (see the portal above).
    const [fullLoaded, setFullLoaded] = useState(false)

    // Aspect of the PAINTED picture, from whichever layer has confirmed it.
    // item.width/height are the CODED dimensions — the scanner reads them
    // out of the image header and never looks at EXIF orientation
    // (panoptikon/src/jobs/files.rs, image_header_dimensions) — while the
    // browser DOES apply orientation when it paints an <img>. A snug frame
    // built on the coded numbers is therefore a landscape box around a
    // portrait photo with grey bars down its sides: the old full-bounds box
    // hid that (object-contain just centred the picture) and this one
    // cannot. So element-confirmed beats item dimensions, the same ladder
    // GalleryImageLarge's mediaAspect walks for the same reason.
    //
    // Precedence between our two layers is NOT "first writer wins" as it is
    // there, because these two can disagree with EACH OTHER. The stored
    // thumbnail comes from the `image` crate, which likewise ignores EXIF,
    // so for a large JPEG the thumbnail is UN-rotated while the dwell
    // upgrade's full file is rotated — the thumbnail confirms the wrong
    // shape just as convincingly as the item row does, and it is also why
    // the picture appears to flip mid-fade. The full file is the original as
    // the browser will paint it, so it outranks the thumbnail and may
    // overwrite it; among equals the first writer wins, which also makes
    // both callbacks idempotent (a ref callback re-runs on every render that
    // re-creates it). Keyed by sha so the item that just left can never size
    // the incoming one's box.
    const [confirmed, setConfirmed] = useState<{
        sha: string
        ratio: number
        authoritative: boolean
    } | null>(null)
    const noteAspect = (el: HTMLImageElement | null, authoritative: boolean) => {
        if (!el || !el.naturalWidth || !el.naturalHeight) return
        const ratio = el.naturalWidth / el.naturalHeight
        setConfirmed((prev) =>
            prev?.sha === item.sha256 && (prev.authoritative || !authoritative)
                ? prev
                : { sha: item.sha256, ratio, authoritative }
        )
    }

    const itemRatio = item.width && item.height ? item.width / item.height : null
    const confirmedRatio = confirmed?.sha === item.sha256 ? confirmed.ratio : null
    // The correction is deliberately late — it cannot arrive before a layer
    // has decoded — and that is the trade §8.2 now takes: one settle into the
    // right shape beats a permanently wrong frame, and it lands on the same
    // frame as the picture appearing or sharpening.
    const ratio =
        confirmedRatio !== null &&
        itemRatio !== null &&
        Math.abs(confirmedRatio - itemRatio) > ASPECT_TOLERANCE * itemRatio
            ? confirmedRatio
            : itemRatio
    // The box the layers fill: the aspect fit when the item's dimensions are
    // known, the whole bounds when they are not. Absolutely positioned
    // children contribute no content size, so the fitted box's height comes
    // from aspect-ratio alone.
    const fitted = fittedBoxStyle(ratio, item.width, item.height)
    return (
        <div
            className={cn(
                "relative transition-[width,aspect-ratio] duration-150 ease-out",
                !fitted && "h-full w-full"
            )}
            style={fitted ?? undefined}
        >
            <img
                src={thumbnailURL}
                alt=""
                draggable={false}
                // ref for the cache hit that decodes before React attaches
                // onLoad, onLoad for the network path — the gallery
                // thumbnail's pattern, and the only way a re-hover on a warm
                // image confirms anything at all.
                ref={(el) => {
                    if (el?.complete) noteAspect(el, false)
                }}
                onLoad={(e) => noteAspect(e.currentTarget, false)}
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
                    ref={(el) => {
                        if (el?.complete && el.naturalWidth) {
                            setFullLoaded(true)
                            noteAspect(el, true)
                        }
                    }}
                    onLoad={(e) => {
                        setFullLoaded(true)
                        noteAspect(e.currentTarget, true)
                    }}
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
