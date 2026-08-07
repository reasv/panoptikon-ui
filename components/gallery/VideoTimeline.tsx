import React from "react"
import { TrimRange } from "@/lib/pinboardCrop"
import { MARKER_MIN_WIDTH, VideoRail } from "./VideoRail"

// Scrub timeline for a pinboard video: click/drag seeks (pausing while
// scrubbing), trim bounds render as draggable markers whose drag live-seeks
// the video so the loop point is framed against the actual picture, and a
// current/total readout sits above the right end of the track. Must be
// rendered as a sibling of the pin's .drag-handle layer so react-grid-layout
// never starts a grid drag from it.
// Thin wrapper over the shared rail pinned to this surface's original
// behaviour: hover-gated playhead, floating readout, no rail below the
// marker width. Superseded by VideoPlayerSurface — it must stay
// pixel-identical until its call sites are removed.
export function VideoTimeline({
    videoRef,
    trim,
    onTrimChange,
    className,
}: {
    videoRef: React.RefObject<HTMLVideoElement | null>
    trim: TrimRange | null
    onTrimChange: (trim: TrimRange | null) => void
    className?: string
}) {
    return (
        <VideoRail
            videoRef={videoRef}
            trim={trim}
            onTrimChange={onTrimChange}
            className={className}
            showReadout
            hoverGated
            minWidth={MARKER_MIN_WIDTH}
        />
    )
}
