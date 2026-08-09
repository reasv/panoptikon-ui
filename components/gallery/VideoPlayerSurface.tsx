import React from "react"
import {
    Brackets,
    Download,
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
import {
    PLAYBACK_RATES,
    setOutroSkipEnabled,
    useOutroSkipEnabled,
    useVideoPlayerState,
} from "@/lib/videoPlayerState"
import { useIdleHide, usePrefersReducedMotion } from "@/lib/useIdleHide"
import { useElementFullscreen } from "@/lib/useElementFullscreen"
import { outroSkipGoverns, trimWithBound } from "@/lib/videoTrim"
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
// - The root is pointer-TRANSPARENT and only the control layers (row, rail,
//   and the popovers inside them) take events: the root spans a tall scrim
//   band whose transparent part would otherwise be a dead zone over the
//   picture, swallowing a host's drag handle and click targets. Those layers
//   swallow pointer AND click events in turn — hosts wrap the video in
//   click-to-navigate halves and react-grid-layout drag handles, and a
//   synthesized click still bubbles after the pointer handlers stopped
//   propagating, which would navigate away mid-gesture.
// - Every hide rule lives in the controller's hold set, never in the
//   component: the surface reports state, useIdleHide decides.

const FRAME_STEP = 1 / 30

// Rates are also read back off the element (the native controls' own speed
// menu is a second writer), where a stray float would print as 1.7500000000002
const formatRate = (rate: number) => String(Math.round(rate * 100) / 100)

// The outro-skip toggle's glyph, drawn here rather than taken from lucide:
// no stock icon says "this timeline ends early", and the SkipForward arrow
// this replaced read as an ordinary next-track button. The picture IS the
// feature — a solid rail, the cut, and the removed tail behind it:
//
//   ————————|  ·  ·
//
// Lucide's own drawing contract (24-unit box, 2px round-capped strokes, no
// fill) so it sits in the row as one of them, and exactly four strokes so it
// survives the 20px it renders at. The tail's dashes are faded, not just
// broken, because "removed" is the whole message.
function OutroSkipIcon({ className }: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={className}
        >
            <path d="M3 12h8" />
            <path d="M12 6v12" />
            <g opacity="0.55">
                <path d="M15.5 12h1" />
                <path d="M20 12h1" />
            </g>
        </svg>
    )
}

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
    exitFullscreen: () => void
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

    const { isFullscreen, supported, toggle, exit } = useElementFullscreen(fullscreenTargetRef)

    // Nothing may leave the user in a fullscreen box with no video in it.
    // The close verb exits before unloading, and this catches every other
    // route out of the player world (native controls, a host mode switch,
    // the item going away).
    React.useEffect(() => {
        if (!active && isFullscreen) exit()
    }, [active, isFullscreen, exit])

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
        exitFullscreen: exit,
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
    // 20px glyph + p-1 per side = a 28px hit box, and 28px IS the button
    // row's height — the pin footprint clamp in globals.css reserves the
    // surface's band from it. Changing either number changes that clamp.
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

// One class for every menu row, whatever element carries it: the download
// row must be an <a> (the `download` attribute is an anchor's, and only an
// anchor gives the browser's own "save link as" too), and a row that reads
// as a different control would break the menu's one visual family.
const MENU_ITEM_CLASS =
    "flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-[11px] leading-5 whitespace-nowrap text-white/90 transition-colors hover:bg-white/15 hover:text-white focus-visible:ring-1 focus-visible:ring-white/80 focus-visible:outline-none"

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
            className={MENU_ITEM_CLASS}
        >
            {icon}
            {label}
        </button>
    )
}

// The link-shaped menu row. Same-origin only, which the file URL is by
// construction (getFileURL returns a root-relative path): a cross-origin
// href silently loses the `download` attribute and navigates instead.
function MenuItemLink({
    label,
    icon,
    href,
    download,
    onClick,
}: {
    label: string
    icon: React.ReactNode
    href: string
    download: string
    onClick: () => void
}) {
    return (
        <a
            role="menuitem"
            title={label}
            href={href}
            download={download}
            onClick={onClick}
            // Links are draggable by default, and the pinboard's drop path
            // treats any text/plain payload as a sha256 — dragging this row
            // onto the board would mint an unresolvable pin
            draggable={false}
            // A button menuitem activates on Space; an anchor only on Enter.
            // Level the two so the row behaves like its siblings.
            onKeyDown={(e) => {
                if (e.key === " ") {
                    e.preventDefault()
                    e.currentTarget.click()
                }
            }}
            className={MENU_ITEM_CLASS}
        >
            {icon}
            {label}
        </a>
    )
}

