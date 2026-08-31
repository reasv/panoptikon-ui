'use client'

import React from 'react'
import { cn } from "@/lib/utils"
import { useCellCallbacks, useCellFlags } from "@/lib/state/cellActions"

import { Pin, PinOff } from 'lucide-react'

/** The length of the sha256 prefix a pinboard record stores. */
const PREFIX_LENGTH = 10

/**
 * Pin / unpin, mounted on every grid card, every filmstrip card and every pin.
 *
 * Deliberately NO URL-state hooks: this button used to call `usePinBoard`
 * (ten nuqs hook families, one of them a per-render stringify of `pinboard` —
 * the app's longest URL parameter) plus `useGalleryIndex`,
 * `useGalleryHidePinBoard` and `useGalleryTrim`, which made it thirteen of the
 * nineteen nuqs instances a grid cell carried and re-rendered every visible
 * card on every URL write. The whole decision now lives in the page's one
 * CellActionsHost; this reads a Set membership to paint itself and calls a
 * stable callback to act (lib/state/cellActions.ts).
 */
export function PinButton({
    sha256,
    layoutKey,
    showPins,
    hidePins,
}: {
    sha256: string,
    // When set (the button lives on a specific pinboard copy), unpin removes
    // exactly that record rather than the first one matching the sha256 prefix
    // — otherwise duplicates of the same image would remove the wrong copy.
    layoutKey?: string
    showPins?: boolean
    hidePins?: boolean
}) {
    const { pinnedPrefixes } = useCellFlags()
    const { togglePin } = useCellCallbacks()
    const isPinned = pinnedPrefixes.has(sha256.slice(0, PREFIX_LENGTH))
    const handlePinClick = (e: React.MouseEvent) => {
        togglePin(sha256, { layoutKey, shiftKey: e.shiftKey })
    }
    return <button
        // data-pin-carry: the carry's click-outside cancel exempts these
        // buttons so shift+clicking another one re-starts the carry
        data-pin-carry
        title={
            isPinned
                ? (layoutKey !== undefined
                    ? "Unpin this image"
                    : "Unpin this image (Shift: carry a copy to a spot)")
                : "Pin this image (Shift: carry it to a spot on the board)"
        }
        className={
            cn("hover:scale-105 absolute top-2 left-2 bg-white rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.35)] p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300",
                (showPins || isPinned) && !hidePins ? 'opacity-100' : 'opacity-0')
        }
        onClick={handlePinClick}
    >
        {isPinned ? (
            <PinOff className="w-6 h-6 text-gray-800 fill-gray-800" />

        ) : (
            <Pin className="w-6 h-6 text-gray-800" />
        )}
    </button>
}
