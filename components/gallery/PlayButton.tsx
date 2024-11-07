import React from 'react'
import { Play, Pause, Square, VolumeOff, Volume2, Settings, MonitorCog } from 'lucide-react'

export function MediaControls({
    isPlaying,
    isShown,
    isMuted,
    showControls,
    setMuted,
    setPlaying,
    stopVideo,
    setShowControls
}: {
    isPlaying: boolean,
    isShown: boolean,
    isMuted: boolean,
    showControls: boolean,
    setMuted: (isMuted: boolean) => void,
    setPlaying: (isPlaying: boolean) => void
    stopVideo: () => void
    setShowControls: (showControls: boolean) => void
}) {
    return <>
        {<button
            title={
                isPlaying ? "Pause video" : "Play video"
            }
            className={`hover:scale-105 absolute right-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${showControls && isShown ? "bottom-[12.5rem]" : "bottom-2"}`}
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
            title={"Stop Video"}
            className={"hover:scale-105 absolute right-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bottom-[6.5rem] "}
            onClick={() => stopVideo()}
        >
            <Square className="w-6 h-6 text-gray-800 fill-gray-800" />
        </button>}

        {isShown && <button
            title={showControls ? "Hide Native Controls" : "Show Native Controls"}
            className={"hover:scale-105 absolute bottom-[9.5rem] right-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"}
            onClick={() => setShowControls(!showControls)}
        >
            {showControls ?
                <MonitorCog className="w-6 h-6 text-gray-800" />
                :
                <Settings className="w-6 h-6 text-gray-800" />
            }
        </button>}
    </>
}