import React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { TrimRange } from "@/lib/pinboardCrop"

// The scrub/trim rail of the video player surface (VideoPlayerSurface),
// kept a separate module because the gesture code — marker drags, coincident
// direction resolution, scrub-pauses-then-resumes — is the part that must
// stay identical across every host that mounts a player.

// Below this root width (px) marker drag handles are not rendered — the trim
// band still shows the range, and the set-point buttons remain the only trim
// mechanism on tiny pins
export const MARKER_MIN_WIDTH = 120
// Below this root width the rail itself is not rendered at all
export const RAIL_MIN_WIDTH = 90
// Trim bounds closer than this (seconds) count as coincident: which marker a
// drag grabs is decided by its first horizontal direction (only the start can
// move left, only the end can move right)
const COINCIDENT_EPS = 0.011
// Pixels of movement before a coincident-marker drag commits to a direction
const DIRECTION_DEADZONE = 3

export function formatTime(t: number, withCentis = false): string {
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

export function TimeBubble({
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

// Scrub rail for a video: click/drag seeks (pausing while scrubbing), trim
// bounds render as draggable markers whose drag live-seeks the video so the
// loop point is framed against the actual picture. The track wrapper is
// positioned against the root, so the root must be the positioned element
// (the caller's className supplies `absolute`/`relative`). Must be rendered
// as a sibling of a pin's .drag-handle layer so react-grid-layout never
// starts a grid drag from it.
export function VideoRail({
    videoRef,
    trim,
    onTrimChange,
    outroEnd = null,
    className,
    active = false,
    minWidth = MARKER_MIN_WIDTH,
    markerMinWidth = MARKER_MIN_WIDTH,
    onInteractingChange,
}: {
    videoRef: React.RefObject<HTMLVideoElement | null>
    trim: TrimRange | null
    onTrimChange: (trim: TrimRange | null) => void
    // The outro cut point (seconds) while the outro default is what ends
    // playback — the caller has already resolved the user-end override and
    // the degenerate-start guard, so a non-null value here always renders.
    // Drawn as a cyan marker whose grab SEEDS a real user end bound
    // (docs/video-outro-skip-design.md §4).
    outroEnd?: number | null
    className?: string
    // Playhead gate: the rAF runs only while this is true (the surface
    // passes its own visibility, so a board of autoplaying pins never runs
    // a permanent loop per pin)
    active?: boolean
    // Root width (px) below which the rail is not rendered
    minWidth?: number
    // Root width (px) below which marker drag handles are not rendered.
    // Both cutoffs are ROOT widths: a caller that insets the rail inside a
    // wider surface passes them pre-adjusted for that inset.
    markerMinWidth?: number
    // Fires on scrub/marker-drag transitions (auto-hide must not fire
    // mid-gesture)
    onInteractingChange?: (interacting: boolean) => void
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

    // The playhead only needs to be live while it is visible or
    // mid-interaction — a gesture outlives the surface's own visibility
    const interacting = drag != null || scrubbing
    React.useEffect(() => {
        if (!active && !interacting) return
        let raf = 0
        const tick = () => {
            const video = videoRef.current
            if (video) setCurrentTime(video.currentTime)
            raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [active, interacting, videoRef])

    // The callback is a dep, not a ref read during render (forbidden by the
    // React Compiler); callers pass a stable identity, so a re-notify with an
    // unchanged value is the worst this can do
    React.useEffect(() => {
        onInteractingChange?.(interacting)
    }, [interacting, onInteractingChange])

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
    // Seed-on-grab, resolved at RELEASE (docs/video-outro-skip-design.md §4).
    // A gesture that has resolved as an end edit owns the end from that
    // instant — marker blue, band spanning it, skipped-tail dimming stood
    // down — but the seeded bound only reaches `onTrimChange` on pointerup,
    // so one gesture is exactly ONE call and one history entry (the trim
    // contract in lib/state/gallery.ts). Seeding at pointerdown AND
    // committing at pointerup pushed two.
    const endDragActive = drag?.which === "end"
    // The end marker is the outro default's, not the user's, exactly while
    // no user end bound exists and no end edit is in flight. It is the only
    // difference between the two: everything below (geometry, drag, commit)
    // runs one code path.
    const outroMarker = endBound == null && !endDragActive ? outroEnd : null
    const outroOwned = outroMarker != null
    const shownEnd = endBound ?? outroMarker

    const onMarkerPointerDown = (which: MarkerKind) => (e: React.PointerEvent) => {
        const video = videoRef.current
        if (!video || !isFinite(duration) || duration <= 0) return
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        // Grabbing the outro marker seeds a user end bound at its current
        // position — but the seed lives in the DRAG STATE (`value` below is
        // already the cut point), not in the caller's trim: writing it here
        // as well as at release would push two history entries for one
        // gesture. A click without movement releases with `value` still at
        // the cut point, so it commits exactly the intended bound.
        // A coincident stack cannot contain the OUTRO marker: the default is
        // only composed while the cut clears the start by more than
        // FREEZE_EPS (0.02 s), which is wider than COINCIDENT_EPS. Should
        // that ever change, "pending" still does the right thing — the seed
        // materialises only if the gesture resolves as an end edit, and a
        // leftward one commits the start bound alone.
        const coincident =
            startBound != null &&
            shownEnd != null &&
            Math.abs(shownEnd - startBound) <= COINCIDENT_EPS
        const wasPlaying = !video.paused
        video.pause()
        setDrag({
            which: coincident ? "pending" : which,
            grabX: e.clientX,
            value: which === "end" ? shownEnd! : startBound!,
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
        // The ONE write of the gesture, seeded outro grabs included: a click
        // without movement releases with the grab value untouched, a drag
        // with the value it ended on, and a still-"pending" release wrote
        // nothing to begin with so there is nothing to undo.
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
    const ready = width >= minWidth && isFinite(duration) && duration > 0
    // Handles need room to be grabbed; the band alone survives below that
    const markersInteractive = width >= markerMinWidth
    // While dragging, the dragged marker renders at the uncommitted value
    const dispStart = drag?.which === "start" ? drag.value : startBound
    const dispEnd = drag?.which === "end" ? drag.value : shownEnd
    // The band is the USER's range and appears only with a user bound in it —
    // an outro default is not a trim, and painting every TikTok's rail blue
    // would say it is. Its extent is the EFFECTIVE range, so a user start
    // runs to the cyan marker.
    const userEnd = drag?.which === "end" ? drag.value : endBound
    const showBand = dispStart != null || userEnd != null
    const pct = (t: number) => `${(Math.min(t, duration) / duration) * 100}%`

    const marker = (which: MarkerKind, value: number, outro = false) => {
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
                <div className={cn(
                    "w-1.5 h-4 rounded-sm border border-white/90 shadow-sm",
                    outro ? "bg-cyan-400" : "bg-blue-400",
                )} />
                {showBubble && (
                    <TimeBubble>
                        {formatTime(value, true)}
                        {/* The outro marker owns no bound, so there is
                            nothing to clear — the toggle button is how that
                            end goes away */}
                        {!outro && (
                            <button
                                title={`Clear loop ${which}`}
                                className="hover:text-red-400"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={() => clearBound(which)}
                            >
                                <X className="w-3 h-3" />
                            </button>
                        )}
                    </TimeBubble>
                )}
            </div>
        )
    }

    return (
        <div ref={rootRef} className={cn("select-none", className)}>
            {ready && (
                <div
                    className="absolute inset-x-0 bottom-0 h-7 flex items-center cursor-pointer touch-none"
                    onPointerDown={onTrackPointerDown}
                    onPointerMove={onTrackPointerMove}
                    onPointerUp={onTrackPointerUp}
                    onPointerLeave={() => setHoverTime(null)}
                >
                    <div
                        ref={trackRef}
                        className={cn(
                            "relative w-full h-1.5 rounded-full",
                            // Nothing may STACK here: alpha over alpha only
                            // darkens, so a white/40 head painted over a
                            // white/20 track composites to ~white/52 and the
                            // head stops matching every other rail. With the
                            // outro tail dimmed the track carries no fill of
                            // its own and the two segments below are siblings,
                            // each at exactly its own weight.
                            outroOwned ? "bg-transparent" : "bg-white/40",
                        )}
                    >
                        {outroMarker != null && (
                            <>
                                <div
                                    className="absolute inset-y-0 left-0 rounded-full bg-white/40"
                                    style={{ right: `calc(100% - ${pct(outroMarker)})` }}
                                />
                                <div
                                    className="absolute inset-y-0 right-0 rounded-full bg-white/20"
                                    style={{ left: pct(outroMarker) }}
                                />
                            </>
                        )}
                        {showBand && (
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
                        {markersInteractive && dispStart != null && marker("start", dispStart)}
                        {markersInteractive && dispEnd != null && marker("end", dispEnd, outroOwned)}
                    </div>
                </div>
            )}
        </div>
    )
}
