import React from 'react'
import { Play, Pause, VolumeOff, Volume2, X, TvMinimalPlay, TvMinimal } from 'lucide-react'

export function MediaControls({
    isPlaying,
    isShown,
    isMuted,
    showControls,
    setMuted,
    setPlaying,
    stopVideo,
    setShowControls,
    noPlayButtonShift,
}: {
    isPlaying: boolean,
    isShown: boolean,
    isMuted: boolean,
    showControls: boolean,
    setMuted: (isMuted: boolean) => void,
    setPlaying: (isPlaying: boolean) => void
    stopVideo: () => void
    setShowControls: (showControls: boolean) => void
    noPlayButtonShift?: boolean
}) {
    return <>
        {<button
            title={
                isPlaying ? "Pause video" : "Play video"
            }
            className={`hover:scale-105 absolute right-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${showControls && isShown && !noPlayButtonShift ? "bottom-[12.5rem]" : "bottom-2"}`}
            onClick={() => setPlaying(!isPlaying)}
        >
            {isPlaying ?
                <Pause className="w-6 h-6 text-gray-800" />
                :
                <Play className="w-6 h-6 text-gray-800 fill-gray-800" />
            }
        </button>}
        {isShown && (!showControls) && <button
            title={isMuted ? "Unmute video" : "Mute video"}
            className={"hover:scale-105 absolute right-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bottom-14"}
            onClick={() => setMuted(!isMuted)}
        >
            {isMuted ?
                <VolumeOff className="w-6 h-6 text-gray-800" />
                :
                <Volume2 className="w-6 h-6 text-gray-800" />
            }
        </button>}
        {isShown && <button
            title={"Close Video"}
            className={"hover:scale-105 absolute right-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bottom-[6.5rem] "}
            onClick={() => stopVideo()}
        >
            <X className="w-6 h-6 text-gray-800 fill-gray-800" />
        </button>}

        {isShown && <button
            title={showControls ? "Hide Native Controls" : "Show Native Controls"}
            className={"hover:scale-105 absolute bottom-[9.5rem] right-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"}
            onClick={() => setShowControls(!showControls)}
        >
            {showControls ?
                <TvMinimal className="w-6 h-6 text-gray-800" />
                :
                <TvMinimalPlay className="w-6 h-6 text-gray-800" />
            }
        </button>}
    </>
}