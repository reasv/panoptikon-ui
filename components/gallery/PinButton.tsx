'use client'

import React, { useMemo } from 'react'
import { cn } from "@/lib/utils"
import { usePinBoard } from "@/lib/state/pinboard"
import { useGalleryHidePinBoard, useGalleryIndex } from "@/lib/state/gallery"
import { v1ScaleFactors } from "@/lib/pinboardGrid"
import { markPinboardPendingEdit } from "@/lib/pinboardNavigation"
import { usePinboardCarry } from "@/lib/state/pinboardCarry"

import { Pin, PinOff } from 'lucide-react'

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
    const prefixLength = 10 // The length of the prefix of the sha256 hash
    const { records, updateRecords } = usePinBoard()
    // Which host will react to a board appearing: with the gallery open, a
    // new board replaces only the image pane (the surrounding gallery UI
    // and thumbnail strip stay); with it closed, the grid view's Pinboard
    // tab would be a total context switch away from the results
    const galleryOpen = useGalleryIndex()[0] !== null
    const setHidePinBoard = useGalleryHidePinBoard()[1]
    const isPinned = useMemo(
        () => records.filter((id, i) => i % 5 === 0 && sha256.slice(0, prefixLength) === id.slice(0, prefixLength)).length > 0,
        [records, sha256]
    )
    const handlePinClick = (e: React.MouseEvent) => {
        // Shift+click on a gallery-side pin button picks the image up
        // instead of pinning it: a sticky carry that rides the cursor
        // until dropped on the board with a click (see pinboardCarry.ts).
        // Only when a board is mounted to land on — and never for the
        // board-bound unpin buttons, which keep their exact-copy removal.
        if (e.shiftKey && layoutKey === undefined
            && usePinboardCarry.getState().boardMounted) {
            usePinboardCarry.getState().start(sha256)
            return
        }
        // This button also renders where the board is unmounted (search
        // grid, gallery image tab): leave a mark so the auto-layout trigger
        // picks the edit up on the board's next mount. A mounted board
        // consumes it in the same pass its count trigger fires, so it never
        // double-layouts.
        markPinboardPendingEdit()
        // A first pin from OUTSIDE the gallery CREATES the board while the
        // user is browsing results: opening the gallery later must show the
        // image they clicked, not the board — so the board starts hidden on
        // the gallery side (ghp), until they switch to it on purpose. A
        // first pin from inside the gallery keeps ghp at its default and
        // the new board appears immediately, as it always has. The flag is
        // reset when the board is destroyed (see usePinBoard), so each
        // creation decides this fresh. Same-tick with the record write
        // below — nuqs merges both into one history entry.
        if (records.length === 0 && !galleryOpen) {
            void setHidePinBoard(true)
        }
        // Bound to a specific copy: splice out that exact record by its offset
        if (layoutKey !== undefined) {
            updateRecords((prev) => {
                const offset = parseInt(layoutKey.split("-")[0])
                const next = [...prev]
                next.splice(offset, 5)
                return next
            })
            return
        }
        updateRecords((prev, grid) => {
            const pins: [string, number][] = prev
                .filter((_, i) => i % 5 === 0)
                .map((id, index) => [id, index])
            const isPinnedIndex = pins.findIndex(([id]) => id.slice(0, prefixLength) === sha256.slice(0, prefixLength))
            if (isPinnedIndex !== -1) {
                const index = pins[isPinnedIndex][1]
                const next = [...prev]
                next.splice(index * 5, 5)
                return next
            }
            // Default new-pin size is 10x10 in v1 units, scaled to the
            // board's grid
            const { sx, sy } = v1ScaleFactors(grid)
            return [
                ...prev,
                sha256.slice(0, prefixLength),
                "0",
                "0",
                Math.round(10 * sx).toString(),
                Math.round(10 * sy).toString(),
            ]
        })
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
            cn("hover:scale-105 absolute top-2 left-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300",
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
