'use client'

import React, { useMemo } from 'react'
import { cn } from "@/lib/utils"
import { useGalleryPinBoardLayout } from "@/lib/state/gallery"

import { Pin, PinOff } from 'lucide-react'

export function PinButton({
    sha256,
    showPins,
    hidePins,
}: {
    sha256: string,
    showPins?: boolean
    hidePins?: boolean
}) {
    const prefixLength = 10 // The length of the prefix of the sha256 hash
    const [savedLayout, setSavedLayout] = useGalleryPinBoardLayout()
    const pins: [string, number][] = useMemo(() => savedLayout.filter((_, i) => i % 5 === 0).map((id, index) => [id, index]), [savedLayout])
    const isPinned = useMemo(() => savedLayout.filter((id, i) => i % 5 === 0 && sha256.slice(0, prefixLength) === id.slice(0, prefixLength)).length > 0, [savedLayout, sha256])
    const handlePinClick = () => {
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