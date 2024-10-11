'use client'

import React, { useMemo } from 'react'
import { cn } from "@/lib/utils"
import { useGalleryPins } from "@/lib/state/gallery"

import { Pin, PinOff } from 'lucide-react'

export function PinButton({
    file_id,
    showPins,
}: {
    file_id: number,
    showPins?: boolean
}) {
    const [pins, setPins] = useGalleryPins()
    const isPinned = useMemo(() => pins.includes(file_id), [pins, file_id])
    const handlePinClick = () => {
        setPins((prev) => {
            if (prev.includes(file_id)) {
                return prev.filter((id) => id !== file_id)
            } else {
                return [...prev, file_id]
            }
        })
    }
    return <button
        title={
            isPinned ? "Unpin this image" : "Pin this image"
        }
        className={
            cn("hover:scale-105 absolute top-2 left-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300",
                showPins || isPinned ? 'opacity-100' : 'opacity-0')
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