import React from "react"
import {
    Brackets,
    EllipsisVertical,
    Maximize,
    Minimize,
    Pause,
    Play,
    TvMinimalPlay,
    Volume1,
    Volume2,
    VolumeOff,
    X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { TrimRange } from "@/lib/pinboardCrop"
import { useVideoPlayerState } from "@/lib/videoPlayerState"
import { useIdleHide, usePrefersReducedMotion } from "@/lib/useIdleHide"
import { useElementFullscreen } from "@/lib/useElementFullscreen"
import { MARKER_MIN_WIDTH, RAIL_MIN_WIDTH, VideoRail, formatTime } from "./VideoRail"

// The S1 player surface: scrim + button row + rail + popovers, one unit that
// appears and hides together (docs/video-player-ui-design.md).
//
// INVARIANTS
// - No white circles and no opaque boxes: flat white glyphs over the scrim,
//   in the rail's own visual language (white/40 track, blue-400 accents,
//   black/80 bubbles). S0's circle buttons are a different system.
// - Popovers are plain absolutely-positioned children, never portalled:
//   content portalled to document.body renders OUTSIDE the fullscreen
//   element and would be invisible in fullscreen.
// - The root swallows pointer AND click events. Hosts wrap the video in
//   click-to-navigate halves and react-grid-layout drag handles; a
//   synthesized click still bubbles after the pointer handlers stopped
//   propagating, and would navigate away mid-gesture.
// - Every hide rule lives in the controller's hold set, never in the
//   component: the surface reports state, useIdleHide decides.

const FRAME_STEP = 1 / 30

export type VideoPlayerSize = "full" | "medium" | "mini"

// Container widths (px) at which the ladder steps; hosts that measure a pin
// resolve their tier through playerSizeForWidth. Pins can equally drive the
// tier from container queries — the prop is the contract, not the mechanism.
export const PLAYER_SIZE_MEDIUM_WIDTH = 160
export const PLAYER_SIZE_FULL_WIDTH = 280

export function playerSizeForWidth(width: number): VideoPlayerSize {
    if (width >= PLAYER_SIZE_FULL_WIDTH) return "full"
    if (width >= PLAYER_SIZE_MEDIUM_WIDTH) return "medium"
    return "mini"
}

type HoldKey = "pointer" | "gesture" | "menu"

export interface VideoPlayerSurfaceController {
    // Fade state of the whole surface
    visible: boolean
    // Spread on the element that CONTAINS the video and the surface
    containerProps: {
        onPointerEnter: () => void
        onPointerMove: () => void
        onPointerLeave: () => void
    }
    // In fullscreen the cursor hides with the UI; hosts add `cursor-none`
    cursorHidden: boolean
    isFullscreen: boolean
    fullscreenSupported: boolean
    toggleFullscreen: () => void
    // Truthful playback state read off the element (native controls and
    // useVideoTrim both drive it behind React's back)
    paused: boolean
    show: () => void
    // Written by the surface; not part of the host-facing contract
    setHold: (key: HoldKey, value: boolean) => void
}

// Host-side half of the surface: owns visibility, fullscreen and the hold
// set. Hosts spread `containerProps` on the video container and pass the
// controller to <VideoPlayerSurface />.
export function useVideoPlayerSurface({
    videoRef,
    active,
    fullscreenTargetRef,
    idleMs,
    showOnEnable,
}: {
    videoRef: React.RefObject<HTMLVideoElement | null>
    // The video is loaded (S1); false disables the whole player world
    active: boolean
    // Wrapper containing video + surface; omit to disable fullscreen
    fullscreenTargetRef?: React.RefObject<HTMLElement | null>
    idleMs?: number
    // Reveal the surface when the video loads (gallery: yes; a board of
    // autoplaying pins: no)
    showOnEnable?: boolean
}): VideoPlayerSurfaceController {
    const [holds, setHolds] = React.useState<Record<HoldKey, boolean>>({
        pointer: false,
        gesture: false,
        menu: false,
    })
    const setHold = React.useCallback((key: HoldKey, value: boolean) => {
        setHolds((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }))
    }, [])

    const [paused, setPaused] = React.useState(true)
    React.useEffect(() => {
        const video = videoRef.current
        if (!active || !video) {
            setPaused(true)
            return
        }
        const sync = () => setPaused(video.paused)
        sync()
        video.addEventListener("play", sync)
        video.addEventListener("pause", sync)
        return () => {
            video.removeEventListener("play", sync)
            video.removeEventListener("pause", sync)
        }
    }, [active, videoRef])

    const { isFullscreen, supported, toggle } = useElementFullscreen(fullscreenTargetRef)

    // A player under the pointer, mid gesture or with a menu open hides for
    // nothing. A paused one shows its state only while the pointer is on it:
    // an absolute hold would let one hover permanently pin every pin whose
    // autoplay the browser blocked.
    const holdOpen = holds.pointer || holds.gesture || holds.menu
    const { visible, containerProps, show } = useIdleHide({
        enabled: active,
        holdOpen,
        holdIdle: paused,
        idleMs,
        showOnEnable,
    })

    return {
        visible,
        containerProps,
        cursorHidden: isFullscreen && !visible,
        isFullscreen,
        fullscreenSupported: supported,
        toggleFullscreen: toggle,
        paused,
        show,
        setHold,
    }
}

