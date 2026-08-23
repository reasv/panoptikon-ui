"use client"
import { useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { cn, getFileURL } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"

// The maximized search overlay's hover preview
// (docs/maximized-pinboard-search-overlay-design.md §8): hovering a strip
// card shows a large centered image over the board, replacing the gallery's
// large-image role while maximized. Built on PreviewPopover's conventions —
// createPortal to <body> (the overlay ancestry is position:fixed, not
// transformed, but body-portaling keeps the two preview surfaces identical
// and immune to any future container change), pointer-events-none fixed
// z-70 (§7: above the overlay panel at z-50 and the carry ghost at z-60),
// the same rounded/border/bg/shadow frame and object-contain img — but with
// a CENTERED box over the board area instead of the near-card box math.
//
// The box is viewport-relative and exact aspect math is unnecessary:
// object-contain letterboxes inside it (§8). Height subtracts
// --pinboard-bottom-inset, which the overlay publishes only while its panel
// is SHOWN — and a strip card can only be hovered while the panel is shown,
// so the var is present by construction whenever this renders and the
// preview never covers the open panel.
const PREVIEW_BOX: CSSProperties = {
    top: "4vh",
    left: "12vw",
    width: "76vw",
    height: "calc(92vh - var(--pinboard-bottom-inset, 0px))",
}

export function ResultHoverPreview({ item }: { item: SearchResult }) {
    return createPortal(
        <div className="pointer-events-none fixed z-70" style={PREVIEW_BOX}>
            {/* Keyed by content: PreviewImage owns the dwell-upgrade state
                (fullLoaded), and moving the hover to another card must reset
                it — without the remount, the new item's full file would
                render at opacity-100 from byte zero and blank the box while
                it loads. */}
            <PreviewImage key={item.sha256} item={item} />
        </div>,
        document.body
    )
}

// Both layers share the popover img frame (PreviewPopover's classes) and the
// same box, absolutely stacked.
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
    return (
        <div className="relative h-full w-full">
            <img
                src={thumbnailURL}
                alt=""
                draggable={false}
                className={LAYER_CLASSES}
            />
            {upgrade && (
                <img
                    src={getFileURL(dbs, "file", "sha256", item.sha256)}
                    alt=""
                    draggable={false}
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
