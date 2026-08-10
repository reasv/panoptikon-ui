import React from "react"
import {
    ArrowRightToLine,
    Brackets,
    Check,
    ChevronDown,
    ClipboardCopy,
    Download,
    EllipsisVertical,
    ListVideo,
    LoaderCircle,
    Maximize,
    Minimize,
    Pause,
    Play,
    Repeat1,
    Scissors,
    TvMinimalPlay,
    Volume1,
    Volume2,
    VolumeOff,
    X,
    type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { TrimRange } from "@/lib/pinboardCrop"
import { type ClipRequest, clipRows, exportClip, useClipBusy, webVersionRow } from "@/lib/videoClip"
import { useCopyDelivery } from "@/lib/state/copyDelivery"
import { useArtifactDelivery } from "@/hooks/artifactShare"
import { useFileShare } from "@/hooks/fileShare"
import { PLAYBACK_PRESET, useTranscodeState } from "@/lib/videoTranscode"
import { useVideoPresets } from "@/lib/useVideoPresets"
import {
    GALLERY_END_ACTIONS,
    GalleryEndAction,
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

// The end-action cycle button's three faces (docs/video-end-action-design.md
// §5). One record per mode so the glyph and the label can never drift apart,
// and stock lucide glyphs because the row's language is stock: `Repeat1`
// (field-corrected from plain `Repeat` — players universally badge loop-ONE
// with the 1, and here the contrast that badge draws is with auto-advance),
// `ArrowRightToLine` (runs to the wall and stops) and `ListVideo` (play through
// the list; `SkipForward` reads as a next-track ACTION, not a mode).
//
// Each title names the current state AND what a click does, because a
// three-state cycle cannot announce itself through pressed/unpressed. The
// "click:" half is GALLERY_END_ACTIONS' own successor — keep the two in step if
// that array ever grows.
const END_ACTION_FACES: Record<GalleryEndAction, { Icon: LucideIcon; title: string }> = {
    loop: { Icon: Repeat1, title: "Loop this video — click: play once" },
    stop: { Icon: ArrowRightToLine, title: "Play once, stop at the end — click: auto-advance" },
    advance: { Icon: ListVideo, title: "Auto-advance to the next video — click: loop" },
}

export type VideoPlayerSize = "full" | "medium" | "mini"

// Container widths (px) at which the ladder steps; hosts that measure a pin
// resolve their tier through playerSizeForWidth. Pins can equally drive the
// tier from container queries — the prop is the contract, not the mechanism.
export const PLAYER_SIZE_MEDIUM_WIDTH = 160
export const PLAYER_SIZE_FULL_WIDTH = 280

// What the GALLERY floors its surface width to. PLAYER_SIZE_FULL_WIDTH is
// "the width the full control row needs" — for the row a PIN renders. The
// gallery's row carries one button pins never do (the end-action cycle), so
// at exactly 280 its readout is the only shrinkable item and ellipsizes on
// every portrait video in a short panel. One button (28) + one gap (2) more
// keeps the clock whole; the shared tier constant must NOT rise instead,
// because that would demote 280–310 px pins to medium for a button they
// don't have.
export const GALLERY_SURFACE_FLOOR = PLAYER_SIZE_FULL_WIDTH + 30

export function playerSizeForWidth(width: number): VideoPlayerSize {
    if (width >= PLAYER_SIZE_FULL_WIDTH) return "full"
    if (width >= PLAYER_SIZE_MEDIUM_WIDTH) return "medium"
    return "mini"
}

// "download" is the download control's own menu, and it is a separate key
// from "menu" on purpose: that control is mounted by the HOST as a sibling of
// the surface, so both would be writing one boolean from two effects in one
// commit and the loser's close would clear the winner's hold.
type HoldKey = "pointer" | "gesture" | "menu" | "download"

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
        download: false,
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
    const holdOpen = holds.pointer || holds.gesture || holds.menu || holds.download
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

// 20px glyph + p-1 per side = a 28px hit box, and 28px IS the button row's
// height — the pin footprint clamp in globals.css reserves the surface's band
// from it. Changing either number changes that clamp.
//
// A const rather than SurfaceButton's private business because the download
// control's primary half must be an <a download> (the attribute is an
// anchor's), and a row-mate that did not wear this exact look would read as a
// different control.
const SURFACE_BUTTON_CLASS =
    "flex shrink-0 cursor-pointer items-center justify-center rounded p-1 text-white/90"
    + " transition-colors hover:bg-white/15 hover:text-white"
    + " focus-visible:ring-1 focus-visible:ring-white/80 focus-visible:outline-none"
    + " drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]"

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
    // (the trim button also lights up merely because a trim exists).
    // Explicit `null` means "not a toggle at all" — omit aria-pressed, for the
    // cycle buttons whose state is a ladder rather than on/off. Undefined keeps
    // the original behaviour (follow the lit look), so no existing caller's
    // markup moves.
    pressed?: boolean | null
    className?: string
    children: React.ReactNode
}) {
    return (
        <button
            type="button"
            title={title}
            aria-label={title}
            aria-pressed={pressed === null ? undefined : (pressed ?? active)}
            onClick={onClick}
            className={cn(
                SURFACE_BUTTON_CLASS,
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
    disabled,
    title,
    checked,
}: {
    label: string
    icon: React.ReactNode
    onClick: () => void
    // Only for a row whose verb is genuinely in flight (a clip export already
    // running for this item). NOT for a row that is merely unavailable —
    // those are hidden, per the house rule.
    disabled?: boolean
    // Overrides the tooltip, for a row that has something to say beyond its
    // own label (why it is disabled)
    title?: string
    // A row that carries STATE rather than firing a one-shot verb: the pair
    // announces the state to assistive tech, which a plain `menuitem` with a
    // check drawn in its icon slot cannot. Absent — every existing row —
    // leaves the markup exactly as it was.
    checked?: boolean
}) {
    return (
        <button
            type="button"
            role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={checked}
            title={title ?? label}
            onClick={onClick}
            disabled={disabled}
            className={cn(
                MENU_ITEM_CLASS,
                disabled && "cursor-default text-white/40 hover:bg-transparent hover:text-white/40",
            )}
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
    endAction,
    onEndActionChange,
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
    // What playback does at the end (docs/video-end-action-design.md §5), and
    // the verb that cycles it. GALLERY-ONLY BY CONSTRUCTION: the pair is the
    // whole gate — without both, no button exists, the same existence pattern
    // as `outroCutPoint` and `download`. The pinboard passes neither and is
    // untouched, because pins are an arrangement, not a sequence: "advance"
    // names nothing there, and a board of parallel players has no use for
    // play-once either. The surface never owns the value; the mode is a
    // browser-level preference several components in the gallery tree read in
    // the same commit, so it is passed in rather than read here.
    endAction?: GalleryEndAction
    onEndActionChange?: (next: GalleryEndAction) => void
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

    // The end action's button exists only where a host asked for it (both
    // props), so this stays null on the board.
    const endActionFace = endAction != null ? END_ACTION_FACES[endAction] : null
    // The cycle order IS GALLERY_END_ACTIONS' order, stepped by index rather
    // than re-listed here: that array is the store's canonical order (its
    // parser derives validity from it too), and a second hand-written list is
    // exactly how a mode added there would end up unreachable from the button.
    const cycleEndAction = () => {
        if (endAction == null || onEndActionChange == null) return
        const next = (GALLERY_END_ACTIONS.indexOf(endAction) + 1) % GALLERY_END_ACTIONS.length
        onEndActionChange(GALLERY_END_ACTIONS[next])
    }

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
                    {/* Leftmost of the group, so the row reads left to right as
                        "what happens at the end → where the end is → edit the
                        range". FULL tier only, one rung stricter than the trim
                        button's ladder: at medium (160–280 px) the row's
                        shrink-0 children already need ~192 px with an outro
                        button present, and a fifth button pushes the overflow
                        onto the kebab — the tier's only route to fullscreen
                        and close. The mode still governs playback at the
                        smaller tiers; the control is just not worth the verbs
                        it would clip. No kebab fallback row either — the
                        gallery only reaches those tiers in degenerate
                        layouts. */}
                    {size === "full" && endActionFace && onEndActionChange && (
                        <SurfaceButton
                            title={endActionFace.title}
                            // Lit for anything but the default: the glow means
                            // "this player will do something other than repeat
                            // when it gets to the end".
                            active={endAction !== "loop"}
                            // A CYCLE, not a toggle. Three states have no
                            // pressed/unpressed to report, and aria-pressed
                            // would announce a two-state control that does not
                            // exist — the title carries both the state and the
                            // next one instead.
                            pressed={null}
                            onClick={cycleEndAction}
                        >
                            <endActionFace.Icon className="size-[20px]" />
                        </SurfaceButton>
                    )}

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
                        // from several buttons in, and capped to fit the narrowest
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
                                speed strip above it.

                                Stays a DOWNLOAD in copy mode: the surface is
                                given a url and a filename and no item identity
                                at all (no sha256, no clip target — those live
                                on VideoDownloadControl), and a copy needs the
                                hash to resolve a path and a size. This is the
                                mini tier's only file row, and a download that
                                always works beats a copy this component has no
                                way to make. */}
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

/**
 * What the download control needs to offer a clip of the item under it. Null
 * on a host that has no item data yet — which drops the chevron and leaves
 * the plain download button, the control's whole pre-transcode behaviour.
 */
export type VideoClipTarget = {
    /** The FULL hash: the pinboard's own records carry a 10-char prefix. */
    sha256: string
    dbs: { index_db: string | null; user_data_db: string | null }
    /**
     * The item's recorded duration, in seconds — what an UNTRIMMED row would
     * encode. The animated-image rows are offered only inside the server's
     * length cap, and this is the only way to know that without a trim (see
     * lib/videoClip's `clipRows`).
     */
    duration: number | null | undefined
    /**
     * `clipRequestFor(trim, effectiveTrim, outroGoverns)` — computed by the
     * host, which is the only place all three inputs exist. Null means the
     * player is showing the whole file (or a freeze-frame trim, which is the
     * same thing for export purposes), so the rows offer a re-encode.
     */
    request: ClipRequest | null
}

/**
 * The picture's top-right download verb: a split button whose primary half is
 * the original file and whose chevron opens the transcode rows
 * (docs/video-transcoding-implementation.md §3 U3).
 *
 * A SIBLING of the surface rather than part of it. The surface owns the
 * bottom band; this owns a corner, and hosts anchor it to the displayed
 * picture the way they anchor the native-controls escape kebab — inside the
 * fullscreen element, so it survives element fullscreen, and non-portalled
 * for the same reason every popover here is.
 *
 * The chevron is HIDDEN, never disabled, when there is nothing behind it: no
 * capability, no clip presets in this policy's table, no resolved item, or a
 * surface too narrow to spend the width on. What is left is exactly the
 * one-click download the app had before any of this.
 */
export function VideoDownloadControl({
    controller,
    download,
    clip,
    size = "full",
    className,
}: {
    controller: VideoPlayerSurfaceController
    // The original file: a same-origin URL and the name to save it under.
    // This is the ONE name the client still derives (§3 U6) — every transcode
    // row takes the server's `ArtifactRef.filename` instead.
    download: { url: string; filename: string }
    clip: VideoClipTarget | null
    size?: VideoPlayerSize
    className?: string
}) {
    const { visible, setHold } = controller
    const [open, setOpen] = React.useState(false)
    const rootRef = React.useRef<HTMLDivElement>(null)
    const close = React.useCallback(() => setOpen(false), [])
    useDismissOnOutside(open, close, rootRef)

    const { presets, limits } = useVideoPresets("clip")
    const busy = useClipBusy(clip?.sha256)
    // The rows, derived once: the length cap can empty a table that is not
    // empty, so the chevron is gated on what the menu would actually contain
    // rather than on how many presets the policy offers.
    const rows = clipRows(presets, {
        request: clip?.request ?? null,
        duration: clip?.duration,
        limits,
    })
    // The already-encoded playable rendition of a needs-transcode item. On
    // this surface the store reads `done` whenever such an item is showing at
    // all (the host's showVideo requires the artifact URL), so the row is
    // there exactly when the menu is — see webVersionRow for the full rule.
    const { presets: playbackPresets } = useVideoPresets("playback")
    const playbackState = useTranscodeState(clip?.sha256, PLAYBACK_PRESET)
    const webRow = clip ? webVersionRow(playbackPresets, playbackState) : null

    // "Copy, don't download" (lib/state/copyDelivery.ts). The store is global,
    // so this control obeys a toggle flipped in a pin's context menu and vice
    // versa — which is the whole reason it is a preference rather than a
    // per-menu flag.
    const copyInstead = useCopyDelivery((state) => state.copyInstead)
    const setCopyInstead = useCopyDelivery((state) => state.setCopyInstead)
    // The transcode rows' delivery seam. NULL means no copy route exists here
    // (no relay copy feature, and a policy with backend-open disabled, or a
    // client config still in flight), so `delivery != null` IS the availability
    // gate — useArtifactDelivery returns null on exactly the useCopyAvailability
    // answer the toggle would need, and asking that question twice in one
    // component would only invite the reader to wonder how the two differ.
    const delivery = useArtifactDelivery()
    const copyAvailable = delivery != null
    // The ORIGINAL file's copy verb. Called unconditionally — the hook reads
    // nothing from `sha256` at render time (it resolves the item lazily, on
    // invocation), so an empty hash is inert here; `copyMode` requires `clip`,
    // and `execute` is NEVER invoked outside it.
    const share = useFileShare({ sha256: clip?.sha256 ?? "", filename: download.filename })
    // `share.busy` keeps the copy branch alive even if availability drops
    // mid-transfer (relay unpairs, config invalidates): the spinner and its
    // disabled state must outlive the gate, or a download link would surface
    // under the pointer while the copy is still running.
    const copyMode = (copyInstead && delivery != null && clip != null) || share.busy
    // Undefined is `exportClip`'s download mode: the presence of a deliverer IS
    // the mode there, so there is no verb flag to keep in step with this one.
    // No `delivery.busy` merge on the rows below: `exportClip` awaits the
    // deliverer INSIDE its per-item guard, so the delivery window is already a
    // busy window — a second flag could only ever agree with the first.
    const deliver = copyMode && delivery ? delivery.deliver : undefined

    // The mini tier's picture is barely wider than this control; the kebab's
    // own "Download original" row is what serves it, and the host keeps that
    // row at every tier precisely so this one may vanish.
    //
    // `copyAvailable` joins the row count because the menu is the toggle row's
    // only home: an item whose policy offers no clip preset would otherwise
    // have a primary button that copies and nowhere to turn that off.
    const canClip = clip != null
        && (rows.length > 0 || webRow != null || copyAvailable)
        && size !== "mini"

    // Click-open, so it must survive a pointer that wanders off the surface —
    // and it holds under its own key, because the surface's kebab is a second
    // writer on "menu" (see HoldKey).
    React.useEffect(() => {
        setHold("download", open)
    }, [open, setHold])
    // The control can unmount mid-hover or with its menu open (the video
    // closes, the host switches to native controls); a hold left standing
    // would pin the next surface open forever.
    React.useEffect(() => () => {
        setHold("download", false)
        setHold("pointer", false)
    }, [setHold])
    // Nothing behind the chevron any more (the item went away, the policy
    // changed) must not leave an open menu of rows that no longer exist.
    React.useEffect(() => {
        if (!canClip) setOpen(false)
    }, [canClip])

    return (
        <div
            ref={rootRef}
            className={cn(
                "absolute top-2 right-2 select-none",
                // An open menu outranks whatever the host parks below it, like
                // the surface's own popovers
                open ? "z-30" : "z-20",
                "transition-opacity",
                visible
                    ? "pointer-events-auto opacity-100 duration-[120ms]"
                    : "pointer-events-none opacity-0 duration-300",
                className,
            )}
            // Hosts wrap the video in click-to-navigate halves and grid drag
            // handles, and a synthesized click still bubbles after the pointer
            // handlers stopped propagating
            onPointerEnter={() => setHold("pointer", true)}
            onPointerLeave={() => setHold("pointer", false)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
        >
            <div className="relative flex items-center">
                {copyMode ? (
                    // A <button>, never the <a> below: there is no href for
                    // "put this file on the clipboard", and an anchor the
                    // browser could still save (middle-click, "save link as")
                    // would hand out the very download the mode replaces. The
                    // glyph is the adaptive share button's own (ClipboardCopy /
                    // a spinning LoaderCircle — components/imageButtons.tsx), so
                    // one verb has one picture everywhere.
                    <button
                        type="button"
                        title={share.busy ? "Copying…" : "Copy the original file"}
                        aria-label={share.busy ? "Copying…" : "Copy the original file"}
                        aria-busy={share.busy}
                        // A copy can spend minutes materializing a multi-GB
                        // file; a second click would start a whole second one.
                        disabled={share.busy}
                        onClick={() => void share.execute()}
                        className={cn(
                            SURFACE_BUTTON_CLASS,
                            "bg-black/30 hover:bg-black/50",
                            canClip && "rounded-r-none",
                            share.busy
                            && "cursor-default text-white/40 hover:bg-black/30 hover:text-white/40",
                        )}
                    >
                        {share.busy
                            ? <LoaderCircle className="size-[20px] animate-spin" />
                            : <ClipboardCopy className="size-[20px]" />}
                    </button>
                ) : (
                    <a
                        title="Download the original file"
                        aria-label="Download the original file"
                        href={download.url}
                        download={download.filename}
                        // Links are draggable by default, and the pinboard's drop
                        // path reads any text/plain payload as a sha256 — dragging
                        // this onto the board would mint an unresolvable pin
                        draggable={false}
                        className={cn(
                            SURFACE_BUTTON_CLASS,
                            // The corner floats over the raw picture with no
                            // scrim, so a bare glyph vanishes on bright video; a
                            // light backing, not the bottom row's transparency.
                            "bg-black/30 hover:bg-black/50",
                            canClip && "rounded-r-none",
                        )}
                    >
                        <Download className="size-[20px]" />
                    </a>
                )}
                {canClip && (
                    // The narrower flush half of one split button: same 28px
                    // height as the primary, joined edge unrounded on both
                    // sides so the hover highlights meet as halves of a whole.
                    <SurfaceButton
                        title="Other download formats"
                        active={open}
                        onClick={() => setOpen((v) => !v)}
                        className={cn(
                            "rounded-l-none bg-black/30 px-0.5 hover:bg-black/50",
                            // className outranks SurfaceButton's active wash,
                            // so the open state must carry its own lit look
                            open && "bg-black/50",
                        )}
                    >
                        <ChevronDown className="size-[20px]" />
                    </SurfaceButton>
                )}
                {open && canClip && clip && (
                    <SurfacePopover placement="below" role="menu" className="min-w-44">
                        {/* The file itself first: it is the row the primary
                            button already is, spelled out so the menu is a
                            complete answer to "download this" rather than a
                            list of the alternatives. Which means it follows the
                            primary into copy mode — the row and the button it
                            names cannot be two different verbs. */}
                        {copyMode ? (
                            <MenuItem
                                label="Original file"
                                icon={<ClipboardCopy className="size-3.5" />}
                                disabled={share.busy}
                                title={share.busy
                                    ? "Copying…"
                                    : "Copy the original file"}
                                onClick={() => {
                                    close()
                                    void share.execute()
                                }}
                            />
                        ) : (
                            <MenuItemLink
                                label="Original file"
                                icon={<Download className="size-3.5" />}
                                href={download.url}
                                download={download.filename}
                                onClick={close}
                            />
                        )}
                        {/* Above the divider with Original: this row too is a
                            file that already exists (the playback rendition),
                            not work to be started. A button all the same —
                            the artifact can be evicted, and the re-POST it
                            runs through is a hit or a self-heal, never a 404
                            saved as an .mp4 (see webVersionRow). */}
                        {webRow && (
                            <MenuItem
                                label={webRow.label}
                                icon={<Download className="size-3.5" />}
                                disabled={busy}
                                title={busy
                                    ? "Another export of this item is still running"
                                    : "The playable copy this video was encoded into"}
                                onClick={() => {
                                    close()
                                    void exportClip({
                                        sha256: clip.sha256,
                                        preset: webRow.preset,
                                        request: null,
                                        rowLabel: webRow.label,
                                        dbs: clip.dbs,
                                        deliver,
                                    })
                                }}
                            />
                        )}
                        {rows.length > 0 && (
                            <div aria-hidden className="my-1 h-px bg-white/15" />
                        )}
                        {/* Buttons, never links: these rows START WORK. The
                            bytes do not exist yet, so there is no href to give
                            them, and a link's "save link as" would hand the
                            user a 404 from the artifact route (which never
                            starts a job — design §0.2).

                            Copy mode changes their DELIVERY, never their
                            identity: same labels, same glyphs, same order. The
                            row names the rendition it produces; where those
                            bytes land is the mode's business, and renaming
                            every row would make one preference look like eight
                            different ones. */}
                        {rows.map(({ preset, label }) => (
                            <MenuItem
                                key={preset.id}
                                label={label}
                                icon={<Scissors className="size-3.5" />}
                                disabled={busy}
                                title={busy
                                    ? "Another export of this item is still running"
                                    : undefined}
                                onClick={() => {
                                    close()
                                    void exportClip({
                                        sha256: clip.sha256,
                                        preset,
                                        request: clip.request,
                                        rowLabel: label,
                                        dbs: clip.dbs,
                                        deliver,
                                    })
                                }}
                            />
                        ))}
                        {/* The mode switch, last and always — in DOWNLOAD mode
                            too, since that is where it is turned on. Its own
                            divider, because it is the only row here that does
                            not act on the file: everything above produces
                            bytes, this one decides where they go. */}
                        {copyAvailable && (
                            <>
                                <div aria-hidden className="my-1 h-px bg-white/15" />
                                <MenuItem
                                    label="Copy, don't download"
                                    checked={copyInstead}
                                    // The slot is reserved either way, so
                                    // toggling does not shift the label out
                                    // from under the pointer.
                                    icon={copyInstead
                                        ? <Check className="size-3.5" />
                                        : <span aria-hidden className="size-3.5 shrink-0" />}
                                    title="Copy files to the clipboard instead of downloading them"
                                    // Deliberately no close(): this popover
                                    // closes only when a handler asks it to, and
                                    // the rows above flipping verb under the
                                    // cursor IS the toggle's feedback.
                                    onClick={() => setCopyInstead(!copyInstead)}
                                />
                            </>
                        )}
                    </SurfacePopover>
                )}
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
                    className={cn(
                        "bg-black/30 hover:bg-black/50",
                        open && "bg-black/50",
                    )}
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