function useDismissOnOutside(
    open: boolean,
    close: () => void,
    ref: React.RefObject<HTMLElement | null>,
) {
    React.useEffect(() => {
        if (!open) return
        const onPointerDown = (e: PointerEvent) => {
            const el = ref.current
            if (el && !el.contains(e.target as Node)) close()
        }
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") close()
        }
        document.addEventListener("pointerdown", onPointerDown, true)
        document.addEventListener("keydown", onKeyDown, true)
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true)
            document.removeEventListener("keydown", onKeyDown, true)
        }
    }, [open, close, ref])
}

function SurfaceButton({
    title,
    onClick,
    active,
    pressed,
    className,
    children,
}: {
    title: string
    onClick: (e: React.MouseEvent) => void
    active?: boolean
    // Toggle state for assistive tech, when it differs from the lit look
    // (the trim button also lights up merely because a trim exists)
    pressed?: boolean
    className?: string
    children: React.ReactNode
}) {
    return (
        <button
            type="button"
            title={title}
            aria-label={title}
            aria-pressed={pressed ?? active}
            onClick={onClick}
            className={cn(
                "flex shrink-0 cursor-pointer items-center justify-center rounded p-1 text-white/90",
                "transition-colors hover:bg-white/15 hover:text-white",
                "focus-visible:ring-1 focus-visible:ring-white/80 focus-visible:outline-none",
                "drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]",
                active && "bg-white/20 text-white",
                className,
            )}
        >
            {children}
        </button>
    )
}

// Same visual family as the rail's TimeBubble, one size up. Like TimeBubble
// the gap to the button is padding on an outer wrapper, never a margin: a
// margin gap is a dead band outside the hover hit box, and slow pointer
// travel across it fires pointerleave and unmounts the popover mid-reach.
function SurfacePopover({
    placement,
    role,
    className,
    children,
}: {
    placement: "above" | "below"
    role?: string
    className?: string
    children: React.ReactNode
}) {
    return (
        <div
            className={cn(
                "absolute right-0 z-10",
                placement === "above" ? "bottom-full pb-1.5" : "top-full pt-1.5",
            )}
        >
            <div
                role={role}
                className={cn(
                    "rounded bg-black/85 p-1 text-white shadow-lg ring-1 ring-white/15",
                    className,
                )}
            >
                {children}
            </div>
        </div>
    )
}

function MenuItem({
    label,
    icon,
    onClick,
}: {
    label: string
    icon: React.ReactNode
    onClick: () => void
}) {
    return (
        <button
            type="button"
            role="menuitem"
            title={label}
            onClick={onClick}
            className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-[11px] leading-5 whitespace-nowrap text-white/90 transition-colors hover:bg-white/15 hover:text-white focus-visible:ring-1 focus-visible:ring-white/80 focus-visible:outline-none"
        >
            {icon}
            {label}
        </button>
    )
}

