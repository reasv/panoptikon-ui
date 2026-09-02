"use client"

import { useState } from "react"
import { thumbnailPictureURL, thumbnailStillURL } from "@/lib/thumbnailURL"
import type { PictureItem, UrlDbs } from "@/lib/thumbnailURL"
import type { DisplayLoopTrigger } from "@/lib/thumbnailTier"

/**
 * A CONTAIN surface's `<img>` for one item, with the one retry the row-data
 * rule cannot do without.
 *
 * `thumbnailPictureURL` decides `still=true` from `size`, the dimensions and
 * `duration` (docs/thumbnail-format-implementation.md R3), and ONE shape of row
 * cannot be settled from those: no `size` on record, dimensions inside the
 * bounds, and a file that is nonetheless over `max_bytes`. That answers "not a
 * loop", the element requests video bytes, and it fails to decode them —
 * SILENTLY, because an `<img>` has no error state a user can read.
 *
 * So it says so through `onError` and re-requests the one URL that can never be
 * video: `still=true` at the display size, which the endpoint guarantees
 * answers a picture (§5). The same construction LoopVideo's poster fallback
 * uses, for the same unpredictable case.
 *
 * THE RETRY IS ONE-WAY and there is no third rung: a second failure sets the
 * same state, which React bails out of, so this cannot loop. Reset across items
 * by the KEY the host puts on it, which is why the state does not have to carry
 * a sha of its own.
 *
 * BOTH ITS CALLERS PASS ROWS THAT MAY BE INCOMPLETE, which is why it is shared:
 * the peek layer is handed selection-built rows that may carry no `size`
 * (lib/types.d.ts), and the similarity header builds its row out of a query
 * that has not necessarily resolved.
 */
export function StillFallbackImage({
    dbs,
    item,
    trigger,
    alt,
    className,
    draggable,
    onPainted,
}: {
    dbs: UrlDbs
    item: PictureItem
    /** `/api/client-config`'s display-loop bounds; null means "always a picture". */
    trigger: DisplayLoopTrigger | null | undefined
    alt: string
    className?: string
    draggable?: boolean
    /**
     * The element, whenever it has painted. Called from a ref (for a cache hit
     * that decodes before React attaches `onLoad`) AND from `onLoad` (for the
     * network path), so a handler here must be idempotent — which is the same
     * contract every other picture in the app reports under.
     */
    onPainted?: (element: HTMLImageElement) => void
}) {
    const [failed, setFailed] = useState(false)
    const src = failed
        ? thumbnailStillURL(dbs, item.sha256)
        : thumbnailPictureURL(dbs, item, trigger)
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={src}
            alt={alt}
            draggable={draggable}
            className={className}
            ref={(element) => {
                if (element?.naturalWidth && element.naturalHeight) {
                    onPainted?.(element)
                }
            }}
            onLoad={(event) => onPainted?.(event.currentTarget)}
            onError={() => setFailed(true)}
        />
    )
}
