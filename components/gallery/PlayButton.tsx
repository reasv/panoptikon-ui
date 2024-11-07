import React, { useMemo } from 'react'
import { Play, Pause, Square, VolumeOff, Volume2 } from 'lucide-react'
import { useItemSelection } from '@/lib/state/itemSelection'
import { components } from '@/lib/panoptikon'

export function PlayButton({
    isPlaying,
    isShown,
    isMuted,
    setMuted,
    setPlaying,
    stopVideo,
}: {
    isPlaying: boolean,
    isShown: boolean,
    isMuted: boolean,
    setMuted: (isMuted: boolean) => void,
    setPlaying: (isPlaying: boolean) => void
    stopVideo: () => void
}) {
    return <>
        <button
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
        {isShown && <button
            title={"Stop Video"}
            className={"hover:scale-105 absolute bottom-14 right-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"}
            onClick={() => stopVideo()}
        >
            <Square className="w-6 h-6 text-gray-800 fill-gray-800" />
        </button>}
        {isShown && <button
            title={isMuted ? "Unmute video" : "Mute video"}
            className={"hover:scale-105 absolute bottom-[6.5rem] right-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"}
            onClick={() => setMuted(!isMuted)}
        >
            {isMuted ?
                <VolumeOff className="w-6 h-6 text-gray-800" />
                :
                <Volume2 className="w-6 h-6 text-gray-800" />
            }
        </button>}
    </>
}