// Playback speed as one menu ROW instead of a submenu: comparing speeds is a
// single errand, so every choice stays one click away and the menu survives
// the click — the same rule the mini tier's loop verbs follow. A rate off the
// ladder (the native speed menu can set one) lights no button, so the label
// suffix is what keeps a non-1x player honest at a glance.
function SpeedRow({
    rate,
    onRate,
}: {
    rate: number
    onRate: (rate: number) => void
}) {
    return (
        <div role="group" aria-label="Playback speed" className="px-2 py-1">
            <div className="text-[11px] leading-5 whitespace-nowrap text-white/90">
                Speed
                {rate !== 1 && (
                    <span className="tabular-nums">{` — ${formatRate(rate)}×`}</span>
                )}
            </div>
            <div className="mt-0.5 flex items-center gap-0.5">
                {PLAYBACK_RATES.map((r) => (
                    <button
                        key={r}
                        type="button"
                        role="menuitemradio"
                        aria-checked={r === rate}
                        title={`Play at ${formatRate(r)}× speed`}
                        onClick={() => onRate(r)}
                        className={cn(
                            "cursor-pointer rounded px-1 py-0.5 text-[11px] leading-4 tabular-nums transition-colors",
                            "focus-visible:ring-1 focus-visible:ring-white/80 focus-visible:outline-none",
                            r === rate
                                ? "bg-blue-500/80 text-white hover:bg-blue-500"
                                : "text-white/90 hover:bg-white/15 hover:text-white",
                        )}
                    >
                        {formatRate(r)}
                    </button>
                ))}
            </div>
        </div>
    )
}

