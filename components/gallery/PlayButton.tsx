import React from 'react'
import { Play, Pause, VolumeOff, Volume1, Volume2, X, TvMinimalPlay, TvMinimal } from 'lucide-react'
import { cn } from '@/lib/utils'

export function MediaControls({
    isPlaying,
    isShown,
    isMuted,
    showControls,
    setMuted,
    setPlaying,
    stopVideo,
    setShowControls,
    hidePlayButton,
    playButtonClassName,
    volume,
    setVolume,
}: {
    isPlaying: boolean,
    isShown: boolean,
    isMuted: boolean,
    showControls: boolean,
    setMuted: (isMuted: boolean) => void,
    setPlaying: (isPlaying: boolean) => void
    stopVideo: () => void
    setShowControls: (showControls: boolean) => void
    hidePlayButton?: boolean
    // REPLACES the play button's corner classes (pins put it bottom-LEFT,
    // where the player row's play/pause appears when the video loads). A
    // replacement, not an addition: `left-2` merged onto a default carrying
    // `right-2` would set both and stretch the button across the pin —
    // tailwind-merge treats left and right as independent groups.
    playButtonClassName?: string
    // When provided, a volume slider slides out of the mute button on hover
    volume?: number
    setVolume?: (volume: number) => void
}) {
    const [volumeOpen, setVolumeOpen] = React.useState(false)
    const volumeIcon = isMuted || volume === 0 ?
        <VolumeOff className="w-6 h-6 text-gray-800" />
        : (volume !== undefined && volume < 0.5 ?
            <Volume1 className="w-6 h-6 text-gray-800" />
            :
            <Volume2 className="w-6 h-6 text-gray-800" />)
    return <>
        {!hidePlayButton && <button
            title={
                isPlaying ? "Pause video" : "Play video"
            }
            // bottom-2 unconditionally: the button used to climb to
            // bottom-50 to clear the native control bar, but neither caller
            // can reach that state any more — the gallery hides the button
            // outright (hidePlayButton) and pins render MediaControls only
            // while the video is unloaded (isShown false)
            className={cn(
                "hover:scale-105 absolute bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300",
                playButtonClassName ?? "right-2 bottom-2",
            )}
            onClick={() => setPlaying(!isPlaying)}
        >
            {isPlaying ?
                <Pause className="w-6 h-6 text-gray-800" />
                :
                <Play className="w-6 h-6 text-gray-800 fill-gray-800" />
            }
        </button>}
        {isShown && (!showControls) && (setVolume && volume !== undefined ?
            <div
                className="absolute right-2 bottom-14 flex flex-row-reverse items-center opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                onPointerEnter={() => setVolumeOpen(true)}
                onPointerLeave={() => setVolumeOpen(false)}
            >
                <button
                    title={isMuted ? "Unmute video" : "Mute video"}
                    className="hover:scale-105 bg-white rounded-full p-2"
                    onClick={() => setMuted(!isMuted)}
                >
                    {volumeIcon}
                </button>
                {/* Slides out leftward over the video (upward would collide
                    with the Close button in the column) */}
                <div className={cn(
                    "overflow-hidden transition-all duration-200",
                    volumeOpen ? "w-24 mr-2" : "w-0 mr-0",
                )}>
                    <div className="w-24 bg-white rounded-full px-3 py-2 flex items-center">
                        <input
                            type="range"
                            title="Volume"
                            min={0}
                            max={1}
                            step={0.01}
                            value={isMuted ? 0 : volume}
                            onChange={(e) => setVolume(parseFloat(e.target.value))}
                            className="w-full h-1.5 accent-blue-500 cursor-pointer"
                        />
                    </div>
                </div>
            </div>
            :
            <button
                title={isMuted ? "Unmute video" : "Mute video"}
                className={"hover:scale-105 absolute right-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bottom-14"}
                onClick={() => setMuted(!isMuted)}
            >
                {isMuted ?
                    <VolumeOff className="w-6 h-6 text-gray-800" />
                    :
                    <Volume2 className="w-6 h-6 text-gray-800" />
                }
            </button>
        )}
        {isShown && <button
            title={"Close Video"}
            className={"hover:scale-105 absolute right-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bottom-26 "}
            onClick={() => stopVideo()}
        >
            <X className="w-6 h-6 text-gray-800 fill-gray-800" />
        </button>}

        {isShown && <button
            title={showControls ? "Hide Native Controls" : "Show Native Controls"}
            className={"hover:scale-105 absolute bottom-38 right-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"}
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