export function VideoPlayerSurface({
    videoRef,
    videoState,
    controller,
    trim,
    onTrimChange,
    size = "full",
    className,
}: {
    videoRef: React.RefObject<HTMLVideoElement | null>
    videoState: ReturnType<typeof useVideoPlayerState>
    controller: VideoPlayerSurfaceController
    trim: TrimRange | null
    onTrimChange: (trim: TrimRange | null) => void
    size?: VideoPlayerSize
    className?: string
}) {
    const {
        visible,
        isFullscreen,
        fullscreenSupported,
        toggleFullscreen,
        paused,
        setHold,
    } = controller
    const reducedMotion = usePrefersReducedMotion()
    const rootRef = React.useRef<HTMLDivElement>(null)

    const [volumeOpen, setVolumeOpen] = React.useState(false)
    const [trimHovered, setTrimHovered] = React.useState(false)
    const [trimPinned, setTrimPinned] = React.useState(false)
    const [menuOpen, setMenuOpen] = React.useState(false)
    const [gesture, setGesture] = React.useState(false)
    // Both popovers are right-aligned above the row (the reserved slot), so
    // only one of them may occupy it
    const trimOpen = (trimHovered || trimPinned) && !menuOpen && size !== "mini"

    const closeMenu = React.useCallback(() => setMenuOpen(false), [])
    useDismissOnOutside(menuOpen, closeMenu, rootRef)
    // Escape / a click outside the surface unpins; clicks inside it (the
    // popover's own buttons, the rest of the row) do not
    const unpinTrim = React.useCallback(() => setTrimPinned(false), [])
    useDismissOnOutside(trimPinned, unpinTrim, rootRef)

    // The pinned trim popover deliberately does NOT hold: the surface governs
    // it, so it fades out with the surface on idle/leave and comes back
    // (still pinned) with it. Hover-open holds anyway — the pointer is on the
    // surface. The kebab menu is click-open and must survive a pointer that
    // wanders off.
    React.useEffect(() => {
        setHold("menu", menuOpen)
    }, [menuOpen, setHold])
    React.useEffect(() => {
        setHold("gesture", gesture)
    }, [gesture, setHold])
    // The surface can unmount mid-hover (video closed, native controls); a
    // hold left standing would pin the next surface open forever
    React.useEffect(() => () => {
        setHold("pointer", false)
        setHold("gesture", false)
        setHold("menu", false)
    }, [setHold])

    // Centiseconds are the storage resolution — show them exactly when the
    // user is placing something at that resolution
    const precise = gesture || trimOpen
    const [readout, setReadout] = React.useState("")
    React.useEffect(() => {
        if (size !== "full" || !visible) return
        let raf = 0
        const tick = () => {
            const video = videoRef.current
            if (video) {
                const duration = isFinite(video.duration) ? video.duration : 0
                const next = `${formatTime(video.currentTime, precise)} / ${formatTime(duration, precise)}`
                setReadout((prev) => (prev === next ? prev : next))
            }
            raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [size, visible, precise, videoRef])

    // Set one trim bound to the video's current time (centisecond-rounded, the
    // URL resolution); `clear` (shift-click at the buttons) clears the bound
    // instead. Placing a bound on the wrong side of the other one clears the
    // other — the user is redefining the range. Equal bounds are allowed
    // (freeze frame).
    const setTrimPoint = (which: "start" | "end", clear: boolean) => {
        let start = trim?.start ?? null
        let end = trim?.end ?? null
        if (clear) {
            if (which === "start") start = null
            else end = null
        } else {
            const video = videoRef.current
            if (!video) return
            const t = Math.round(video.currentTime * 100) / 100
            if (which === "start") {
                start = t
                if (end != null && end < t) end = null
            } else {
                end = t
                if (start != null && start > t) start = null
            }
        }
        onTrimChange(start == null && end == null ? null : { start, end })
        // Setting the end mid-playback leaves the playhead exactly at the end
        // point, from which crossing detection would never fire — restart the
        // loop, which doubles as "here's your loop" feedback
        if (which === "end" && !clear && end != null) {
            const video = videoRef.current
            if (video && !video.paused) video.currentTime = start ?? 0
        }
    }

    const clearTrimBound = (which: "start" | "end") => {
        const start = which === "start" ? null : (trim?.start ?? null)
        const end = which === "end" ? null : (trim?.end ?? null)
        onTrimChange(start == null && end == null ? null : { start, end })
    }

    // No frame-exact web API exists; centisecond storage resolution makes
    // ~1/30 s the right step
    const stepFrame = (direction: -1 | 1) => {
        const video = videoRef.current
        if (!video) return
        videoState.setPlaying(false)
        const duration = isFinite(video.duration) ? video.duration : Infinity
        video.currentTime = Math.max(
            0,
            Math.min(duration, video.currentTime + direction * FRAME_STEP),
        )
    }

    const muted = videoState.videoIsMuted
    const volume = videoState.volume
    const volumeIcon = muted || volume === 0
        ? <VolumeOff className="size-[17px]" />
        : volume < 0.5
            ? <Volume1 className="size-[17px]" />
            : <Volume2 className="size-[17px]" />

    const trimStart = trim?.start ?? null
    const trimEnd = trim?.end ?? null
    const trimSet = trimStart != null || trimEnd != null

    // Per side, in px — must mirror the rail's mx-3/mx-2 below
    const railInset = isFullscreen ? 12 : 8

    const boundButton = (which: "start" | "end") => {
        const value = which === "start" ? trimStart : trimEnd
        const label = which === "start" ? "Set start" : "Set end"
        return (
            <div className="relative">
                <button
                    type="button"
                    title={value != null
                        ? `Loop ${which}: ${value.toFixed(2)}s — click to move here, shift-click to clear`
                        : `Set loop ${which} to current time`}
                    onClick={(e) => setTrimPoint(which, e.shiftKey)}
                    className={cn(
                        "cursor-pointer rounded px-1.5 py-1 text-[11px] leading-4 whitespace-nowrap tabular-nums transition-colors",
                        "focus-visible:ring-1 focus-visible:ring-white/80 focus-visible:outline-none",
                        value != null
                            ? "bg-blue-500/80 text-white hover:bg-blue-500"
                            : "text-white/90 hover:bg-white/15 hover:text-white",
                    )}
                >
                    {value != null ? formatTime(value, true) : label}
                </button>
                {value != null && (
                    <button
                        type="button"
                        title={`Clear loop ${which}`}
                        onClick={() => clearTrimBound(which)}
                        className="absolute -top-1 -right-1 cursor-pointer rounded-full bg-black/85 p-px text-white/80 hover:text-red-400 focus-visible:ring-1 focus-visible:ring-white/80 focus-visible:outline-none"
                    >
                        <X className="size-2.5" />
                    </button>
                )}
            </div>
        )
    }

    return (
        <div
            ref={rootRef}
            className={cn(
                "absolute inset-x-0 bottom-0 z-20 select-none",
                isFullscreen ? "pt-10" : size === "full" ? "pt-8" : "pt-6",
                reducedMotion ? "transition-none" : "transition-opacity",
                visible
                    ? "opacity-100 duration-[120ms]"
                    : "pointer-events-none opacity-0 duration-300",
                className,
            )}
            onPointerEnter={() => setHold("pointer", true)}
            onPointerLeave={() => setHold("pointer", false)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
        >
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/60 to-transparent"
            />
            <div
                className={cn(
                    "relative flex items-center gap-0.5",
                    isFullscreen ? "gap-1 px-3" : "px-1.5",
                )}
            >
                <SurfaceButton
                    title={paused ? "Play" : "Pause"}
                    onClick={() => videoState.setPlaying(paused)}
                >
                    {paused
                        ? <Play className="size-[17px] fill-current" />
                        : <Pause className="size-[17px]" />}
                </SurfaceButton>

                {size !== "mini" && (
                    <div
                        className="relative flex shrink-0 items-center"
                        onPointerEnter={() => setVolumeOpen(true)}
                        onPointerLeave={() => setVolumeOpen(false)}
                    >
                        <SurfaceButton
                            title={muted ? "Unmute" : "Mute"}
                            onClick={() => videoState.setMuted(!muted)}
                        >
                            {volumeIcon}
                        </SurfaceButton>
                        {size === "full" ? (
                            // Slides out to the right, into the row's own space
                            <div className={cn(
                                "overflow-hidden transition-all duration-200",
                                volumeOpen ? "ml-1 w-20" : "ml-0 w-0",
                            )}>
                                <input
                                    type="range"
                                    title="Volume"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    value={muted ? 0 : volume}
                                    onChange={(e) => videoState.setVolume(parseFloat(e.target.value))}
                                    // Collapsed to zero width: still in the DOM
                                    // (it animates open), never in the tab order
                                    tabIndex={volumeOpen ? 0 : -1}
                                    className="h-1 w-20 cursor-pointer accent-blue-400"
                                />
                            </div>
                        ) : volumeOpen && (
                            // No horizontal room at this tier: flyout upward.
                            // A rotated horizontal input beats the deprecated
                            // vertical slider appearance. The gap to the button
                            // is padding, so the pointer never crosses a dead
                            // band on its way up (see SurfacePopover).
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 pb-1.5">
                                <div className="flex h-24 w-7 items-center justify-center rounded bg-black/85 ring-1 ring-white/15">
                                    <input
                                        type="range"
                                        title="Volume"
                                        min={0}
                                        max={1}
                                        step={0.01}
                                        value={muted ? 0 : volume}
                                        onChange={(e) => videoState.setVolume(parseFloat(e.target.value))}
                                        className="h-1 w-20 -rotate-90 cursor-pointer accent-blue-400"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {size === "full" && (
                    <span className="ml-1 truncate px-1 text-[11px] leading-4 text-white/85 tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
                        {readout}
                    </span>
                )}

                <div className="grow" />

                <div className="relative flex shrink-0 items-center gap-0.5">
                    {size !== "mini" && (
                        <div
                            className="flex items-center"
                            onPointerEnter={() => setTrimHovered(true)}
                            onPointerLeave={() => setTrimHovered(false)}
                        >
                            <SurfaceButton
                                title={trimPinned ? "Unpin trim controls" : "Trim (loop range)"}
                                active={trimPinned || trimSet}
                                pressed={trimPinned}
                                onClick={() => setTrimPinned((v) => !v)}
                            >
                                <Brackets className="size-[17px]" />
                            </SurfaceButton>
                            {trimOpen && (
                                <SurfacePopover placement="above" className="flex items-center gap-1">
                                    {boundButton("start")}
                                    {boundButton("end")}
                                    <span className="mx-0.5 h-4 w-px bg-white/20" />
                                    <button
                                        type="button"
                                        title="Step back one frame (~1/30 s); pauses playback"
                                        onClick={() => stepFrame(-1)}
                                        className="cursor-pointer rounded px-1.5 py-1 text-[11px] leading-4 text-white/90 tabular-nums transition-colors hover:bg-white/15 hover:text-white focus-visible:ring-1 focus-visible:ring-white/80 focus-visible:outline-none"
                                    >
                                        −1f
                                    </button>
                                    <button
                                        type="button"
                                        title="Step forward one frame (~1/30 s); pauses playback"
                                        onClick={() => stepFrame(1)}
                                        className="cursor-pointer rounded px-1.5 py-1 text-[11px] leading-4 text-white/90 tabular-nums transition-colors hover:bg-white/15 hover:text-white focus-visible:ring-1 focus-visible:ring-white/80 focus-visible:outline-none"
                                    >
                                        +1f
                                    </button>
                                </SurfacePopover>
                            )}
                        </div>
                    )}

                    {size === "full" && fullscreenSupported && (
                        <SurfaceButton
                            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                            onClick={toggleFullscreen}
                        >
                            {isFullscreen
                                ? <Minimize className="size-[17px]" />
                                : <Maximize className="size-[17px]" />}
                        </SurfaceButton>
                    )}

                    <SurfaceButton
                        title="More"
                        active={menuOpen}
                        onClick={() => {
                            setMenuOpen((v) => !v)
                            setTrimPinned(false)
                        }}
                    >
                        <EllipsisVertical className="size-[17px]" />
                    </SurfaceButton>
                    {menuOpen && (
                        <SurfacePopover placement="above" role="menu" className="min-w-40">
                            {/* The mini tier has no volume and no trim button,
                                so the kebab carries both. The loop verbs leave
                                the menu open: placing both bounds is one
                                errand, and the clear items appearing is the
                                feedback. */}
                            {size === "mini" && (
                                <>
                                    <MenuItem
                                        label={muted ? "Unmute" : "Mute"}
                                        icon={muted
                                            ? <VolumeOff className="size-3.5" />
                                            : <Volume2 className="size-3.5" />}
                                        onClick={() => {
                                            videoState.setMuted(!muted)
                                            setMenuOpen(false)
                                        }}
                                    />
                                    <MenuItem
                                        label="Set loop start at playhead"
                                        icon={<Brackets className="size-3.5" />}
                                        onClick={() => setTrimPoint("start", false)}
                                    />
                                    {trimStart != null && (
                                        <MenuItem
                                            label="Clear loop start"
                                            icon={<X className="size-3.5" />}
                                            onClick={() => clearTrimBound("start")}
                                        />
                                    )}
                                    <MenuItem
                                        label="Set loop end at playhead"
                                        icon={<Brackets className="size-3.5" />}
                                        onClick={() => setTrimPoint("end", false)}
                                    />
                                    {trimEnd != null && (
                                        <MenuItem
                                            label="Clear loop end"
                                            icon={<X className="size-3.5" />}
                                            onClick={() => clearTrimBound("end")}
                                        />
                                    )}
                                </>
                            )}
                            {size !== "full" && fullscreenSupported && (
                                <MenuItem
                                    label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                                    icon={isFullscreen
                                        ? <Minimize className="size-3.5" />
                                        : <Maximize className="size-3.5" />}
                                    onClick={() => {
                                        toggleFullscreen()
                                        setMenuOpen(false)
                                    }}
                                />
                            )}
                            <MenuItem
                                label="Native controls"
                                icon={<TvMinimalPlay className="size-3.5" />}
                                onClick={() => {
                                    videoState.setControls(true)
                                    setMenuOpen(false)
                                }}
                            />
                            <MenuItem
                                label="Close video"
                                icon={<X className="size-3.5" />}
                                onClick={() => {
                                    videoState.stopVideo()
                                    setMenuOpen(false)
                                }}
                            />
                        </SurfacePopover>
                    )}
                </div>
            </div>

            <VideoRail
                videoRef={videoRef}
                trim={trim}
                onTrimChange={onTrimChange}
                active={visible}
                // The rail measures ITSELF, and it sits inset from the
                // surface; the spec's cutoffs are surface widths, so they
                // travel down pre-shrunk by the inset
                minWidth={Math.max(0, RAIL_MIN_WIDTH - 2 * railInset)}
                markerMinWidth={Math.max(0, MARKER_MIN_WIDTH - 2 * railInset)}
                onInteractingChange={setGesture}
                className={cn("relative h-7", isFullscreen ? "mx-3" : "mx-2")}
            />
        </div>
    )
}

// While native controls are active the whole surface stands down; this lone
// kebab at the video's top-right is the way back. Rendered by the host, not
// by the surface, because the surface is not mounted in that state.
export function NativeControlsEscape({
    videoState,
    className,
}: {
    videoState: ReturnType<typeof useVideoPlayerState>
    className?: string
}) {
    const [open, setOpen] = React.useState(false)
    const rootRef = React.useRef<HTMLDivElement>(null)
    const close = React.useCallback(() => setOpen(false), [])
    useDismissOnOutside(open, close, rootRef)

    return (
        <div
            ref={rootRef}
            className={cn("absolute top-2 right-2 z-20 select-none", className)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
        >
            <div className="relative">
                <SurfaceButton
                    title="More"
                    active={open}
                    onClick={() => setOpen((v) => !v)}
                    className="bg-black/50 hover:bg-black/70"
                >
                    <EllipsisVertical className="size-[17px]" />
                </SurfaceButton>
                {open && (
                    <SurfacePopover placement="below" role="menu" className="min-w-40">
                        <MenuItem
                            label="Player controls"
                            icon={<TvMinimalPlay className="size-3.5" />}
                            onClick={() => {
                                videoState.setControls(false)
                                setOpen(false)
                            }}
                        />
                        <MenuItem
                            label="Close video"
                            icon={<X className="size-3.5" />}
                            onClick={() => {
                                videoState.stopVideo()
                                setOpen(false)
                            }}
                        />
                    </SurfacePopover>
                )}
            </div>
        </div>
    )
}