export function VideoPlayerSurface({
    videoRef,
    videoState,
    controller,
    trim,
    onTrimChange,
    outroCutPoint = null,
    duration,
    download,
    size = "full",
    className,
}: {
    videoRef: React.RefObject<HTMLVideoElement | null>
    videoState: ReturnType<typeof useVideoPlayerState>
    controller: VideoPlayerSurfaceController
    // The USER's trim, always — the outro default never enters this prop and
    // never reaches the popover, `vt` or the h field except through a real
    // edit (docs/video-outro-skip-design.md §4)
    trim: TrimRange | null
    onTrimChange: (trim: TrimRange | null) => void
    // This item's outro cut point in seconds (lib/videoTrim's
    // `outroCutPoint`), or null when the item is not eligible — in which case
    // the toggle button does not exist at all, no disabled ghost.
    outroCutPoint?: number | null
    // The <video> element's own duration in seconds, NaN until its metadata
    // loads (lib/videoTrim's `useVideoDuration`). The HOST owns the listener
    // because the cut point above is computed from the same number — one
    // listener, one duration, so the rail's geometry and the cut it draws
    // can never come from different answers.
    duration: number
    // The original file behind this video, as a same-origin URL and the name
    // to save it under. Omitted while a host still has no item data, which
    // simply drops the row.
    download?: { url: string; filename: string }
    size?: VideoPlayerSize
    className?: string
}) {
    const {
        visible,
        isFullscreen,
        fullscreenSupported,
        toggleFullscreen,
        exitFullscreen,
        paused,
        setHold,
    } = controller
    const reducedMotion = usePrefersReducedMotion()
    const rootRef = React.useRef<HTMLDivElement>(null)

    const [volumeOpen, setVolumeOpen] = React.useState(false)
    const [trimHovered, setTrimHovered] = React.useState(false)
    const [trimPinned, setTrimPinned] = React.useState(false)
    const [menuOpen, setMenuOpen] = React.useState(false)
    const [outroHovered, setOutroHovered] = React.useState(false)
    const [gesture, setGesture] = React.useState(false)
    // Both popovers are right-aligned above the row (the reserved slot), so
    // only one of them may occupy it
    const trimOpen = (trimHovered || trimPinned) && !menuOpen && size !== "mini"
    // The outro button's explanatory bubble stands down for either popover:
    // all three open into the same band above the row
    const outroBubbleOpen = outroHovered && !menuOpen && !trimOpen && size !== "mini"
    // Anything of the surface that reaches ABOVE the button row
    const popoverOpen = trimOpen || menuOpen || volumeOpen || outroBubbleOpen

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

    // Set one trim bound to the video's current time; `clear` (shift-click at
    // the buttons) clears the bound instead. The bound-placement rule itself
    // lives in trimWithBound — the gallery's I/O keys and the pin context menu
    // are the same verb.
    const setTrimPoint = (which: "start" | "end", clear: boolean) => {
        const video = videoRef.current
        if (!clear && !video) return
        const next = trimWithBound(trim, which, clear ? null : video!.currentTime)
        onTrimChange(next)
        // Setting the end mid-playback leaves the playhead exactly at the end
        // point, from which crossing detection would never fire — restart the
        // loop, which doubles as "here's your loop" feedback
        if (which === "end" && !clear && video && !video.paused) {
            video.currentTime = next?.start ?? 0
        }
    }

    const clearTrimBound = (which: "start" | "end") => {
        onTrimChange(trimWithBound(trim, which, null))
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
        ? <VolumeOff className="size-[20px]" />
        : volume < 0.5
            ? <Volume1 className="size-[20px]" />
            : <Volume2 className="size-[20px]" />

    const trimStart = trim?.start ?? null
    const trimEnd = trim?.end ?? null
    const trimSet = trimStart != null || trimEnd != null

    // Outro skip (docs/video-outro-skip-design.md §3). The preference is
    // browser-global and read here as well as at the host, so the button and
    // the playback it describes can never disagree.
    const outroSkip = useOutroSkipEnabled()
    const outroGoverns = outroSkipGoverns(trim, outroCutPoint, outroSkip)
    // PRECEDENCE: the preference outranks the override. With skip off there
    // is nothing for a trim end to override — the button is off, full stop,
    // and calling it "overridden" (let alone dimming it as inert) would name
    // the wrong reason for the wrong state. Only with skip ON does a user
    // END bound outrank the default; a start alone never does.
    const outroOverridden = outroSkip && trimEnd != null
    const outroBubble = !outroSkip
        ? "TikTok end card detected. Click to skip it during playback."
        : outroOverridden
            ? "Manual trim end overrides outro skip."
            : outroGoverns
                ? "TikTok end card detected — skipped during playback. Click to disable."
                // Skip is on and no user end outranks it, so the only thing
                // suppressing it is the degenerate-range guard (§1): a loop
                // start at, past, or within a freeze frame of the cut
                : "Loop start sits at the detected end card, so outro skip does not apply here."

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

    // Every control layer carries the same contract: it is the only thing on
    // the surface that takes pointer events (and only while the surface is
    // up — an invisible surface must not eat a click), it raises the pointer
    // hold, and it stops the events the host would otherwise act on. Both
    // layers hold: travel between row and rail crosses a leave/enter pair,
    // which only restarts the idle timer — `visible` stays true and the
    // container's own leave (the sole immediate-hide path) never fires.
    const layer = (className?: string) => ({
        className: cn(className, visible && "pointer-events-auto"),
        onPointerEnter: () => setHold("pointer", true),
        onPointerLeave: () => setHold("pointer", false),
        onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
        onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
        onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
    })

    return (
        <div
            ref={rootRef}
            className={cn(
                "pointer-events-none absolute inset-x-0 bottom-0 select-none",
                // An open popover outranks the host's own corner verbs for as
                // long as it is open: it is transient and user-invoked, and it
                // opens into the band a host may have parked a button in
                popoverOpen ? "z-30" : "z-20",
                isFullscreen ? "pt-10" : size === "full" ? "pt-8" : "pt-6",
                reducedMotion ? "transition-none" : "transition-opacity",
                visible ? "opacity-100 duration-[120ms]" : "opacity-0 duration-300",
                className,
            )}
        >
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/60 to-transparent"
            />
            <div
                {...layer(cn(
                    "relative flex items-center gap-0.5",
                    isFullscreen ? "gap-1 px-3" : "px-1.5",
                ))}
            >
                <SurfaceButton
                    title={paused ? "Play" : "Pause"}
                    onClick={() => videoState.setPlaying(paused)}
                >
                    {paused
                        ? <Play className="size-[20px] fill-current" />
                        : <Pause className="size-[20px]" />}
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
                    {/* Trim-adjacent in meaning, so it sits immediately left
                        of the trim button and follows the same size ladder.
                        Exists ONLY on an eligible item; dimmed-but-clickable
                        while a user end bound outranks it, because the click
                        still flips the browser-wide preference. */}
                    {size !== "mini" && outroCutPoint != null && (
                        <div
                            className="flex items-center"
                            onPointerEnter={() => setOutroHovered(true)}
                            onPointerLeave={() => setOutroHovered(false)}
                        >
                            <SurfaceButton
                                // Short, because the hover bubble carries the
                                // explanation — a sentence here would open a
                                // second, native tooltip on top of it
                                title={!outroSkip
                                    ? "Outro skip off"
                                    : outroOverridden
                                        ? "Outro skip (overridden by the trim end)"
                                        : "Outro skip on"}
                                pressed={outroSkip}
                                onClick={() => setOutroSkipEnabled(!outroSkip)}
                                className={cn(
                                    // ONE drop-shadow utility carrying both
                                    // filters: twMerge keeps a single
                                    // drop-shadow-* per element, so a second
                                    // class would REPLACE the base's dark
                                    // legibility shadow instead of adding the
                                    // glow to it
                                    outroGoverns
                                        && "text-cyan-400 drop-shadow-[0_1px_2px_rgba(0,0,0,0.7),0_0_5px_rgba(34,211,238,0.85)] hover:text-cyan-300",
                                    // The hover colour has to be restated:
                                    // the base sets hover:text-white, and an
                                    // inert button that lights up under the
                                    // pointer reads as live
                                    outroOverridden && "text-white/40 hover:text-white/40",
                                )}
                            >
                                <OutroSkipIcon className="size-[20px]" />
                            </SurfaceButton>
                        </div>
                    )}
                    {outroBubbleOpen && outroCutPoint != null && (
                        // The rail's own bubble language (black/80), but
                        // wrapping: this one is a sentence. Anchored to the
                        // right GROUP rather than to the button, so it grows
                        // leftward from the row's own right edge instead of
                        // from ~3 buttons in, and capped to fit the narrowest
                        // surface that renders it (medium tier: 160 px, less
                        // the row's 12 px of padding) — it may never reach
                        // past the player's left edge.
                        <div className="pointer-events-none absolute right-0 bottom-full z-10 pb-1.5">
                            <div className={cn(
                                "rounded bg-black/80 px-1.5 py-1 text-[10px] leading-4 text-white",
                                size === "full" ? "w-44" : "w-36",
                            )}>
                                {outroBubble}
                            </div>
                        </div>
                    )}

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
                                <Brackets className="size-[20px]" />
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
                                ? <Minimize className="size-[20px]" />
                                : <Maximize className="size-[20px]" />}
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
                        <EllipsisVertical className="size-[20px]" />
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
                            <SpeedRow
                                rate={videoState.playbackRate}
                                onRate={videoState.setPlaybackRate}
                            />
                            {/* Item verbs before mode verbs: this one acts on
                                the file, the two below act on the player.
                                One-shot, so it closes the menu — unlike the
                                speed strip above it. */}
                            {download && (
                                <MenuItemLink
                                    label="Download original"
                                    icon={<Download className="size-3.5" />}
                                    href={download.url}
                                    download={download.filename}
                                    onClick={() => setMenuOpen(false)}
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
                                    // Unloading the video while fullscreen
                                    // would leave an empty black screen with
                                    // nothing in it to press
                                    if (isFullscreen) exitFullscreen()
                                    videoState.stopVideo()
                                    setMenuOpen(false)
                                }}
                            />
                        </SurfacePopover>
                    )}
                </div>
            </div>

            {/* The inset lives on the layer, not on the rail, so the
                interactive box is exactly the rail and the gutters beside it
                stay pointer-transparent like the rest of the root */}
            <div {...layer(isFullscreen ? "mx-3" : "mx-2")}>
                <VideoRail
                    videoRef={videoRef}
                    duration={duration}
                    trim={trim}
                    onTrimChange={onTrimChange}
                    // Only while the default actually governs: the rail draws
                    // the cyan marker unconditionally from this value
                    outroEnd={outroGoverns ? outroCutPoint : null}
                    active={visible}
                    // The rail measures ITSELF, and it sits inset from the
                    // surface; the spec's cutoffs are surface widths, so they
                    // travel down pre-shrunk by the inset
                    minWidth={Math.max(0, RAIL_MIN_WIDTH - 2 * railInset)}
                    markerMinWidth={Math.max(0, MARKER_MIN_WIDTH - 2 * railInset)}
                    onInteractingChange={setGesture}
                    className="relative h-7"
                />
            </div>
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
            className={cn(
                "absolute top-2 right-2 select-none",
                // Its menu opens into whatever the host parks below it; while
                // open it outranks those verbs, like the surface's popovers
                open ? "z-30" : "z-20",
                className,
            )}
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
                    <EllipsisVertical className="size-[20px]" />
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
