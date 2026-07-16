import React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { TrimRange } from "@/lib/pinboardCrop"

// Below this root width (px) the timeline hides entirely — the set-point
// buttons remain the only trim mechanism on tiny pins
const MIN_WIDTH = 120
// Trim bounds closer than this (seconds) count as coincident: which marker a
// drag grabs is decided by its first horizontal direction (only the start can
// move left, only the end can move right)
const COINCIDENT_EPS = 0.011
// Pixels of movement before a coincident-marker drag commits to a direction
const DIRECTION_DEADZONE = 3

function formatTime(t: number, withCentis = false): string {
    if (!isFinite(t) || t < 0) t = 0
    const h = Math.floor(t / 3600)
    const m = Math.floor((t % 3600) / 60)
    const sec = t % 60
    const mm = h > 0 ? String(m).padStart(2, "0") : String(m)
    const ss = withCentis
        ? sec.toFixed(2).padStart(5, "0")
        : String(Math.floor(sec)).padStart(2, "0")
    return `${h > 0 ? `${h}:` : ""}${mm}:${ss}`
}

type MarkerKind = "start" | "end"

interface MarkerDrag {
    // "pending": coincident markers, direction not yet decided
    which: MarkerKind | "pending"
    grabX: number
    value: number
    wasPlaying: boolean
}

function TimeBubble({
    children,
    className,
}: {
    children: React.ReactNode
    className?: string
}) {
    // pb (not mb) keeps the gap under the bubble inside its hit box, so
    // moving the pointer from a marker up into its bubble doesn't flicker
    return (
        <div className={cn("absolute bottom-full left-1/2 -translate-x-1/2 pb-1.5", className)}>
            <div className="flex items-center gap-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] leading-4 text-white whitespace-nowrap tabular-nums">
                {children}
            </div>
        </div>
    )
}

