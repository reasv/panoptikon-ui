import React, { useMemo } from 'react'
import { Play, Pause } from 'lucide-react'
import { useItemSelection } from '@/lib/state/itemSelection'
import { components } from '@/lib/panoptikon'

export function PlayButton({
    isPlaying,
    setPlaying,
}: {
    isPlaying: boolean,
    setPlaying: (isPlaying: boolean) => void
}) {
    return <button
        title={
            isPlaying ? "Pause video" : "Play video"
        }
        className={"hover:scale-105 absolute bottom-2 right-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"}
        onClick={() => setPlaying(!isPlaying)}
    >
        {isPlaying ?
            <Pause className="w-6 h-6 text-gray-800" />
            :
            <Play className="w-6 h-6 text-gray-800 fill-gray-800" />
        }
    </button>
}