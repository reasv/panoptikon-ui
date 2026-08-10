import { Play, Pause, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

// The S0 overlay verb: "become a player". Mute, close and the native-controls
// toggle used to live here as a column of white circles beside it; the player
// surface owns them from the moment the video loads (S1), so both hosts —
// gallery and pin — render this only while the video is unloaded and nothing
// is left to gate (docs/video-player-ui-design.md).
export function MediaControls({
    isPlaying,
    setPlaying,
    playButtonClassName,
    progress,
}: {
    isPlaying: boolean,
    setPlaying: (isPlaying: boolean) => void
    // REPLACES the play button's corner classes (both hosts put it
    // bottom-LEFT, where the player row's play/pause appears when the video
    // loads). A replacement, not an addition: `left-2` merged onto a default
    // carrying `right-2` would set both and stretch the button across the pin
    // — tailwind-merge treats left and right as independent groups.
    playButtonClassName?: string
    // A running transcode, rendered ON the play affordance
    // (docs/video-transcoding-design.md §8): "#3" while queued, "42%" while
    // encoding, an alert glyph when the job failed. Both hosts pass it, so a
    // pin and the gallery show the same job the same way.
    //
    // It also PINS the button visible: the hover-only fade is right for a
    // verb, and wrong for the only feedback a job in flight has.
    progress?: { text: string; error?: boolean } | null
}) {
    return <button
        title={
            progress?.error ? progress.text
                : progress ? `Preparing this video for playback (${progress.text})`
                    : isPlaying ? "Pause video" : "Play video"
        }
        // bottom-2 unconditionally: the button used to climb to bottom-50 to
        // clear the native control bar, a state neither caller can reach any
        // more
        className={cn(
            "hover:scale-105 absolute bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300",
            // Every dimension below is a SPACING utility, never a px literal:
            // the pin scopes `--spacing` by container query (globals.css), so
            // this row shrinks with the pin exactly like the play glyph does.
            progress && "flex items-center gap-1 rounded-full px-3 opacity-100",
            playButtonClassName ?? "right-2 bottom-2",
        )}
        onClick={() => setPlaying(!isPlaying)}
    >
        {progress?.error ?
            <AlertTriangle className="w-6 h-6 text-gray-800" />
            : isPlaying ?
                <Pause className="w-6 h-6 text-gray-800" />
                :
                <Play className="w-6 h-6 text-gray-800 fill-gray-800" />
        }
        {progress && !progress.error && (
            // Tabular figures so a percentage ticking up does not jiggle the
            // pill's width on every sample
            <span className="text-xs font-medium tabular-nums text-gray-800">
                {progress.text}
            </span>
        )}
    </button>
}
