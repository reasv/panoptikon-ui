'use client'

import React, { useMemo } from 'react'
import { cn } from "@/lib/utils"
import { useGalleryPinBoardLayout } from "@/lib/state/gallery"

import { Pin, PinOff } from 'lucide-react'

export function PinButton({
    item_id,
    showPins,
    hidePins,
}: {
    item_id: number,
    showPins?: boolean
    hidePins?: boolean
}) {
    const [savedLayout, setSavedLayout] = useGalleryPinBoardLayout()
    const pins = useMemo(() => savedLayout.filter((_, i) => i % 5 === 0).map((id, index) => [id, index]), [savedLayout])
    const isPinned = useMemo(() => savedLayout.filter((id, i) => i % 5 === 0 && item_id === id).length > 0, [savedLayout, item_id])
    const handlePinClick = () => {
        const isPinnedIndex = pins.findIndex(([id]) => id === item_id)
        if (isPinnedIndex !== -1) {
            const index = pins[isPinnedIndex][1]
            const newLayout = [...savedLayout]
            newLayout.splice(index * 5, 5)
            setSavedLayout(newLayout)
        } else {
            setSavedLayout([...savedLayout, item_id, 0, 0, 1, 1])
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