// Scrub timeline for a pinboard video: click/drag seeks (pausing while
// scrubbing), trim bounds render as draggable markers whose drag live-seeks
// the video so the loop point is framed against the actual picture, and a
// current/total readout sits above the right end of the track. Must be
// rendered as a sibling of the pin's .drag-handle layer so react-grid-layout
// never starts a grid drag from it.
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
    const rootRef = React.useRef<HTMLDivElement>(null)
    const trackRef = React.useRef<HTMLDivElement>(null)
    const [duration, setDuration] = React.useState(NaN)
    const [currentTime, setCurrentTime] = React.useState(0)
    const [width, setWidth] = React.useState(0)
    const [drag, setDrag] = React.useState<MarkerDrag | null>(null)
    const [scrubbing, setScrubbing] = React.useState(false)
    const scrubWasPlaying = React.useRef(false)
    const [hoverTime, setHoverTime] = React.useState<number | null>(null)
    const [hoveredMarker, setHoveredMarker] = React.useState<MarkerKind | null>(null)
    const [pinHovered, setPinHovered] = React.useState(false)

    React.useEffect(() => {
        const video = videoRef.current
        if (!video) return
        const update = () => setDuration(video.duration)
        update()
        video.addEventListener("loadedmetadata", update)
        video.addEventListener("durationchange", update)
        return () => {
            video.removeEventListener("loadedmetadata", update)
            video.removeEventListener("durationchange", update)
        }
    }, [videoRef])

    React.useEffect(() => {
        const el = rootRef.current
        if (!el) return
        const measure = () => setWidth(el.clientWidth)
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    // The playhead/readout only need to be live while they're visible (the
    // pin is hovered) or mid-interaction — with many autoplaying pins a
    // permanent rAF loop per pin would be waste
    React.useEffect(() => {
        const group = rootRef.current?.closest(".group")
        if (!group) return
        const enter = () => setPinHovered(true)
        const leave = () => setPinHovered(false)
        group.addEventListener("pointerenter", enter)
        group.addEventListener("pointerleave", leave)
        return () => {
            group.removeEventListener("pointerenter", enter)
            group.removeEventListener("pointerleave", leave)
        }
    }, [])
    const interacting = drag != null || scrubbing
    React.useEffect(() => {
        if (!pinHovered && !interacting) return
        let raf = 0
        const tick = () => {
            const video = videoRef.current
            if (video) setCurrentTime(video.currentTime)
            raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [pinHovered, interacting, videoRef])

    const posToTime = (clientX: number): number => {
        const track = trackRef.current
        if (!track || !isFinite(duration) || duration <= 0) return 0
        const rect = track.getBoundingClientRect()
        const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
        return frac * duration
    }

    const onTrackPointerDown = (e: React.PointerEvent) => {
        if (!isFinite(duration) || duration <= 0) return
        const video = videoRef.current
        if (!video) return
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        scrubWasPlaying.current = !video.paused
        video.pause()
        video.currentTime = posToTime(e.clientX)
        setScrubbing(true)
        setHoverTime(posToTime(e.clientX))
    }
    const onTrackPointerMove = (e: React.PointerEvent) => {
        if (!isFinite(duration) || duration <= 0) return
        const t = posToTime(e.clientX)
        setHoverTime(t)
        if (scrubbing) {
            const video = videoRef.current
            if (video) video.currentTime = t
        }
    }
    const onTrackPointerUp = () => {
        if (!scrubbing) return
        setScrubbing(false)
        if (scrubWasPlaying.current) videoRef.current?.play().catch(() => { })
    }

    const startBound = trim?.start ?? null
    const endBound = trim?.end ?? null

    const onMarkerPointerDown = (which: MarkerKind) => (e: React.PointerEvent) => {
        const video = videoRef.current
        if (!video || !isFinite(duration) || duration <= 0) return
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        const coincident =
            startBound != null &&
            endBound != null &&
            Math.abs(endBound - startBound) <= COINCIDENT_EPS
        const wasPlaying = !video.paused
        video.pause()
        setDrag({
            which: coincident ? "pending" : which,
            grabX: e.clientX,
            value: which === "end" ? endBound! : startBound!,
            wasPlaying,
        })
    }
    const onMarkerPointerMove = (e: React.PointerEvent) => {
        if (!drag) return
        let which: MarkerKind
        if (drag.which === "pending") {
            const dx = e.clientX - drag.grabX
            if (Math.abs(dx) < DIRECTION_DEADZONE) return
            which = dx < 0 ? "start" : "end"
        } else {
            which = drag.which
        }
        const t = posToTime(e.clientX)
        const value = which === "start"
            ? Math.min(t, endBound ?? duration)
            : Math.max(t, startBound ?? 0)
        setDrag({ ...drag, which, value })
        // Live preview: the playhead follows the marker so the loop point is
        // placed against the actual frame
        const video = videoRef.current
        if (video) video.currentTime = value
    }
    const onMarkerPointerUp = () => {
        if (!drag) return
        const video = videoRef.current
        if (drag.which !== "pending") {
            const v = Math.round(drag.value * 100) / 100
            const next: TrimRange = drag.which === "start"
                ? { start: v, end: endBound }
                : { start: startBound, end: v }
            onTrimChange(next)
            // Releasing the end marker leaves the playhead exactly at the end
            // point, from which crossing detection would never fire — restart
            // the loop, which doubles as "here's your loop" feedback
            if (drag.which === "end" && video) video.currentTime = next.start ?? 0
        }
        if (drag.wasPlaying) video?.play().catch(() => { })
        setDrag(null)
    }

    const clearBound = (which: MarkerKind) => {
        const next: TrimRange = which === "start"
            ? { start: null, end: endBound }
            : { start: startBound, end: null }
        onTrimChange(next.start == null && next.end == null ? null : next)
        setHoveredMarker(null)
    }

    // Track geometry needs the real duration; keep the (invisible until
    // hovered) root mounted anyway so width/duration can be measured
    const ready = width >= MIN_WIDTH && isFinite(duration) && duration > 0
    // While dragging, the dragged marker renders at the uncommitted value
    const dispStart = drag?.which === "start" ? drag.value : startBound
    const dispEnd = drag?.which === "end" ? drag.value : endBound
    const pct = (t: number) => `${(Math.min(t, duration) / duration) * 100}%`

    const marker = (which: MarkerKind, value: number) => {
        // While a coincident drag is direction-undecided, only the topmost
        // marker (end renders last, so it got the pointer) shows a bubble —
        // both would otherwise stack identical bubbles at the same spot
        const beingDragged = drag != null &&
            (drag.which === which || (drag.which === "pending" && which === "end"))
        const showBubble = beingDragged || (hoveredMarker === which && drag == null)
        return (
            <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-ew-resize touch-none"
                style={{ left: pct(value) }}
                onPointerEnter={() => setHoveredMarker(which)}
                onPointerLeave={() => setHoveredMarker(null)}
                onPointerDown={onMarkerPointerDown(which)}
                onPointerMove={onMarkerPointerMove}
                onPointerUp={onMarkerPointerUp}
            >
                <div className="w-1.5 h-4 rounded-sm bg-blue-400 border border-white/90 shadow-sm" />
                {showBubble && (
                    <TimeBubble>
                        {formatTime(value, true)}
                        <button
                            title={`Clear loop ${which}`}
                            className="hover:text-red-400"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() => clearBound(which)}
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </TimeBubble>
                )}
            </div>
        )
    }

    return (
        <div ref={rootRef} className={cn("select-none", className)}>
            {ready && <>
                <div className="absolute right-0 top-0 rounded bg-black/50 px-1 text-[10px] leading-4 text-white/90 tabular-nums pointer-events-none">
                    {formatTime(currentTime)} / {formatTime(duration)}
                </div>
                <div
                    className="absolute inset-x-0 bottom-0 h-7 flex items-center cursor-pointer touch-none"
                    onPointerDown={onTrackPointerDown}
                    onPointerMove={onTrackPointerMove}
                    onPointerUp={onTrackPointerUp}
                    onPointerLeave={() => setHoverTime(null)}
                >
                    <div ref={trackRef} className="relative w-full h-1.5 rounded-full bg-white/40">
                        {(dispStart != null || dispEnd != null) && (
                            <div
                                className="absolute inset-y-0 bg-blue-400/70 rounded-full"
                                style={{
                                    left: pct(dispStart ?? 0),
                                    right: `calc(100% - ${pct(dispEnd ?? duration)})`,
                                }}
                            />
                        )}
                        {/* playhead */}
                        <div
                            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border border-black/30 shadow-sm pointer-events-none"
                            style={{ left: pct(currentTime) }}
                        />
                        {hoverTime != null && !scrubbing && drag == null && hoveredMarker == null && (
                            <div
                                className="absolute -translate-x-1/2 pointer-events-none"
                                style={{ left: pct(hoverTime) }}
                            >
                                <TimeBubble>{formatTime(hoverTime, true)}</TimeBubble>
                            </div>
                        )}
                        {scrubbing && (
                            <div
                                className="absolute -translate-x-1/2 pointer-events-none"
                                style={{ left: pct(currentTime) }}
                            >
                                <TimeBubble>{formatTime(currentTime, true)}</TimeBubble>
                            </div>
                        )}
                        {dispStart != null && marker("start", dispStart)}
                        {dispEnd != null && marker("end", dispEnd)}
                    </div>
                </div>
            </>}
        </div>
    )
}
