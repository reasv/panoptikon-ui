'use client'

import React, { useMemo } from 'react'
import { cn } from "@/lib/utils"
import { useGalleryPinBoardLayout } from "@/lib/state/gallery"

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
    const [savedLayout, setSavedLayout] = useGalleryPinBoardLayout()
    const pins: [string, number][] = useMemo(() => savedLayout.filter((_, i) => i % 5 === 0).map((id, index) => [id, index]), [savedLayout])
    const isPinned = useMemo(() => savedLayout.filter((id, i) => i % 5 === 0 && sha256.slice(0, prefixLength) === id.slice(0, prefixLength)).length > 0, [savedLayout, sha256])
    const handlePinClick = () => {
        // Bound to a specific copy: splice out that exact record by its offset
        if (layoutKey !== undefined) {
            const offset = parseInt(layoutKey.split("-")[0])
            const newLayout = [...savedLayout]
            newLayout.splice(offset, 5)
            setSavedLayout(newLayout)
            return
        }
        const isPinnedIndex = pins.findIndex(([id]) => id.slice(0, prefixLength) === sha256.slice(0, prefixLength))
        if (isPinnedIndex !== -1) {
            const index = pins[isPinnedIndex][1]
            const newLayout = [...savedLayout]
            newLayout.splice(index * 5, 5)
            setSavedLayout(newLayout)
        } else {
            setSavedLayout([...savedLayout, sha256.slice(0, prefixLength), "0", "0", "10", "10"])
        }
    }
    return <button
        title={
            isPinned ? "Unpin this image" : "Pin this image"
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