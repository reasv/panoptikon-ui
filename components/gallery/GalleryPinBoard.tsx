import Image from 'next/image'
import { cn, downloadFileName, getFileURL } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"
import { useGalleryFullscreen, useGalleryPinAutoCrop, useGalleryPinAutoLayout, useGalleryPinGrid, useGalleryPinProportional, useGalleryPinResizeHandles, useGalleryPinSelectionCrop, useGalleryTrim } from '@/lib/state/gallery'
import { newPinHField } from '@/lib/galleryTrim'
import { consumePinboardExplicitPlacement, consumePinboardMaximizeRequest, consumePinboardNavigation, consumePinboardPendingEdit, markPinboardExplicitPlacement } from '@/lib/pinboardNavigation'
import { usePinBoard } from '@/lib/state/pinboard'
import { GridParams, effectiveGrid, gridScale, minPinUnits, rowStep, v1ScaleFactors } from '@/lib/pinboardGrid'
import { placeNearest, placeNewPin } from '@/lib/pinboardPlace'
import { PinButton } from './PinButton'
import { useEffect, useMemo, useRef, useState } from 'react'
import { GridLayout, noCompactor, useContainerWidth, type LayoutItem } from "react-grid-layout"
import { GridBackground, fastVerticalCompactor } from "react-grid-layout/extras"
import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"
import { ScrollArea } from '../ui/scroll-area'
import { SelectButton } from './SelectButton'
import { FindButton } from './FindButton'
import {
    ContextMenu,
    ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { PinBoardCtx } from './PinBoardContextMenu'
import { $api } from '@/lib/api'
import { MediaControls } from './PlayButton'
import React from 'react'
import { useOutroSkipEnabled, useVideoPlayerState } from '@/lib/videoPlayerState'
import { CropRect, PinAudioState, PinLock, PinOrientation, TrimRange, clampCrop, composeCrops, isEmptyTrim, isIdentityOrientation, packHField, parseHField } from '@/lib/pinboardCrop'
import { effectiveVideoTrim, outroCutPoint, outroProbeEligible, outroSkipGoverns, useVideoDuration, useVideoTrim } from '@/lib/videoTrim'
import { useVideoEndProbe } from '@/lib/videoEndProbe'
import { noteVideoPlaybackError, shouldDowngradeOnError, useVideoPlayability } from '@/lib/videoPlayability'
import { useVideoPlayback } from '@/lib/videoTranscode'
import { useVideoTranscodeEnabled } from '@/lib/useClientConfig'
import { CropGeometry, CropView } from './CropView'
import { NativeControlsEscape, VideoPlayerSurface, playerSizeForWidth, useVideoPlayerSurface } from './VideoPlayerSurface'
import { Anchor, ArrowLeftRight, ArrowLeftToLine, ArrowRightToLine, Check, ChevronDown, ChevronsLeft, ChevronsRight, ChevronsUp, Columns3, Crop, Dices, Expand, FlipHorizontal, FlipHorizontal2, FlipVertical, FlipVertical2, FoldHorizontal, GripVertical, ImageDown, LayoutDashboard, LayoutGrid, ListX, LockOpen, Maximize, RotateCcw, RotateCw, Ruler, Scaling, Scan, SquareDashed, Trash2, X, type LucideIcon } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { REGION_PRESETS, RegionPreset, usePinboardLayoutActions } from '@/hooks/pinboardLayout'
import { RegionIcon } from './RegionIcon'
import { usePinSelection } from '@/lib/state/pinboardSelection'
import { useToast } from '@/components/ui/use-toast'
import { useItemSelection } from '@/lib/state/itemSelection'
import { GridRect, groupRowsByOverlap } from '@/lib/pinboardPack'
import { maximalFreeRects, pickRectAt, rectsOverlap } from '@/lib/pinboardHoles'
import { usePinboardCarry } from '@/lib/state/pinboardCarry'
import { HoleTargetOverlay } from './HoleTargetOverlay'
import { PinboardTransformOverlay, TransformPxRect, TransformScale } from './PinboardTransformOverlay'
import { PinboardBoardApi, usePinboardBoardApi } from '@/lib/state/pinboardBoardApi'
import { PinboardFullscreenBar } from './PinboardMenu'
import { SelectionExportMenuItems, selectionExportLabel } from './PinboardExportMenu'
import { dropdownMenuKit } from './PinboardGlobalMenu'

const ALL_RESIZE_HANDLES: LayoutItem["resizeHandles"] =
    ["s", "w", "e", "n", "sw", "nw", "se", "ne"]
// The subset a gravity-ON board can actually offer. RGL v2's GridItem
// re-derives the resize anchor from the item's CURRENT layout position on
// every event, and vertical compaction snaps that position back to the
// compacted edge between events — so a north handle (n/nw/ne) reads as
// "top edge glued, shrink from the bottom" and is functionally INVERTED,
// the same failure the crop-mode compactor comment documents below. The
// three are dropped rather than fixed because under gravity the top edge
// is pinned by the layout physics anyway: "drag the top edge" has no
// coherent meaning on a board that re-glues it after every event. Turn
// Gravity off (the layout token's float switch, which also turns the
// compactor off) to get all eight.
const GRAVITY_RESIZE_HANDLES: LayoutItem["resizeHandles"] =
    ["s", "w", "e", "sw", "se"]

// Static grid configs (referentially stable so the grid's internal memos
// don't churn). The board's own drags start only from .drag-handle layers;
// resize handles come from react-resizable with the default 'se' unless an
// item overrides resizeHandles (the crop-mode item always gets all eight;
// a normal item gets the flag's set while "All Resize Handles" is on).
// threshold: 0 is v1 drag semantics (drag starts on mousedown) and is NOT
// optional: RGL v2's external-drop placeholder drives its grid item through a
// synthetic drag whose fake events never move, so a nonzero threshold leaves
// that drag stuck in the pending state and the hover machinery loops React
// into a nested-update crash. Clicks on the overlay buttons are unaffected —
// they sit outside the .drag-handle layer.
const DRAG_CONFIG = { enabled: true, handle: ".drag-handle", threshold: 0 }
const RESIZE_CONFIG = { enabled: true }
// A pin's video player can take element fullscreen, which owns the screen
// and the keyboard while it runs: a board shortcut fired there would act on
// pins nobody can see, and Escape belongs to the browser's own exit. Read at
// fire time — nothing re-renders the board on fullscreenchange.
function inElementFullscreen() {
    return document.fullscreenElement !== null
}
// Shift-held external drags switch to hole mode: rejecting the dragover
// here removes RGL's placeholder and its live cascade — the board's own
// dragover tracking and HoleTargetOverlay take over (and its onDropCapture
// commits the drop). Releasing Shift hands the drag straight back to RGL.
const DROP_CONFIG = {
    enabled: true,
    onDragOver: (e: DragEvent) => (e.shiftKey ? false as const : undefined),
}

// Order-preserving set union, for additive selection gestures
const union = (a: string[], b: string[]) =>
    [...a, ...b.filter((k) => !a.includes(k))]

// Selection toolbar placement: smallest inset from the board edges, and the
// gap between the bar's bottom edge and the item top edge it hangs above
const TOOLBAR_EDGE = 4
const TOOLBAR_GAP = 6

// The selection verbs. All of them live in the toolbar's dropdown; each
// row's pin toggle additionally puts that verb directly on the bar, a user
// preference persisted in localStorage (not board state, so not in the
// URL). Lock management and the crop toggle aren't verbs and always sit on
// the bar. Availability: `exact`/`min` constrain the selection count, and
// `noAnchors` greys the verb while the selection contains an anchored item
// (a mirror is a rigid flip — a fixed point off the axis breaks it; the
// other verbs just work around anchors).
interface SelectionVerb {
    id: string
    label: string
    icon: LucideIcon
    title: string
    min?: number
    exact?: number
    noAnchors?: boolean
    // Removes pins: grouped last on every surface (the bar keeps
    // BAR_ORDER, so a pinned removal lands at the end of the pinned run).
    // Position only — these rows look like every other verb. They carry no
    // destructive treatment because they are not destructive: one record
    // write is one history entry, so the browser Back button restores the
    // board whole, and a filled red row overstates an undoable edit.
    removal?: boolean
    // Keyboard equivalent, shown on the dropdown row the way the context
    // menu's twin already shows it — the two surfaces offer the same verb
    // and must advertise the same key
    shortcut?: string
}
const SELECTION_VERBS: SelectionVerb[] = [
    {
        id: "arrange", label: "Arrange", icon: LayoutDashboard, min: 2,
        title: "Rearrange the selected items within their combined bounding box",
    },
    // Arrange's identical-cells sibling: same bounding box, same eviction,
    // but the box splits into one repeated cell instead of a mosaic
    {
        id: "uniform", label: "Uniform", icon: LayoutGrid, min: 2,
        title: "Arrange the selected items in identical cells within their combined bounding box",
    },
    {
        id: "swap", label: "Swap", icon: ArrowLeftRight, exact: 2,
        title: "Selected items exchange position and size (select exactly two)",
    },
    {
        id: "hole", label: "Move to Hole", icon: SquareDashed,
        title: "Pick an empty area to move the selection into — click a hole, or drag to carve a spot",
    },
    // Modal like Move to Hole: enters the Scale & Move session, a bounding
    // box around the selection whose interior drags the group and whose
    // handles scale it (see PinboardTransformOverlay). Anchors grey it for
    // the mirror rule's reason — every member must travel — and size locks
    // refuse at entry with a toast, the rotation rule's reason: scaling
    // resizes every member.
    {
        id: "transform", label: "Scale & Move", icon: Scan, min: 2, noAnchors: true,
        title: "Move and scale the selected items as one group — drag the box to move it, its handles to scale it; Esc or a click outside finishes",
    },
    {
        id: "reflow", label: "Reflow (Keep Proportions)", icon: Scaling, min: 2,
        title: "Rearrange within the bounding box, keeping each item's share of the space",
    },
    {
        id: "shuffle", label: "Shuffle", icon: Dices, min: 2,
        title: "Reroll the selection's arrangement — a different composition each time",
    },
    {
        id: "grow", label: "Grow to Fill", icon: Expand,
        title: "Grow the selection into the empty space around it",
    },
    {
        id: "shiftLeft", label: "Shift Left", icon: ArrowLeftToLine,
        title: "Slide the selected items left until they hit something",
    },
    {
        id: "shiftCenter", label: "Center", icon: FoldHorizontal,
        title: "Pack the selected items together and center them in their free space",
    },
    {
        id: "shiftRight", label: "Shift Right", icon: ArrowRightToLine,
        title: "Slide the selected items right until they hit something",
    },
    // Compress belongs to the Shift family — same "tidy this up sideways"
    // gesture, except it also removes the letterboxing it finds and each
    // item keeps its gap instead of falling flush. Chevrons, so the bar
    // never confuses them with the Shift arrows.
    {
        id: "compressLeft", label: "Compress Left", icon: ChevronsLeft, min: 1,
        title: "Shrink letterboxed items along this axis and close the gaps toward the left",
    },
    {
        id: "compressRight", label: "Compress Right", icon: ChevronsRight, min: 1,
        title: "Shrink letterboxed items along this axis and close the gaps toward the right",
    },
    {
        id: "compressUp", label: "Compress Up", icon: ChevronsUp, min: 1,
        title: "Shrink letterboxed items' heights; the board compacts the freed space upward",
    },
    // (Compress Up is the one verb whose MEANING depends on gravity: with
    // it off nothing closes the rows the shrink frees, so the verb is a
    // pure in-place letterbox trim. See verbTitle.)
    {
        id: "mirrorH", label: "Mirror Horizontally", icon: FlipHorizontal2, min: 2, noAnchors: true,
        title: "Mirror the selected items' arrangement about their vertical middle",
    },
    {
        id: "mirrorV", label: "Mirror Vertically", icon: FlipVertical2, min: 2, noAnchors: true,
        title: "Mirror the selected items' arrangement about their horizontal middle",
    },
    // Image orientation, not arrangement: the Mirror pair above moves the
    // items, these turn the pictures. Deliberately the non-"2" lucide
    // glyphs so the two families read differently on the bar. Rotation is
    // NOT statically greyed on locks — the verb refuses with a toast saying
    // how many locked items are in the way, which beats an unexplained grey.
    {
        id: "flipImageH", label: "Flip Images Horizontally", icon: FlipHorizontal, min: 1,
        title: "Flip each selected image left-to-right (the pictures themselves, not their positions)",
    },
    {
        id: "flipImageV", label: "Flip Images Vertically", icon: FlipVertical, min: 1,
        title: "Flip each selected image top-to-bottom (the pictures themselves, not their positions)",
    },
    {
        id: "rotateImageL", label: "Rotate Images Left", icon: RotateCcw, min: 1,
        title: "Turn each selected image a quarter turn left; every box swaps its width and height (refused while the selection holds a locked item)",
    },
    {
        id: "rotateImageR", label: "Rotate Images Right", icon: RotateCw, min: 1,
        title: "Turn each selected image a quarter turn right; every box swaps its width and height (refused while the selection holds a locked item)",
    },
    {
        id: "clearCrop", label: "Clear Auto-Crops", icon: Maximize,
        title: "Remove the selected items' auto crops, letterboxing the full image",
    },
    // The removal pair sits last everywhere. No confirm dialog: one record
    // write is one history entry, so the browser Back button restores the
    // board whole — the toast says so.
    {
        id: "removeSel", label: "Remove Selected", icon: Trash2, min: 1, removal: true,
        shortcut: "Del",
        title: "Remove the selected items from the board (Del; the browser Back button restores them)",
    },
    {
        id: "removeRest", label: "Remove All but Selected", icon: ListX, min: 1, removal: true,
        title: "Remove every item that is NOT selected (the browser Back button restores them)",
    },
]
// A verb's hover text at the board's current gravity. Only Compress Up
// differs: its static title describes the settle that follows the shrink,
// which simply does not happen on a free-floating board.
function verbTitle(v: SelectionVerb, gravity: boolean): string {
    if (v.id !== "compressUp" || gravity) return v.title
    return "Shrink letterboxed items' heights in place, trimming the"
        + " letterboxing; the freed space stays empty"
}
const TOOLBAR_VERBS_KEY = "pinboardToolbarVerbs"
const DEFAULT_TOOLBAR_VERBS = ["arrange", "swap"]
// Pinnable non-verb: the Send to Region submenu. On the bar it becomes an
// icon button opening the preset menu rather than acting directly.
const REGION_MENU_ID = "region"
// Pinnable non-verb: the Save Image submenu (the selection as a mosaic, or
// a single item as a picture — see PinboardExportMenu). Like the region
// menu it opens rather than acting, and it is the one control here that
// takes the selection OUT of the app.
const EXPORT_MENU_ID = "export"
// Bar display order for pinned controls: the dropdown's own verb order,
// with the region menu slotted right after Swap and the export menu last —
// the same places they sit in the dropdown. Rendering follows this list
// rather than pin-toggle order, so the bar is stable no matter when each
// control was pinned.
const BAR_ORDER = [
    ...SELECTION_VERBS.flatMap(v =>
        v.id === "swap" ? [v.id, REGION_MENU_ID] : [v.id]),
    EXPORT_MENU_ID,
]

export function PinBoard(
    {
        thumbnailsOpen,
        showPagination = true,
        variant = "gallery",
        updateRibbonVisible = false,
    }: {
        thumbnailsOpen: boolean
        showPagination?: boolean
        // "grid": hosted in the search-results panel instead of the
        // gallery. Same board sizing as the gallery with the thumbnail row
        // disabled (the two hosts' chrome heights match by construction),
        // plus the desktop-update-ribbon offset the grid view compensates
        // for — and mounting there counts as an intent to expand the board
        // (see the first-observation growth trigger).
        variant?: "gallery" | "grid"
        updateRibbonVisible?: boolean
    }
) {
    const dbs = useSelectedDBs()[0]
    // Token-stripped records plus the board's grid parameters; writes migrate
    // v1 boards to the v2 grid (see lib/pinboardGrid.ts)
    const {
        grid, records, isV1, highWater, float, uniform, refWidth,
        updateRecords, upgradeGrid, stampRefWidth,
    } = usePinBoard()
    // "Scale With Window" (the pbp board flag): see effGrid below
    const [proportional] = useGalleryPinProportional()
    // "All Resize Handles" (the prh board flag): all eight handles on every
    // normal item instead of the bottom-right corner alone (see the layout
    // memo). A pure view preference — nothing is stored per item.
    const [allHandles] = useGalleryPinResizeHandles()
    // Key of the item currently in crop mode, if any
    const [cropKey, setCropKey] = useState<string | null>(null)
    // True while the crop-mode item's box is being resized via a grid handle
    const [cropResizing, setCropResizing] = useState(false)
    // Height floor held for the duration of ANY drag/resize gesture, in
    // px: the grid-area content height captured at gesture start. RGL
    // measures gesture positions against the grid container's on-screen
    // rect (the item's offsetParent), so if a gesture shrinks the lowest
    // item — pulling a south edge up, dragging the bottom item upward —
    // the grid's height drop shrinks the ScrollArea's scroll range, the
    // browser clamps scrollTop, the container shifts on screen, and a
    // STATIONARY pointer reads as having moved further: each increment
    // of shrink clamps more scroll and feeds itself, multiplying a small
    // pull into a runaway jump. Holding the height for the gesture's
    // duration breaks the loop.
    //
    // The floor is a min-height on the .react-grid-layout element
    // itself, applied through the pinboard-freeze class and the
    // --pinboard-freeze variable stamped on the wrapper (see
    // globals.css). The grid is the wrapper's in-flow child whose height
    // already defines the scroll range at rest, so flooring it holds the
    // range in every engine (an earlier absolutely-positioned spacer
    // relied on abspos overflow reaching the Radix viewport's scrollable
    // area — propagation that varies with engine and intermediate boxes)
    // and pins the board's visible bottom edge at the same time. The
    // floor must NOT be an inline min-height on the wrapper: the wrapper
    // is a block inside the Radix ScrollArea's display:table inner div,
    // and giving IT a min-height resets the viewport's scrollTop to 0
    // outright — which shifted the grid rect by a full viewport at
    // mousedown and made RGL collapse the grabbed item to its minimum
    // before the pointer ever moved. Release doesn't drop the floor
    // instantly: the pinboard-freeze-releasing class transitions the
    // grid's min-height to 0 over 300ms, so the freed range collapses as
    // a followable glide (the browser clamps scrollTop continuously
    // along the way) instead of a snap fighting RGL's own 200ms
    // container-height easing. Re-grabbing mid-glide re-captures the
    // CURRENT rendered height, so successive adjustments never jump.
    const [gestureFreeze, setGestureFreeze] = useState<
        { h: number; releasing: boolean } | null>(null)
    // The LIVE floor value, ratcheted upward mid-gesture by the
    // autoscroll loop below (state alone would re-render the whole board
    // per scrolled frame). Render reads it too, so a mid-gesture
    // re-render can't stamp a stale variable over a ratcheted one.
    const freezeHRef = useRef<number | null>(null)
    const freezeScrollRange = () => {
        const areaEl = gridAreaRef.current
        const gridEl = areaEl?.querySelector<HTMLElement>(".react-grid-layout")
        const h = Math.max(areaEl?.clientHeight ?? 0, gridEl?.offsetHeight ?? 0)
        freezeHRef.current = h > 0 ? h : null
        setGestureFreeze(h > 0 ? { h, releasing: false } : null)
        startGestureAutoscroll()
    }
    const releaseScrollFloor = () => {
        stopGestureAutoscroll()
        setGestureFreeze((f) => f && !f.releasing ? { ...f, releasing: true } : f)
    }
    // Deliberate, speed-capped auto-scroll while an RGL gesture is
    // active — the sanctioned way to reach past the viewport edge in
    // either direction (grow the bottom item downward, pull something
    // toward content above the fold). Unlike the marquee's eager
    // 40px-inside-the-viewport zone, this one engages only when the
    // pointer is BEYOND the viewport edge: the resize corner of the
    // lowest item usually sits within an inside-zone's reach, so an
    // inside trigger starts a growth conveyor the instant the handle is
    // grabbed — pushing past the boundary is an unambiguous "keep
    // going", and the gentler cap keeps the conveyor's growth rate
    // (which is 1:1 with scroll, every scrolled px re-measures into a px
    // of box travel) hand-controllable. After each scroll step a
    // synthetic mousemove at the parked pointer position is dispatched
    // so RGL re-measures against the moved container rect and the
    // dragged box keeps following the pointer in CONTENT space — without
    // it the board would slide under a stationary pointer until the next
    // real move, then snap. Every downward step also RATCHETS the
    // gesture floor up to scrollTop+clientHeight — exactly the invariant
    // that makes clamping impossible — because the start-captured floor
    // only covers the region below the gesture-start height: after
    // autoscroll has carried the view down into gesture-grown territory,
    // pulling back up would otherwise shrink the live range above the
    // floor and re-enter the clamp feedback loop mid-gesture. The
    // ratchet writes --pinboard-freeze imperatively; the accumulated
    // overshoot collapses in the release glide like everything else.
    const GESTURE_SCROLL_MAX = 16
    const gestureScrollRef = useRef<{
        onMove: (e: MouseEvent) => void
        viewport: HTMLElement
        raf: number
        lastX: number
        lastY: number
    } | null>(null)
    const stopGestureAutoscroll = () => {
        const g = gestureScrollRef.current
        if (!g) return
        window.removeEventListener("mousemove", g.onMove)
        if (g.raf) cancelAnimationFrame(g.raf)
        gestureScrollRef.current = null
    }
    const startGestureAutoscroll = () => {
        stopGestureAutoscroll()
        const viewport = scrollAreaRef.current
            ?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]")
        if (!viewport) return
        const step = () => {
            const g = gestureScrollRef.current
            if (!g) return
            g.raf = 0
            const vr = g.viewport.getBoundingClientRect()
            let dy = 0
            if (g.lastY > vr.bottom) {
                dy = Math.min(GESTURE_SCROLL_MAX, (g.lastY - vr.bottom) / 2)
            } else if (g.lastY < vr.top) {
                dy = -Math.min(GESTURE_SCROLL_MAX, (vr.top - g.lastY) / 2)
            }
            if (dy === 0) return
            const before = g.viewport.scrollTop
            g.viewport.scrollTop += dy
            if (g.viewport.scrollTop === before) return // hit the end
            if (dy > 0) {
                const needed = Math.ceil(
                    g.viewport.scrollTop + g.viewport.clientHeight)
                if (needed > (freezeHRef.current ?? 0)) {
                    freezeHRef.current = needed
                    gridAreaRef.current?.style.setProperty(
                        "--pinboard-freeze", `${needed}px`)
                }
            }
            // Schedule before dispatching: the synthetic move re-enters
            // onMove, which must see the loop as already running
            g.raf = requestAnimationFrame(step)
            document.dispatchEvent(new MouseEvent("mousemove", {
                bubbles: true, cancelable: true, view: window,
                clientX: g.lastX, clientY: g.lastY, buttons: 1,
            }))
        }
        const g = {
            viewport, raf: 0, lastX: 0, lastY: 0,
            onMove: (e: MouseEvent) => {
                if (!e.isTrusted) return // our own synthetic moves
                g.lastX = e.clientX
                g.lastY = e.clientY
                if (!g.raf) g.raf = requestAnimationFrame(step)
            },
        }
        gestureScrollRef.current = g
        window.addEventListener("mousemove", g.onMove)
    }
    useEffect(() => () => stopGestureAutoscroll(), [])
    // Getter for the crop-mode image's viewport extent, set by its CropView
    const cropImageExtentRef = useRef<(() => CropGeometry | null) | null>(null)
    // Width of the grid area, observed by RGL's own hook (the successor of
    // the WidthProvider HOC: same 1280 SSR default, rAF-throttled observer).
    // The grid renders ungated so SSR still paints items (at percentage
    // positions, see rglSettling below). Declared above the layout memo
    // because the minimum-size floors depend on the measured column width.
    const { width: gridWidth, containerRef: gridAreaRef } = useContainerWidth()
    // The grid the board is RENDERED with. With "Scale With Window" on and a
    // reference width in the layout token, the cell aspect is frozen at the
    // shape it had at that width: the vertical axis — row height, margin and
    // padding alike — scales by currentWidth/refWidth, so the whole board
    // zooms with the window instead of letterboxing (see pinboardGrid.ts).
    // Every grid CONSUMER below reads effGrid; the base `grid` stays the one
    // and only serialization source, and `gridKey` stays keyed on it (keying
    // the remount on effGrid would remount the board on every resize pixel).
    // With the feature off this IS `grid`, by object identity, so nothing
    // downstream can tell the difference.
    //
    // gridWidth is RGL's 1280px SSR placeholder until the observer's first
    // measurement lands, so a board with a reference width far from 1280
    // paints one frame at the wrong scale and reflows on hydration.
    // Deliberately NOT gated on "the width is real": the server renders
    // this same expression, so a client-only gate would paint a different
    // first frame than the SSR HTML (a hydration mismatch) — and it would
    // paint it at scale 1, which for a board authored at 3440px and shown
    // at ~1030px is three times further off than the placeholder scale is.
    // One frame at 1280/refWidth is the cheapest wrong answer available.
    const scale = gridScale(proportional, refWidth, gridWidth)
    const effGrid = useMemo(
        () => effectiveGrid(grid, scale), [grid, scale])
    // A board whose flag is on but whose token carries no reference width —
    // created with the flag as its creation default, or saved before the
    // feature existed — adopts the width it is first measured at. Until then
    // the scale is 1, so this is inert; the write replaces rather than
    // pushes, since the user didn't ask for it. The measurement must come
    // from the DOM, not from gridWidth: that starts at RGL's 1280 SSR
    // placeholder, and stamping THAT would freeze the board at a width it
    // was never rendered at.
    // The latch keeps the stamp to ONE write while the URL update is in
    // flight (this effect deliberately has no dep array — it needs a fresh
    // DOM read every render until a real measurement exists); it clears
    // itself as soon as the write lands or another board takes over.
    //
    // v1 boards are excluded: the stamp writes the token, and writing a v1
    // token migrates the board onto the v2 lattice — as a replace, so Back
    // could not even undo it. Merely RENDERING a v1-era version whose flags
    // carry pbp would then convert it, which is precisely what the
    // lazy-migration rule forbids (see lib/state/pinboard.ts). A v1 board
    // keeps no reference width, so its scale stays 1 and it renders exactly
    // as it always has; the first real mutation migrates it, and from then
    // on this effect stamps it like any other board. stampRefWidth refuses
    // v1 boards itself as well — this is the cheap half of that guard.
    const refWidthStamped = useRef(false)
    useEffect(() => {
        if (!proportional || refWidth > 0 || records.length === 0 || isV1) {
            refWidthStamped.current = false
            return
        }
        if (refWidthStamped.current) return
        const measured = gridAreaRef.current?.offsetWidth ?? 0
        if (measured <= 0) return
        refWidthStamped.current = true
        stampRefWidth(measured)
    })
    // Orientation is decoded alongside the other extras so every per-pin map
    // is keyed by the same layout key.
    const [layout, pinnedFiles, crops, autoCrops, trims, itemLocks, orients, audios]: [
        LayoutItem[],
        [string, string, string, string][],
        Record<string, CropRect | null>,
        Record<string, CropRect | null>,
        Record<string, TrimRange | null>,
        Record<string, PinLock>,
        Record<string, PinOrientation | null>,
        Record<string, PinAudioState | null>,
    ] = useMemo(() => {
        const newLayout: LayoutItem[] = []
        const pinned: [string, string, string, string][] = []
        const cropsMap: Record<string, CropRect | null> = {}
        const autoCropsMap: Record<string, CropRect | null> = {}
        const trimsMap: Record<string, TrimRange | null> = {}
        const locksMap: Record<string, PinLock> = {}
        const orientsMap: Record<string, PinOrientation | null> = {}
        const audiosMap: Record<string, PinAudioState | null> = {}
        // Minimum-size floors for resize gestures. RGL applies minW/minH
        // through gesture-time constraints only — the layout sync never
        // clamps — so records already below the minimum (legacy boards,
        // relaxed degenerate layouts) render untouched and only snap up to
        // the minimum when actually resized. The crop-mode item is exempt:
        // its box is the crop window, which may legitimately be tiny.
        const colWidth = (gridWidth - 2 * effGrid.padding
            - (effGrid.columns - 1) * effGrid.margin) / effGrid.columns
        const { minW, minH } = minPinUnits(effGrid, colWidth)
        // Gravity gates the handle set: only a float board can offer the
        // north handles (see GRAVITY_RESIZE_HANDLES)
        const handleSet = float ? ALL_RESIZE_HANDLES : GRAVITY_RESIZE_HANDLES
        for (let i = 0; i < records.length; i += 5) {
            const [sha256, x, y, w, hField] = records.slice(i, i + 5)
            const index = `${i}-${sha256}`
            const { h, crop, autoCrop, trim, lock, orient, audio } = parseHField(hField)
            cropsMap[index] = crop
            autoCropsMap[index] = autoCrop
            trimsMap[index] = trim
            locksMap[index] = lock
            orientsMap[index] = orient
            audiosMap[index] = audio
            newLayout.push({
                i: index,
                x: parseInt(x),
                y: parseInt(y),
                w: parseInt(w),
                h,
                ...(index === cropKey
                    ? { resizeHandles: ALL_RESIZE_HANDLES }
                    // "All Resize Handles" (the prh board flag) gives every
                    // normal item the full eight — minus the north three
                    // while gravity is on, where compaction makes them
                    // inverted (see GRAVITY_RESIZE_HANDLES). Only items
                    // that actually resize get them: RGL hides the handles
                    // of a static or isResizable:false item
                    // (react-resizable-hide), so handing them a handle set
                    // would be inert either way — but it would still render
                    // dead spans per locked item, so the locked cases keep
                    // the plain minW/minH shape they had. The drop
                    // placeholder is exempt too: it is a transient sentinel
                    // record, never resized.
                    : allHandles && sha256 !== "__preview"
                        && lock !== "anchor" && lock !== "size"
                        ? { minW, minH, resizeHandles: handleSet }
                        : { minW, minH }),
                // An anchored item is a native RGL static: drags can't
                // displace it and the compactor treats it as a wall.
                // Size-locked items just lose their resize handles. The
                // crop-mode item is exempt from both — its box is the crop
                // window.
                ...(lock === "anchor" && index !== cropKey ? { static: true } : {}),
                ...(lock === "size" && index !== cropKey ? { isResizable: false } : {}),
            })
            if (sha256 === "__preview") {
                pinned.push([
                    index,
                    sha256,
                    "/logo.svg", // Placeholder for the preview box
                    "/logo.svg", // Placeholder for the preview box
                ])
                continue
            }
            pinned.push([
                index,
                sha256,
                getFileURL(dbs, "thumbnail", "sha256", sha256),
                getFileURL(dbs, "file", "sha256", sha256),
            ])
        }
        return [newLayout, pinned, cropsMap, autoCropsMap, trimsMap, locksMap, orientsMap, audiosMap]
    }, [records, cropKey, dbs, effGrid, gridWidth, allHandles, float])

    // Rebuilds the packed records from RGL's reported layout, in the EXISTING
    // record order: the item keys embed each record's offset, so persisting in
    // RGL's iteration order would shuffle the offsets, change every key,
    // remount every pin (with its ContextMenu popper) and re-fire this handler
    // — feeding the layout back into itself through the URL until React's
    // nested-update limit crashes the page.
    // GEOMETRY ONLY: records whose key is absent from the reported layout are
    // kept untouched, and layout items without a record are ignored. RGL v2
    // syncs our layout prop into its internal state in a post-paint effect,
    // so every layout report is one commit BEHIND the records that produced
    // it; a report racing a structural record write (pin drop, unpin) is
    // simply missing/carrying that item. Inferring deletions or additions
    // from such a report echoes the stale layout back into the records,
    // which flips the next report the other way — an infinite drop↔re-add
    // write loop (nested-update crash on pin drop). Structural changes go
    // through explicit updateRecords calls only; the layout sync integrates
    // them on the next commit.
    // autoCropOverrides, when given, replaces the auto-crop slot of the keys
    // it contains (null clears the slot); keys absent from the map keep their
    // existing auto crop. Layout actions pass it so the recomputed fit-to-cell
    // crops land in the SAME record write as the geometry — one URL write,
    // one history entry. Raw RGL drags/resizes don't pass it, so a hand-resized
    // cell intentionally keeps its stale auto crop until the next auto-crop or
    // layout action recomputes it from the manual base.
    // manualCropOverrides does the same for the MANUAL crop slot (and, like
    // any manual-crop write, clears the auto slot of those keys). Crop-mode
    // box resizes use it: the crop committed at release MUST ride the same
    // write as the geometry, because two updateRecords calls in one event
    // tick do not compose — nuqs resolves each functional updater against
    // a stateRef that only advances when React runs the queued updater, so
    // the second write rebuilds from the first one's base and clobbers it.
    // orientationOverrides is the same for the ORIENTATION slot (null =
    // identity), which the rotate/flip verbs write together with the
    // geometry and both remapped crop rects — one write, one history entry.
    // PRECEDENCE between the two crop overrides: an explicit
    // autoCropOverride for a key wins over the implicit clear a manual-crop
    // write performs. The clear exists because a new manual crop is a new
    // base for the derived auto crop; an orientation remap moves BOTH slots
    // through the same transform, so the auto crop is still an exact fit
    // and the verb states it explicitly rather than losing it.
    const rebuildRecords = (
        prev: string[],
        currentLayout: LayoutItem[],
        autoCropOverrides?: Record<string, CropRect | null>,
        manualCropOverrides?: Record<string, CropRect | null>,
        orientationOverrides?: Record<string, PinOrientation | null>,
    ) => {
        const byKey = new Map(
            currentLayout.filter((e) => e.i !== "__preview").map((l) => [l.i, l])
        )
        const next: string[] = []
        for (let i = 0; i < prev.length; i += 5) {
            const key = `${i}-${prev[i]}`
            const item = byKey.get(key)
            if (!item) {
                next.push(...prev.slice(i, i + 5))
                continue
            }
            const { crop, autoCrop, trim, lock, orient, audio } = parseHField(prev[i + 4])
            const hasManual = manualCropOverrides && key in manualCropOverrides
            const hasAuto = autoCropOverrides && key in autoCropOverrides
            const nextCrop = hasManual ? manualCropOverrides[key] : crop
            const nextAuto = hasAuto
                ? autoCropOverrides[key]
                : hasManual
                    ? null // manual crop is the auto crop's base; the old auto is stale
                    : autoCrop
            const nextOrient = orientationOverrides && key in orientationOverrides
                ? orientationOverrides[key]
                : orient
            next.push(
                prev[i],
                item.x.toString(),
                item.y.toString(),
                item.w.toString(),
                // Crop/trim/lock/orientation/audio suffixes stored in the h
                // field survive box moves/resizes
                packHField(item.h, {
                    crop: nextCrop,
                    autoCrop: nextAuto,
                    trim,
                    lock,
                    orient: nextOrient,
                    audio,
                }),
            )
        }
        return next
    }

    // Manual crop waiting to be folded into the next onLayoutChange write —
    // set by the crop-mode resize release, which fires onLayoutChange (via
    // RGL's own resize-stop layout report) in the same tick
    const pendingManualCropRef = useRef<Record<string, CropRect | null> | null>(null)
    // True between a completed drag/resize gesture and the layout report it
    // produces. RGL's onLayoutChange also fires WITHOUT a gesture — on
    // mount and whenever the layouts prop re-syncs — reporting the
    // compacted form of whatever the URL held. Those normalization reports
    // still need writing (the records must match what's on screen), but as
    // history REPLACE, not push: pushing parks the normalized entry in
    // front of the one just navigated to, so back-navigating onto any
    // un-compacted entry (a pre-fix layout, a hand-crafted link) re-pushes
    // forever and the back button can never get past it.
    const gestureRef = useRef(false)
    // One-shot mark that a drag/resize gesture JUST completed and changed
    // the layout: RGL makes the gesture's onLayoutChange call synchronously
    // inside its drag/resize-stop handling — and only when the gesture
    // actually changed the layout — so the mark is still set for exactly
    // that report, and the microtask clears it before any asynchronous one.
    // Unlike gestureRef it can never go stale on a no-move gesture and
    // misclassify a later normalization report. It gates the auto-layout
    // auto-off below, which must never fire from verb writes, echo
    // normalizations, external drops or crop-mode edits.
    const manualGestureRef = useRef(false)
    const markManualGesture = () => {
        manualGestureRef.current = true
        queueMicrotask(() => { manualGestureRef.current = false })
    }
    // Auto-layout mode: when enabled, adding/removing/duplicating a pin —
    // or explicitly growing the board's viewport — re-runs the
    // viewport-filling mosaic over ALL items; with the auto-crop flag also
    // on, every item additionally gets fitted to its new cell in the same
    // write (see the trigger effects below). Declared above onLayoutChange
    // together with the toast because the manual-gesture auto-off uses
    // both.
    const [autoLayout, setAutoLayout] = useGalleryPinAutoLayout()
    const { toast } = useToast()
    const onLayoutChange = (
        currentLayout: LayoutItem[],
        autoCropOverrides?: Record<string, CropRect | null>,
        newHighWater?: number,
        orientationOverrides?: Record<string, PinOrientation | null>,
        verbManualCrops?: Record<string, CropRect | null>,
        // History mode for the record write; undefined means the hook's
        // default push. Two kinds of caller ask for "replace": RGL's own
        // normalization reports (see gestureRef), and a fill that rides
        // someone else's structural write (see the pin-count trigger).
        history?: "push" | "replace",
        manualGesture = false,
        // True only for RGL's own layout reports (the wrapper on the
        // GridLayout prop below); everything else is a verb write.
        fromRgl = false,
    ) => {
        // Verb writes during crop mode get compacted HERE: the compactor
        // prop is off while a crop session runs (see GridLayout below), so
        // a verb's computed layout — which relies on compaction to resolve
        // its overlaps (Resize Item growth, rotation footprint swaps,
        // Compress Up's freed rows) — would otherwise commit and render
        // overlapping until crop exit. The crop-mode item is held as a
        // static wall so the open crop window never moves under the
        // session, and anchors are walls here for the same reason they are
        // in RGL's own pass. RGL reports are exempt: a gesture release must
        // commit exactly what's on screen, echo normalizations must stay
        // identity, and the crop-release write must not reflow the board
        // mid-session — the rows the box vacates on a shrink have to stay
        // free for the next handle pull.
        // Skipped entirely while gravity is off: there the compactor prop is
        // off for the whole board, not just for the crop session, and a verb
        // write that settled anyway would be the one place the board still
        // fell upward. The verbs resolve their own overlaps there instead
        // (resolveGrowth in pinboardLayout), and the crop item is threaded
        // into that pass as a wall — same invariant, other mechanism.
        if (cropKey !== null && !fromRgl && !float) {
            // compact() clones its input and returns the compacted clone,
            // so the caller's layout — often the render memo's array itself
            // on orientation-only writes — stays untouched; the map only
            // injects the wall flags and the bounds clamp.
            currentLayout = [...fastVerticalCompactor.compact(
                currentLayout.map((l) => {
                    // RGL's correctBounds clamp (not exported), applied
                    // before compacting the way RGL's layout sync applies
                    // it: verbs may emit out-of-bounds boxes (Resize Item
                    // grows w in place, past the right edge), and clamping
                    // only later — in RGL's post-write sync — would slide
                    // the box into neighbours AFTER this pass compacted.
                    let x = l.x
                    let w = l.w
                    if (x + w > grid.columns) x = grid.columns - w
                    if (x < 0) { x = 0; w = grid.columns }
                    const wall = l.i === cropKey || itemLocks[l.i] === "anchor"
                    return wall || x !== l.x || w !== l.w
                        ? { ...l, x, w, static: wall || l.static }
                        : l
                }),
                grid.columns)]
        }
        // Verbs hand their manual-crop remap in directly; the pending ref
        // exists only for the crop-mode resize release, which cannot pass
        // anything (RGL fires that layout report itself). The direct
        // argument takes precedence. The two can't collide, but not because
        // verbs are unreachable in crop mode — they are, from any other
        // pin's menu and from the toolbar. What rules it out is the ref's
        // lifetime: onResizeStop sets it and RGL's own layout report
        // consumes it in the SAME synchronous tick, so no click-driven verb
        // can interleave. The clear is conditional anyway, so if that
        // invariant is ever broken a verb write can't silently swallow a
        // queued crop — it stays queued for the write that consumes it.
        const pending = pendingManualCropRef.current
        const manualCropOverrides = verbManualCrops ?? pending ?? undefined
        if (pending !== null && manualCropOverrides === pending) {
            pendingManualCropRef.current = null
        }
        // RGL fires onLayoutChange on every layouts-prop change and on mount,
        // not only on user interaction. If nothing actually moved, writing an
        // equal value back would push a redundant history entry and re-trigger
        // this handler — the write must only happen on real changes. This
        // guard is also what keeps merely *viewing* a v1 board from migrating
        // it: updateRecords only converts on writes. A fill that changed only
        // the ratchet still writes (updateRecords compares the ratchet too).
        const candidate = rebuildRecords(records, currentLayout,
            autoCropOverrides, manualCropOverrides, orientationOverrides)
        if (
            candidate.length === records.length &&
            candidate.every((v, i) => v === records[i]) &&
            newHighWater === undefined
        ) {
            return
        }
        // A hand-made arrangement and auto-layout can't coexist: the next
        // pin add would repaint the arrangement away. The user moving or
        // resizing an item is the clearest possible statement that they
        // want manual control, so the gesture that changed the board also
        // turns the mode off — same tick as the record write, one history
        // entry, and the toast says where to turn it back on.
        if (manualGesture && autoLayout) {
            setAutoLayout(false)
            toast({
                title: "Auto-Layout Off",
                description: "Arranging items by hand turns auto-layout off"
                    + " so your layout sticks. Toggle it back on from the"
                    + " board menu anytime.",
                duration: 4000,
            })
        }
        updateRecords(
            (prev) => rebuildRecords(prev, currentLayout,
                autoCropOverrides, manualCropOverrides, orientationOverrides),
            {
                ...(newHighWater !== undefined ? { highWater: newHighWater } : {}),
                ...(history ? { history } : {}),
            },
        )
    }

    // Set or clear the layout lock of the given items — one record write
    const setLockForKeys = (keys: string[], lock: PinLock) => {
        const keySet = new Set(keys)
        updateRecords((prev) => {
            const next = [...prev]
            for (let i = 0; i < prev.length; i += 5) {
                if (!keySet.has(`${i}-${prev[i]}`)) continue
                const { h, ...extras } = parseHField(prev[i + 4])
                next[i + 4] = packHField(h, { ...extras, lock })
            }
            return next
        })
    }

    // Append an identical copy of the pin's 5-string record (sha256, x, y, w,
    // packed h+crop). The offset embedded in the layout key locates the source
    // record; vertical compaction then nudges the copy off the original —
    // except with gravity off, where nothing would ever separate the two, so
    // the copy is placed explicitly at the free cell nearest the original.
    const onDuplicatePin = (key: string) => {
        updateRecords((prev, grid) => {
            const offset = parseInt(key.split("-")[0])
            const record = prev.slice(offset, offset + 5)
            if (record.length < 5) return prev
            if (!float) return [...prev, ...record]
            const { h } = parseHField(record[4])
            const { x, y } = placeNearest(prev, grid, parseInt(record[3]), h,
                { x: parseInt(record[1]), y: parseInt(record[2]) })
            return [...prev, record[0], x.toString(), y.toString(),
                record[3], record[4]]
        })
    }

    // Remove one pin by its exact record — the context menu's Unpin, the
    // same removal the overlay pin button does (silent: a single unpin is a
    // one-click action the button has always performed without ceremony).
    // Key-matched against `prev` like every other writer here, never a bare
    // splice at the render-time offset: the key embeds both the offset AND
    // the sha256, and only the pair identifies the record inside the
    // functional updater's own (possibly newer) base.
    const onUnpinPin = (key: string) => {
        updateRecords((prev) => {
            const next: string[] = []
            for (let i = 0; i < prev.length; i += 5) {
                if (`${i}-${prev[i]}` !== key) next.push(...prev.slice(i, i + 5))
            }
            return next
        })
    }

    // Bulk removal, the one write every multi-remove surface goes through
    // (the selection verbs, the Delete key, the below-viewport purge).
    // Key-matched filtering rather than offset splices, so a key that no
    // longer names a record simply matches nothing instead of cutting a
    // stranger out of the middle of the array. ONE updateRecords call is
    // one URL write and one history entry — so the browser Back button
    // restores the board whole, which is what the toast promises instead
    // of a confirm dialog. Locks are ignored: a lock pins geometry, not
    // existence (Clear Board ignores them too). The selection is
    // deliberately not preserved — every surviving key's offset shifts, so
    // the board's own prune clears it.
    const removePins = (keys: string[]) => {
        const keySet = new Set(keys)
        // The count the toast reports is resolved OUTSIDE the mutate,
        // against the live records: mutate runs twice (updateRecords
        // precomputes against its own records to detect the lifecycle
        // edges, then again inside the functional write) and must stay
        // free of side effects. Stale keys match nothing, so this is the
        // true removed count — zero of them means nothing to write at all.
        let count = 0
        for (let i = 0; i < records.length; i += 5) {
            if (keySet.has(`${i}-${records[i]}`)) count++
        }
        if (count === 0) return
        updateRecords((prev) => {
            const next: string[] = []
            for (let i = 0; i < prev.length; i += 5) {
                if (!keySet.has(`${i}-${prev[i]}`)) next.push(...prev.slice(i, i + 5))
            }
            return next
        })
        toast({
            title: `Removed ${count} ${count === 1 ? "pin" : "pins"}`,
            description: "Press the browser Back button to restore them.",
            duration: 4000,
        })
    }
    // "All but Selected" inverts against the LIVE board; with everything
    // selected it removes nothing and updateRecords' no-change guard
    // swallows the write. The drag preview's sentinel record is never a
    // removal target (menus can't normally be open mid-drag, but the
    // marquee can outlive one).
    const removeAllBut = (keys: string[]) => {
        const keep = new Set(keys)
        removePins(layout
            .map(l => l.i)
            .filter(k => !keep.has(k) && !k.endsWith("__preview")))
    }

    // Writing the manual crop also clears the auto slot: the manual crop is
    // the base the auto crop was derived from, so any stored auto crop is
    // stale the moment the base changes
    const onItemCropChange = (key: string, crop: CropRect | null) => {
        updateRecords((prev) => {
            const next = [...prev]
            for (let i = 0; i < prev.length; i += 5) {
                if (`${i}-${prev[i]}` === key) {
                    const { h, ...extras } = parseHField(prev[i + 4])
                    next[i + 4] = packHField(h, { ...extras, crop, autoCrop: null })
                    break
                }
            }
            return next
        })
    }

    const onItemTrimChange = (key: string, trim: TrimRange | null) => {
        updateRecords((prev) => {
            const next = [...prev]
            for (let i = 0; i < prev.length; i += 5) {
                if (`${i}-${prev[i]}` === key) {
                    const { h, ...extras } = parseHField(prev[i + 4])
                    next[i + 4] = packHField(h, { ...extras, trim })
                    break
                }
            }
            return next
        })
    }

    // Playback-snapshot writes REPLACE rather than push: pressing play or
    // dragging a volume slider must not become a back-button entry — Back
    // through a viewing session should walk the layout edits, not every
    // mute toggle between them.
    const onItemAudioChange = (key: string, audio: PinAudioState | null) => {
        updateRecords((prev) => {
            const next = [...prev]
            for (let i = 0; i < prev.length; i += 5) {
                if (`${i}-${prev[i]}` === key) {
                    const { h, ...extras } = parseHField(prev[i + 4])
                    next[i + 4] = packHField(h, { ...extras, audio })
                    break
                }
            }
            return next
        }, { history: "replace" })
    }

    const [fs, setFs] = useGalleryFullscreen()
    const [showGrid] = useGalleryPinGrid()
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    // v1 boards use v1-unit sizes for new/dropped pins so they stay
    // consistent pre-migration; on the finer v2 grid the same physical size
    // is these units times the lattice scale factors.
    // BASE grid on purpose: these are the GRID-UNIT sizes new pins get
    // (drop ghost, carry ghost, the pin button's default), and the record
    // writers that consume them work in base units too. The proportional
    // scale then applies to them exactly as it applies to every other item
    // on the board — scaling them here as well would double-count it.
    const { sx, sy } = v1ScaleFactors(grid)
    // Grid measurement config for RGL; identity keyed on the scalar params so
    // unrelated re-renders don't churn the grid's internal position memos
    const gridConfig = useMemo(() => ({
        cols: effGrid.columns,
        rowHeight: effGrid.rowHeight,
        margin: [effGrid.margin, effGrid.margin] as [number, number],
        containerPadding: [effGrid.padding, effGrid.padding] as [number, number],
    }), [effGrid.columns, effGrid.rowHeight, effGrid.margin, effGrid.padding])
    // Height of the grid content for the debug grid background, which must
    // cover the full grid height — it grows past the viewport when an item
    // extends below the fold. Comes from RGL's own root element rather than
    // the fixed-height container, observed so it follows resizes.
    const [gridContentHeight, setGridContentHeight] = useState(0)
    useEffect(() => {
        const el = gridAreaRef.current
        if (!el) return
        const gridEl = el.querySelector<HTMLElement>(".react-grid-layout")
        const measure = () => setGridContentHeight(
            Math.max(el.clientHeight, gridEl?.offsetHeight ?? 0)
        )
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        if (gridEl) ro.observe(gridEl)
        return () => ro.disconnect()
    }, [records, gridAreaRef])
    // BASE grid, never effGrid: the remount exists for grid-parameter
    // changes (the v1 -> v2 migration), and a key that followed the
    // proportional scale would remount the whole board on every resize pixel
    // — including the rounded effective values, which change constantly
    // while dragging a window edge.
    // Turning "Scale With Window" OFF bakes the scaled values into the base
    // grid, so it changes this key too and remounts once. The board's
    // geometry is unchanged across that remount (that is what the bake is
    // for); the mount fly-in it would replay is suppressed by the effect
    // below.
    const gridKey = `grid-${grid.columns}-${grid.rowHeight}-${grid.margin}-${grid.padding}`
    // Keep RGL's transitions off while HYDRATING only (see globals.css:
    // .rgl-mount-still): the SSR HTML paints items at percentage positions,
    // and RGL's switch to px transforms at mount would otherwise animate
    // every box flying in from the container origin — over positions the
    // user has been looking at since first paint. Scoped to hydration and
    // not to client-side mounts (opening the panel), where nothing has been
    // painted yet and the mount transition instead usefully smooths the
    // panel's settling; suppressing it there just trades the slide for a
    // flash of intermediate positions. Hydration is detected by a grid
    // already existing in the DOM at first render: only SSR puts one there
    // before this component renders (the pinboard's alternate tree is the
    // large-image view, which has no grid). The timeout (rather than rAF)
    // also settles hidden tabs, where rAF never fires.
    const [rglSettling, setRglSettling] = useState(
        () => typeof document === "undefined"
            || !!document.querySelector(".react-grid-layout")
    )
    useEffect(() => {
        if (!rglSettling) return
        const t = setTimeout(() => setRglSettling(false), 300)
        return () => clearTimeout(t)
    }, [rglSettling])
    // The same suppression, re-armed for the ONE remount a base-grid change
    // causes (gridKey above). RGL positions items in percentages until its
    // own mount effect flips to px transforms — on every mount, not just
    // hydration — so a remount replays the fly-in from the container
    // origin. That is a flash on two transitions documented as inert: the
    // OFF edge of "Scale With Window", which bakes the scaled values into
    // the base grid, and the explicit v1 -> v2 grid upgrade. RGL sets its
    // flag from a passive effect too, so this update batches into the same
    // commit and the class is on the element before the transform changes.
    const settledGridKey = useRef(gridKey)
    useEffect(() => {
        if (settledGridKey.current === gridKey) return
        settledGridKey.current = gridKey
        setRglSettling(true)
    }, [gridKey])
    const pinItem = usePinItem()
    // For the carry's free placement below, which appends a record itself
    // instead of routing through pinItem
    const galleryTrim = useGalleryTrim()
    // The board's own layout-actions instance shares the machinery the
    // context menu uses (autoLayout itself is declared above
    // onLayoutChange, next to the gesture auto-off that consumes it).
    const [autoLayoutCrop] = useGalleryPinAutoCrop()
    const [selectionCrop, setSelectionCrop] = useGalleryPinSelectionCrop()
    const {
        fillViewport, arrangeSelection, swapItems, autoCropSelection,
        clearAutoCropSelection, growSelection, mirrorSelection, shiftSelection,
        compressSelection,
        sendSelectionToRegion, sendSelectionToRect, transformSelection,
        orientSelection,
        changeLayout, fillViewportRows, justifyCurrentRows, autoCropToCells,
        clearAutoCrops, shiftLayout, mirrorLayout, rerollLayout, refitToView,
        reflowKeepProportions, uniformLayout, uniformSelection,
        growInPlace, hasLocks, hasAnchors,
        belowViewportKeys,
    } = usePinboardLayoutActions({
        layout, crops, autoCrops, locks: itemLocks, orients, highWater, float,
        uniform,
        cropKey,
        // Every packer and fit works in px against the RENDERED cell size,
        // so the layout verbs take the effective grid (their measurement
        // cache is keyed on it too, and drops when the scale changes)
        dbs, grid: effGrid,
        layoutAutoCrop: autoLayoutCrop,
        selectionAutoCrop: selectionCrop,
        pinboardRef: scrollAreaRef,
        onLayoutChange,
    })
    // Publish the board-global verbs for surfaces outside this subtree
    // (the pinboard tab's chevron menu, the fullscreen bar). One stable
    // object, mutated every render so readers always see current values
    // without the store notifying anyone; registered while mounted.
    const boardApiRef = useRef<PinboardBoardApi>({} as PinboardBoardApi)
    useEffect(() => {
        Object.assign(boardApiRef.current, {
            changeLayout, fillViewport, fillViewportRows, justifyCurrentRows,
            autoCropToCells, clearAutoCrops, shiftLayout, mirrorLayout,
            rerollLayout, refitToView, reflowKeepProportions, uniformLayout,
            growInPlace, hasLocks, hasAnchors,
            highWater, isV1, boardWidth: gridWidth, upgradeGrid,
            belowViewportCount: () => belowViewportKeys()?.length ?? null,
            removeBelowViewport: () => removePins(belowViewportKeys() ?? []),
        } satisfies PinboardBoardApi)
    })
    useEffect(() => {
        const api = boardApiRef.current
        usePinboardBoardApi.getState().register(api)
        return () => usePinboardBoardApi.getState().unregister(api)
    }, [])
    // Layout verbs report refusals (anchored items that can't travel,
    // size-locked items that can't fit, packer failures) as messages
    // instead of silently doing nothing — surface them as toasts (the
    // toast hook itself is declared above onLayoutChange)
    const runVerb = (label: string, result: Promise<string | null> | void) => {
        void Promise.resolve(result).then(err => {
            if (err) toast({ title: label, description: err, duration: 4000 })
        })
    }
    // Transient multi-selection, following file-manager conventions: plain
    // click selects just the clicked item, ctrl/cmd+click toggles items,
    // shift+click selects the reading-order range from the anchor (see
    // pinboardSelection.ts), and dragging from the board background — or
    // from anywhere with ctrl/shift held — rubber-band selects. Clicking
    // the background or anywhere outside the board deselects. Stale keys
    // are pruned whenever the board's records change (offsets shift on
    // add/remove).
    const selected = usePinSelection(s => s.selected)
    const selectedSet = useMemo(() => new Set(selected), [selected])
    useEffect(() => {
        usePinSelection.getState().prune(new Set(layout.map(l => l.i)))
    }, [layout])
    // Reading order for shift+click range selection — same y-overlap
    // grouping the layout actions use
    const readingOrder = useMemo(
        () => groupRowsByOverlap(layout).flat().map(l => l.i),
        [layout],
    )
    const rangeSelectTo = (key: string, additive: boolean) => {
        const sel = usePinSelection.getState()
        const anchor = sel.anchor && readingOrder.includes(sel.anchor) ? sel.anchor : null
        if (!anchor) {
            sel.replace([key], key)
            return
        }
        const a = readingOrder.indexOf(anchor)
        const b = readingOrder.indexOf(key)
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        const range = readingOrder.slice(lo, hi + 1)
        // Plain shift+click REPLACES the selection with the anchor..item
        // range — so shift+clicking inside the current range shrinks it
        // back to that point instead of doing nothing. Ctrl+shift+click
        // adds the range to the existing selection. The anchor stays put
        // either way; only plain clicks and ctrl+clicks rebase it.
        sel.replace(additive ? union(sel.selected, range) : range, anchor)
    }
    // ---- Hole targeting -------------------------------------------------
    // Three gestures share the HoleTargetOverlay: the Move to Hole verb
    // (move the selection into a hole), sticky carry (shift+click a
    // gallery pin button, drop by clicking the board) and shift-held
    // external drags. This block owns the mode state, the hole geometry
    // the overlay renders from, and the commit writes.
    const [holeVerb, setHoleVerb] = useState(false)
    const carrySha = usePinboardCarry(s => s.sha256)
    const holeRequest = usePinboardCarry(s => s.holeRequest)
    // Cursor of a shift-held HTML5 drag over the board, in container px
    const [dragHole, setDragHole] = useState<{ x: number, y: number } | null>(null)
    const holeMode: "verb" | "carry" | "drag" | null =
        carrySha ? "carry" : holeVerb ? "verb" : dragHole ? "drag" : null
    // For the board's own Esc handler: targeting owns Esc while active
    const holeActiveRef = useRef(false)
    holeActiveRef.current = holeMode !== null
    // Register with the carry store so shift+click pin buttons know a
    // carry has somewhere to land; unmounting drops any carry in flight
    useEffect(() => {
        usePinboardCarry.getState().setBoardMounted(true)
        return () => {
            usePinboardCarry.getState().setBoardMounted(false)
            usePinboardCarry.getState().cancel()
        }
    }, [])
    // Free-mask bound in grid rows: the fold or the ratchet, whichever is
    // deeper — the same committed rectangle every fill verb targets. Holes
    // are uncovered cells of THAT rectangle only: a bottom-open hole ends
    // at the board's committed bottom instead of stretching down into the
    // below-fold staging band (a cutting board of parked items would
    // otherwise turn every bottom hole into a full-depth sliver and
    // conforming placements into stretched strips). The staging band has
    // no holes by definition; it stays reachable via free placement
    // (carry without Shift, normal drag-and-drop).
    const holeRows = useMemo(() => {
        if (!holeMode) return 0
        const areaH = gridAreaRef.current?.clientHeight ?? 0
        const fold = Math.max(1, Math.floor(
            (areaH - 2 * effGrid.padding + effGrid.margin) / rowStep(effGrid)))
        return Math.max(highWater, fold)
    }, [holeMode, highWater, effGrid, gridAreaRef])
    // Occupancy for the free mask. The verb MOVES the selection, so it
    // counts as lifted — its own cells are free to land back onto (e.g.
    // merging with an adjacent hole). Carried/dragged items are new;
    // everything on the board is solid for them.
    const holeOccupied = useMemo(() => {
        if (!holeMode) return []
        const lifted = holeMode === "verb" ? selectedSet : null
        return layout
            .filter(l => !lifted?.has(l.i))
            .map(l => ({ x: l.x, y: l.y, w: l.w, h: l.h }))
    }, [holeMode, layout, selectedSet])
    const holeRects = useMemo(
        () => holeMode ? maximalFreeRects(holeOccupied, grid.columns, holeRows) : [],
        [holeMode, holeOccupied, grid.columns, holeRows])
    // Feasibility, kept light — the placement itself re-checks exactly and
    // toasts. For the verb: every size-locked item must fit at its exact
    // size and the rect must have room for everyone at minimum size; for
    // single-item drops just the minimum pin size.
    const holeColW = (gridWidth - 2 * effGrid.padding
        - (effGrid.columns - 1) * effGrid.margin) / effGrid.columns
    const { minW: holeMinW, minH: holeMinH } = minPinUnits(effGrid, holeColW)
    const validHole = (r: GridRect): boolean => {
        if (holeMode !== "verb") return r.w >= holeMinW && r.h >= holeMinH
        const sel = layout.filter(l => selectedSet.has(l.i))
        const travellers = sel.filter(l => itemLocks[l.i] === "size")
        const flexible = sel.filter(l => !itemLocks[l.i])
        if (!travellers.every(t => t.w <= r.w && t.h <= r.h)) return false
        if (flexible.length > 0 && (r.w < holeMinW || r.h < holeMinH)) return false
        const need = travellers.reduce((a, t) => a + t.w * t.h, 0)
            + flexible.length * holeMinW * holeMinH
        return r.w * r.h >= need
    }
    const validFree = (r: GridRect): boolean =>
        !layout.some(l => itemLocks[l.i] === "anchor"
            && rectsOverlap({ x: l.x, y: l.y, w: l.w, h: l.h }, r))
    // Verb entry: anchored items can't travel — refuse up front, same
    // policy and strings as Send to Region
    const enterHoleTarget = () => {
        const anchoredCount = selected.filter(k => itemLocks[k] === "anchor").length
        if (anchoredCount > 0) {
            toast({
                title: "Move to Hole",
                description: anchoredCount === 1
                    ? "An anchored item is selected — unanchor or deselect it first"
                    : `${anchoredCount} anchored items are selected — unanchor or deselect them first`,
                duration: 4000,
            })
            return
        }
        setHoleVerb(true)
    }
    // The context menu requests targeting through the store — it lives in
    // a distant subtree (per-pin popper) with no prop path to this state
    const holeRequestSeen = useRef(holeRequest)
    useEffect(() => {
        if (holeRequest === holeRequestSeen.current) return
        holeRequestSeen.current = holeRequest
        enterHoleTarget()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [holeRequest])
    // Targeting is FOR the selection: it can't outlive it
    useEffect(() => {
        if (selected.length === 0) setHoleVerb(false)
    }, [selected.length])
    const holeToast = (msg: string) => toast({
        title: holeMode === "verb" ? "Move to Hole" : "Place",
        description: msg,
        duration: 4000,
    })
    // Carry free placement: the new pin claims the rect and whatever it
    // lands on drops straight down below it (the same cascade Send to
    // Region uses for evictees) — one record write, so one history entry.
    const placeCarryFree = (sha256: string, r: GridRect) => {
        const overlapped = layout
            .filter(l => rectsOverlap({ x: l.x, y: l.y, w: l.w, h: l.h }, r))
            .sort((a, b) => a.y - b.y || a.x - b.x)
        const evictKeys = new Set(overlapped.map(l => l.i))
        const solid: GridRect[] = layout
            .filter(l => !evictKeys.has(l.i))
            .map(l => ({ x: l.x, y: l.y, w: l.w, h: l.h }))
        solid.push({ ...r })
        const moves = new Map<string, number>()
        for (const l of overlapped) {
            const probe = { x: l.x, y: r.y + r.h, w: l.w, h: l.h }
            for (; ;) {
                const hit = solid.find(o => rectsOverlap(probe, o))
                if (!hit) break
                probe.y = hit.y + hit.h
            }
            moves.set(l.i, probe.y)
            solid.push(probe)
        }
        markPinboardExplicitPlacement()
        updateRecords((prev) => {
            const next = [...prev]
            for (const [key, y] of moves) {
                const offset = parseInt(key.split("-")[0])
                next[offset + 2] = y.toString()
            }
            return [
                ...next,
                sha256.slice(0, 10),
                r.x.toString(), r.y.toString(), r.w.toString(),
                newPinHField(r.h, sha256, galleryTrim),
            ]
        })
    }
    const onHoleCommit = (r: GridRect, kind: "hole" | "free") => {
        if (holeMode === "verb") {
            void sendSelectionToRect(selected, r).then(err => {
                if (err) holeToast(err)
                else setHoleVerb(false)
            })
            return
        }
        if (holeMode === "carry" && carrySha) {
            if (kind === "hole") {
                markPinboardExplicitPlacement()
                pinItem.pinItem(carrySha, r)
            } else {
                placeCarryFree(carrySha, r)
            }
            usePinboardCarry.getState().cancel()
        }
    }
    // Sticky-carry chrome: the thumbnail riding the cursor, plus the
    // cancel gestures that land outside the overlay — Esc, right-click
    // anywhere, and clicks that miss the board entirely (a drop has to
    // land ON the board). Clicks on pin buttons are exempt: shift+click
    // on another button re-starts the carry with that image.
    const [carryPoint, setCarryPoint] = useState<{ x: number, y: number } | null>(null)
    useEffect(() => {
        if (!carrySha) { setCarryPoint(null); return }
        const cancel = () => usePinboardCarry.getState().cancel()
        const onMove = (e: PointerEvent) => setCarryPoint({ x: e.clientX, y: e.clientY })
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancel() }
        const onCtx = (e: MouseEvent) => { e.preventDefault(); cancel() }
        const onClick = (e: MouseEvent) => {
            const t = e.target as HTMLElement | null
            if (t?.closest?.("[data-hole-overlay], [data-pin-carry]")) return
            cancel()
        }
        window.addEventListener("pointermove", onMove)
        window.addEventListener("keydown", onKey)
        window.addEventListener("contextmenu", onCtx)
        window.addEventListener("click", onClick)
        return () => {
            window.removeEventListener("pointermove", onMove)
            window.removeEventListener("keydown", onKey)
            window.removeEventListener("contextmenu", onCtx)
            window.removeEventListener("click", onClick)
        }
    }, [carrySha])
    // ---- Scale & Move session -------------------------------------------
    // The group-transform modal (see PinboardTransformOverlay): while it
    // runs, the overlay owns the board's pointer and the selection toolbar
    // stands down (its automatic anchor hangs exactly where the bbox's top
    // handles sit). The session is FOR the selection the same way hole
    // targeting is: any selection change ends it.
    const [transformOn, setTransformOn] = useState(false)
    const transformActiveRef = useRef(false)
    transformActiveRef.current = transformOn
    // True while a session gesture is in flight: the grid wears the
    // transition-disable class (globals.css) so the imperative preview
    // isn't smeared by RGL's 200ms transitions
    const [transformGesture, setTransformGesture] = useState(false)
    // Entry checks mirror the other selection verbs' precedents: anchors
    // grey the verb statically (noAnchors — but the context-menu path
    // can't grey, so the check re-runs here with the hole verb's toast
    // strings), size locks refuse with a counting toast the way the
    // rotations do — a scale resizes every member, which is exactly what
    // the lock forbids.
    const enterTransform = () => {
        if (cropKey !== null || selected.length < 2) return
        const anchoredCount = selected.filter(k => itemLocks[k] === "anchor").length
        if (anchoredCount > 0) {
            toast({
                title: "Scale & Move",
                description: anchoredCount === 1
                    ? "An anchored item is selected — unanchor or deselect it first"
                    : `${anchoredCount} anchored items are selected — unanchor or deselect them first`,
                duration: 4000,
            })
            return
        }
        const sizeLockedCount = selected.filter(k => itemLocks[k] === "size").length
        if (sizeLockedCount > 0) {
            toast({
                title: "Scale & Move",
                description: sizeLockedCount === 1
                    ? "A size-locked item is selected — unlock or deselect it first"
                    : `${sizeLockedCount} size-locked items are selected — unlock or deselect them first`,
                duration: 4000,
            })
            return
        }
        setTransformOn(true)
    }
    // The context menu requests the session through the carry store, the
    // same channel as its Move to Hole row (no prop path from the per-pin
    // popper to this state)
    const transformRequest = usePinboardCarry(s => s.transformRequest)
    const transformRequestSeen = useRef(transformRequest)
    useEffect(() => {
        if (transformRequest === transformRequestSeen.current) return
        transformRequestSeen.current = transformRequest
        enterTransform()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transformRequest])
    // The session is FOR the selection: any change to it — including the
    // prune after a removal — ends the session (every mutator hands the
    // store a fresh array, so identity is the change signal)
    useEffect(() => {
        setTransformOn(false)
    }, [selected])
    // Crop mode is its own modal session; the two never overlap
    useEffect(() => {
        if (cropKey !== null) setTransformOn(false)
    }, [cropKey])
    // The selected items' resting rects in content px — what the overlay
    // draws its bbox from and restores the preview to
    const transformItems: TransformPxRect[] | null = useMemo(() => {
        if (!transformOn || !gridWidth) return null
        const colW = (gridWidth - 2 * effGrid.padding
            - (effGrid.columns - 1) * effGrid.margin) / effGrid.columns
        const unitX = colW + effGrid.margin
        const stepY = rowStep(effGrid)
        return layout
            .filter(l => selectedSet.has(l.i) && !l.i.endsWith("__preview"))
            .map(l => ({
                key: l.i,
                l: effGrid.padding + l.x * unitX,
                t: effGrid.padding + l.y * stepY,
                w: l.w * unitX - effGrid.margin,
                h: l.h * stepY - effGrid.margin,
            }))
    }, [transformOn, gridWidth, layout, selectedSet, effGrid])
    // Snap one released gesture onto the lattice and commit it as a verb
    // write. Returns false when the snap changes nothing — the overlay
    // then restores its preview instead of waiting for a write.
    const commitTransform = (rects: TransformPxRect[], kind: "move" | "scale",
        scale?: TransformScale): boolean => {
        const unitX = holeColW + effGrid.margin
        const stepY = rowStep(effGrid)
        const pad = effGrid.padding
        const byKey = new Map(layout.map(l => [l.i, l]))
        const out: Record<string, GridRect> = {}
        if (kind === "move") {
            // One integer delta for the whole group, from any member: the
            // relative geometry survives the snap exactly
            const first = rects[0]
            const cur0 = first && byKey.get(first.key)
            if (!cur0) return false
            const members = rects.flatMap(r => byKey.get(r.key) ?? [])
            let dgx = Math.round((first.l - (pad + cur0.x * unitX)) / unitX)
            let dgy = Math.round((first.t - (pad + cur0.y * stepY)) / stepY)
            const minX = Math.min(...members.map(l => l.x))
            const maxX2 = Math.max(...members.map(l => l.x + l.w))
            const minY = Math.min(...members.map(l => l.y))
            dgx = Math.max(-minX, Math.min(dgx, effGrid.columns - maxX2))
            dgy = Math.max(-minY, dgy)
            if (dgx === 0 && dgy === 0) return false
            for (const l of members) {
                out[l.i] = { x: l.x + dgx, y: l.y + dgy, w: l.w, h: l.h }
            }
        } else {
            // Scale: map each member's INTEGER lattice edges about the
            // anchor's lattice edge and round. A shared edge is the same
            // integer on both sides, the map is monotone, and monotone
            // rounding preserves order — so flush members stay flush
            // EXACTLY and no scale can round two members into each other.
            // The previous px-edge snap could: the margins between items
            // scale with the group while the snap added the unscaled
            // margin, so on shrinks two flush px edges drifted apart by
            // the scaled-margin delta and could round one unit INTO the
            // neighbour, which the eviction pass then "fixed" by dropping
            // a member below the group (the reported intra-group shuffle).
            if (!scale) return false
            const { minW, minH } = minPinUnits(effGrid, holeColW)
            const members = rects.flatMap(r => byKey.get(r.key) ?? [])
            if (members.length === 0) return false
            // The anchor edge is a member edge, so both are exact integers
            const axL = scale.handle.includes("w")
                ? Math.max(...members.map(l => l.x + l.w))
                : Math.min(...members.map(l => l.x))
            const ayL = scale.handle.includes("n")
                ? Math.max(...members.map(l => l.y + l.h))
                : Math.min(...members.map(l => l.y))
            const mapped = members.map(l => ({
                l,
                x: Math.round(axL + scale.sx * (l.x - axL)),
                x2: Math.round(axL + scale.sx * (l.x + l.w - axL)),
                y: Math.round(ayL + scale.sy * (l.y - ayL)),
                y2: Math.round(ayL + scale.sy * (l.y + l.h - ayL)),
            }))
            // Board bounds as UNIFORM group shifts: a per-item clamp could
            // fold an edge member onto its neighbour. The overlay's px
            // clamps keep any excursion to a unit of rounding slack.
            const dx = -Math.max(0,
                Math.max(...mapped.map(m => m.x2)) - effGrid.columns)
            const dy = Math.max(0, -Math.min(...mapped.map(m => m.y)))
            let changed = false
            for (const m of mapped) {
                const x = Math.max(0, m.x + dx)
                let w = Math.max(1, Math.min(m.x2 + dx, effGrid.columns) - x)
                const y = m.y + dy
                let h = Math.max(1, m.y2 + dy - y)
                // The mutation-time size floor (see minPinUnits), guarded
                // per axis so a gesture that left an axis alone (or a
                // legacy sub-minimum member the clamp held at scale 1)
                // never grows: the scale clamp keeps every SCALED size at
                // or above the floor already, so a firing floor here is
                // pure rounding slack.
                if (w < minW && w < m.l.w) w = Math.min(minW, effGrid.columns)
                if (h < minH && h < m.l.h) h = minH
                const fx = Math.min(x, effGrid.columns - w)
                out[m.l.i] = { x: fx, y, w, h }
                if (fx !== m.l.x || y !== m.l.y || w !== m.l.w || h !== m.l.h)
                    changed = true
            }
            if (!changed) return false
        }
        runVerb("Scale & Move", transformSelection(selected, out))
        return true
    }
    // ---------------------------------------------------------------------
    // Floating toolbar placement, in CONTENT coordinates (it scrolls with
    // the board, staying glued to the selection). The bar hangs just above
    // the selection's bounding box — except with exactly two items at
    // different heights, where it hangs above the LOWER item's top edge:
    // a two-item bbox is mostly empty diagonal space, and two items are
    // usually selected to swap, so the seam between them is where the
    // mouse is.
    //
    // FLIP BELOW: when EVERY selected item is against the board's top
    // edge, the bar goes below the selection's bottom edge instead of
    // being clamped over its top — the old clamp smeared it across the
    // pin/crop/anchor/lock overlay buttons that live at a pin's top edge.
    // "Against the top" is fit-based, not y === 0: an item counts iff a
    // bar cannot hang above IT (py(l.y) < EDGE + h + GAP). A v2 row is
    // 10px, so items at y = 1..3 sit inside that same smear strip and a
    // literal y === 0 test would miss them; the threshold tracks the
    // measured bar height like the rest of this math. The "every"
    // quantifier is deliberate: a mixed selection reaching lower rows
    // would put a below-the-bbox bar far from the action, so it keeps the
    // above/clamp behavior. The flip also wins BEFORE the two-item seam
    // rule — both items against the top means there is no usable seam.
    //
    // FITS-OR-FALL-BACK: the flip is taken only when the below position
    // fully clears the selection inside the VISIBLE viewport, i.e. is at
    // or above scrollTop + clientHeight - h - EDGE (one-shot read of the
    // scroll viewport at placement time — the bar stays in content
    // coordinates and scrolls with the board afterwards; this memo does
    // not re-run on scroll, by design). That spot routinely sits below
    // clampPos's content-bottom cap, since the flip fires precisely on
    // boards whose content ends near the selection — so the cap itself is
    // relaxed to `max(content bottom, viewport bottom)` rather than being
    // bypassed for the flip alone. A bar may legitimately hang past the
    // last row into empty board space, and the manual park and the
    // release snap below share that same envelope, so a flipped bar can be
    // nudged sideways without jumping back over the selection. If the
    // below spot can't clear the selection (an item filling the whole
    // view), the flip is not taken at all and the existing top placement
    // applies unchanged: covering the top beats hovering over the video
    // timeline and loop controls at a pin's bottom edge.
    const toolbarRef = useRef<HTMLDivElement | null>(null)
    const [toolbarSize, setToolbarSize] = useState({ w: 320, h: 34 })
    // ResizeObserver rather than a one-shot measure: the bar's width also
    // changes while mounted (verbs pinned/unpinned from its dropdown), and
    // the clamping math must always work with the real size
    useEffect(() => {
        const el = toolbarRef.current
        if (!el) return
        const measure = () => {
            const w = el.offsetWidth
            const h = el.offsetHeight
            setToolbarSize(s => (s.w === w && s.h === h) ? s : { w, h })
        }
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        return () => ro.disconnect()
    }, [selected.length > 0])
    // Manually parked position (from the drag grip). Any change to the
    // selection SET discards it and the automatic anchor takes over; pure
    // layout changes of the same selection keep it — the user moved the
    // bar out of the way on purpose, snapping it back mid-workflow would
    // re-cover whatever they moved it away from.
    const [toolbarManual, setToolbarManual] = useState<{ x: number; y: number } | null>(null)
    const selKey = useMemo(() => [...selected].sort().join("|"), [selected])
    useEffect(() => { setToolbarManual(null) }, [selKey])
    // Anchored off the layout memo, which only updates when the record write
    // lands at gesture end: with a non-'se' handle (west/north edges move the
    // box's own origin) the bar visually detaches from the selection until
    // release. Cosmetic, and accepted.
    const toolbarPos = useMemo(() => {
        if (selected.length === 0 || !gridWidth) return null
        const colW = (gridWidth - 2 * effGrid.padding - (effGrid.columns - 1) * effGrid.margin) / effGrid.columns
        const unitX = colW + effGrid.margin
        const px = (x: number) => effGrid.padding + x * unitX
        const py = (y: number) => effGrid.padding + y * rowStep(effGrid)
        const maxY = layout.reduce((acc, l) => Math.max(acc, l.y + l.h), 0)
        // Radix scrolls the viewport child, not the root the ref is on; its
        // scroll coordinates are this content space (the grid area is the
        // viewport's content, at offset 0). One-shot read at placement
        // time — the bar stays in content coordinates and scrolls with the
        // board afterwards; this memo does not re-run on scroll, by design.
        // No viewport element = nothing to measure against = the viewport
        // relaxation below contributes nothing (-Infinity).
        const view = scrollAreaRef.current
            ?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]")
        const viewportCapY = view
            ? view.scrollTop + view.clientHeight - toolbarSize.h - TOOLBAR_EDGE
            : -Infinity
        // The bar never leaves the board: x within the inner width, y
        // between the top edge and the LOWER of two caps — the bottom of
        // the board's content, or the bottom of the currently visible
        // viewport. A bar may legitimately hang past the last row into
        // empty board space (that is exactly what the flip below does on a
        // short board), so the content cap alone is too tight; the viewport
        // cap keeps such a bar on screen. Reachability envelope = content
        // bottom OR visible viewport, whichever is lower.
        //
        // Behavior-neutral for the automatic anchor: its y = py(l.y) - GAP
        // - h sits at least rowStep + GAP - margin - EDGE ABOVE the content
        // cap (a selected item's y + h <= maxY), and rowStep + GAP > margin
        // + EDGE on both grids (v1 66 > 14, v2 16 > 9). Only manual parks
        // and the flip can reach the relaxed zone.
        const clampPos = (x: number, y: number) => ({
            x: Math.min(
                Math.max(x, TOOLBAR_EDGE),
                Math.max(TOOLBAR_EDGE, gridWidth - toolbarSize.w - TOOLBAR_EDGE)),
            y: Math.min(
                Math.max(y, TOOLBAR_EDGE),
                Math.max(TOOLBAR_EDGE, Math.max(
                    py(maxY) - effGrid.margin - toolbarSize.h - TOOLBAR_EDGE,
                    viewportCapY))),
        })
        // Manual park runs through the same relaxed cap as the flip, so
        // grabbing the grip while the bar is in a flipped position does not
        // yank it up by GAP + h + EDGE and refuse to be dragged back down.
        if (toolbarManual) return clampPos(toolbarManual.x, toolbarManual.y)
        const rects = layout.filter(l => selectedSet.has(l.i))
        if (rects.length === 0) return null
        const bboxCenterX = () => {
            const x0 = Math.min(...rects.map(l => l.x))
            const x1 = Math.max(...rects.map(l => l.x + l.w))
            return (px(x0) + px(x1) - effGrid.margin) / 2
        }
        // Flip below a wholly top-edge selection, when it fits (see above).
        // No viewport element = viewportCapY is -Infinity = nothing to fit
        // against = no flip.
        if (rects.every(l => py(l.y) < TOOLBAR_EDGE + toolbarSize.h + TOOLBAR_GAP)) {
            const y1 = Math.max(...rects.map(l => l.y + l.h))
            const flipY = py(y1) - effGrid.margin + TOOLBAR_GAP
            if (flipY <= viewportCapY) {
                // Both axes go through clampPos: the fits gate IS
                // `flipY <= viewportCapY`, so the relaxed y cap passes it
                // through untouched (it is the max of that and the content
                // cap). Uniform with every other return here.
                return clampPos(bboxCenterX() - toolbarSize.w / 2, flipY)
            }
        }
        let anchorTop: number
        let centerX: number
        if (rects.length === 2 && rects[0].y !== rects[1].y) {
            const lower = rects[0].y > rects[1].y ? rects[0] : rects[1]
            anchorTop = py(lower.y)
            centerX = px(lower.x) + (lower.w * unitX - effGrid.margin) / 2
        } else {
            anchorTop = py(Math.min(...rects.map(l => l.y)))
            centerX = bboxCenterX()
        }
        return clampPos(centerX - toolbarSize.w / 2, anchorTop - TOOLBAR_GAP - toolbarSize.h)
    }, [selected.length, toolbarManual, layout, selectedSet, gridWidth, effGrid, toolbarSize])
    // Dragging the grip moves the bar freely; on release it snaps
    // vertically to the nearest resting spot — just above an item's top
    // edge, just below an item's bottom edge (the automatic anchor rests
    // there too, since the top-edge flip), or pinned below the board's
    // top — so a parked bar sits at the same kind of place the automatic
    // anchor picks. Only items the bar horizontally overlaps at its drop
    // position count as snap targets: an edge on the far side of the
    // board is not a visible line here, and snapping to it would park the
    // bar at a seemingly random height through the middle of whatever it
    // IS over. Horizontal stays wherever it was dropped (clamped to the
    // board). Vertically the snap shares the renderer's reachability
    // envelope (content bottom OR visible viewport, whichever is lower),
    // so every spot it picks survives the next clampPos unchanged.
    const onToolbarGripDown = (e: React.PointerEvent) => {
        if (e.button !== 0) return
        const area = gridAreaRef.current
        const bar = toolbarRef.current
        if (!area || !bar) return
        e.preventDefault()
        e.stopPropagation()
        const barRect = bar.getBoundingClientRect()
        const dx = e.clientX - barRect.left
        const dy = e.clientY - barRect.top
        const posFrom = (ev: PointerEvent) => {
            const aRect = area.getBoundingClientRect()
            return { x: ev.clientX - aRect.left - dx, y: ev.clientY - aRect.top - dy }
        }
        const onMove = (ev: PointerEvent) => setToolbarManual(posFrom(ev))
        const onUp = (ev: PointerEvent) => {
            window.removeEventListener("pointermove", onMove)
            window.removeEventListener("pointerup", onUp)
            const raw = posFrom(ev)
            const colW = (gridWidth - 2 * effGrid.padding - (effGrid.columns - 1) * effGrid.margin) / effGrid.columns
            const unitX = colW + effGrid.margin
            const px = (x: number) => effGrid.padding + x * unitX
            const py = (y: number) => effGrid.padding + y * rowStep(effGrid)
            // The bar's resting x-span (clamped like the renderer clamps),
            // for the horizontal-overlap test
            const xl = Math.min(
                Math.max(raw.x, TOOLBAR_EDGE),
                Math.max(TOOLBAR_EDGE, gridWidth - toolbarSize.w - TOOLBAR_EDGE))
            const xr = xl + toolbarSize.w
            // Below-edge candidates are held to the renderer's own y cap: a
            // spot clampPos would immediately drag back up over the item is
            // not a resting spot. That cap is the RELAXED one — content
            // bottom or visible viewport bottom, whichever is lower — so
            // the below-the-last-row spot still exists on short boards,
            // which is exactly where the flip fires; with the content cap
            // alone the nearest surviving candidate was TOOLBAR_EDGE and
            // the bar parked over the very overlay buttons this placement
            // exists to uncover. Fresh viewport read: this is a release
            // handler, so the board may have been scrolled since placement.
            // An accepted b satisfies EDGE <= b <= belowCap, so the
            // renderer's clampPos leaves it exactly where it was dropped.
            const maxY = layout.reduce((acc, l) => Math.max(acc, l.y + l.h), 0)
            const view = scrollAreaRef.current
                ?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]")
            const belowCap = Math.max(
                py(maxY) - effGrid.margin - toolbarSize.h - TOOLBAR_EDGE,
                view ? view.scrollTop + view.clientHeight - toolbarSize.h - TOOLBAR_EDGE : -Infinity)
            let best = TOOLBAR_EDGE
            for (const l of layout) {
                if (px(l.x) >= xr || px(l.x + l.w) - effGrid.margin <= xl) continue
                const c = py(l.y) - TOOLBAR_GAP - toolbarSize.h
                if (c >= TOOLBAR_EDGE && Math.abs(c - raw.y) < Math.abs(best - raw.y)) best = c
                const b = py(l.y + l.h) - effGrid.margin + TOOLBAR_GAP
                if (b >= TOOLBAR_EDGE && b <= belowCap
                    && Math.abs(b - raw.y) < Math.abs(best - raw.y)) best = b
            }
            setToolbarManual({ x: raw.x, y: best })
        }
        window.addEventListener("pointermove", onMove)
        window.addEventListener("pointerup", onUp)
    }
    // Active lock badges (the pin/size toggles of LOCKED items) are shown
    // while the user is interacting with the board — hovering over any pin
    // — and linger for a grace period after the pointer leaves before
    // fading, so locks are visible at a glance during layout work without
    // the badges permanently sitting over the images while just viewing.
    // Inactive lock toggles stay per-item hover-reveal like the other
    // overlay buttons.
    const [lockBadgesVisible, setLockBadgesVisible] = useState(false)
    const lockBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const onBoardHover = () => {
        if (lockBadgeTimerRef.current) clearTimeout(lockBadgeTimerRef.current)
        lockBadgeTimerRef.current = null
        setLockBadgesVisible(true)
    }
    const onBoardHoverEnd = () => {
        if (lockBadgeTimerRef.current) clearTimeout(lockBadgeTimerRef.current)
        lockBadgeTimerRef.current = setTimeout(() => setLockBadgesVisible(false), 2500)
    }
    useEffect(() => () => {
        if (lockBadgeTimerRef.current) clearTimeout(lockBadgeTimerRef.current)
    }, [])
    // Marquee (rubber-band) drag-select. Armed by pointerdown on the board
    // background, or anywhere — including on top of items — with ctrl or
    // shift held (which is also what keeps RGL from starting an item
    // drag). Live-updates the selection while dragging: a plain marquee
    // replaces the selection outright (the background press already
    // cleared it), a modifier marquee unions its hits with the selection
    // it started from, which is how several rectangular areas can be
    // gathered one after the other. An item counts as hit once the
    // marquee reaches its central 50% region — grazing an edge is not
    // enough.
    const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
    const marqueeRef = useRef<{
        startX: number
        startY: number
        lastClientX: number
        lastClientY: number
        active: boolean
        raf: number
        update: () => void
        onMove: (e: PointerEvent) => void
        onUp: () => void
        onScroll: () => void
    } | null>(null)
    const endMarquee = () => {
        const m = marqueeRef.current
        if (!m) return
        window.removeEventListener("pointermove", m.onMove)
        window.removeEventListener("pointerup", m.onUp)
        document.removeEventListener("scroll", m.onScroll, true)
        if (m.raf) cancelAnimationFrame(m.raf)
        marqueeRef.current = null
        setMarquee(null)
    }
    const endMarqueeRef = useRef(endMarquee)
    endMarqueeRef.current = endMarquee
    useEffect(() => () => endMarqueeRef.current(), [])
    // How close (px) to the scroll viewport's edge the pointer must be to
    // auto-scroll the board, and the max px per frame it scrolls
    const MARQUEE_SCROLL_EDGE = 40
    const MARQUEE_SCROLL_MAX = 24
    const beginMarquee = (start: { clientX: number; clientY: number }, additive: boolean) => {
        endMarquee()
        const area = gridAreaRef.current
        if (!area) return
        const sel = usePinSelection.getState()
        const base = additive ? sel.selected : []
        const baseAnchor = additive ? sel.anchor : null
        const startRect = area.getBoundingClientRect()
        // The scrolling element, for edge auto-scroll (Radix puts the
        // scrollbars on the root; the viewport child is what scrolls)
        const viewport = scrollAreaRef.current
            ?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]")
        const m = {
            // The press point in CONTENT coordinates (relative to the grid
            // area). Client coords would detach the rectangle's origin from
            // the board the moment it scrolls mid-drag: the origin would
            // ride the viewport instead of the content, sliding the whole
            // selection up and dropping everything scrolled past.
            startX: start.clientX - startRect.left,
            startY: start.clientY - startRect.top,
            lastClientX: start.clientX,
            lastClientY: start.clientY,
            active: false,
            raf: 0,
            // Recompute rectangle, overlay and hits from the anchored start
            // and the latest pointer position — called on pointer moves AND
            // on scrolls, which move the content under a resting pointer
            update: () => {
                if (!gridAreaRef.current || marqueeRef.current !== m) return
                const areaRect = gridAreaRef.current.getBoundingClientRect()
                // The press point's CURRENT client position
                const sx = m.startX + areaRect.left
                const sy = m.startY + areaRect.top
                // Same threshold as the click movement guard below, so a
                // modifier press-and-release is a click XOR a marquee
                if (!m.active && Math.hypot(m.lastClientX - sx, m.lastClientY - sy) <= 5) return
                m.active = true
                const left = Math.min(sx, m.lastClientX)
                const top = Math.min(sy, m.lastClientY)
                const right = Math.max(sx, m.lastClientX)
                const bottom = Math.max(sy, m.lastClientY)
                setMarquee({ x: left - areaRect.left, y: top - areaRect.top, w: right - left, h: bottom - top })
                const hits: string[] = []
                for (const el of gridAreaRef.current.querySelectorAll<HTMLElement>("[data-pin-key]")) {
                    const key = el.dataset.pinKey
                    if (!key || key.endsWith("__preview")) continue
                    const r = el.getBoundingClientRect()
                    const ix = r.width / 4
                    const iy = r.height / 4
                    if (left < r.right - ix && right > r.left + ix
                        && top < r.bottom - iy && bottom > r.top + iy) hits.push(key)
                }
                hits.sort((a, b) => readingOrder.indexOf(a) - readingOrder.indexOf(b))
                usePinSelection.getState().replace(union(base, hits), baseAnchor ?? hits[0] ?? null)
            },
            onMove: (e: PointerEvent) => {
                if (marqueeRef.current !== m) return
                m.lastClientX = e.clientX
                m.lastClientY = e.clientY
                m.update()
                // Edge auto-scroll, file-manager style: dragging near the
                // top/bottom of the scroll viewport keeps scrolling frame by
                // frame while the pointer stays there (the loop re-checks)
                if (m.active && !m.raf && viewport) m.raf = requestAnimationFrame(step)
            },
            onUp: () => endMarqueeRef.current(),
            // Wheel- or bar-scrolling mid-drag also moves the content under
            // the pointer (capture: scroll events don't bubble)
            onScroll: () => m.update(),
        }
        const step = () => {
            m.raf = 0
            if (marqueeRef.current !== m || !viewport) return
            const vr = viewport.getBoundingClientRect()
            let dy = 0
            if (m.lastClientY > vr.bottom - MARQUEE_SCROLL_EDGE) {
                dy = Math.min(MARQUEE_SCROLL_MAX, (m.lastClientY - (vr.bottom - MARQUEE_SCROLL_EDGE)) / 2)
            } else if (m.lastClientY < vr.top + MARQUEE_SCROLL_EDGE) {
                dy = -Math.min(MARQUEE_SCROLL_MAX, ((vr.top + MARQUEE_SCROLL_EDGE) - m.lastClientY) / 2)
            }
            if (dy === 0) return
            const before = viewport.scrollTop
            viewport.scrollTop += dy
            if (viewport.scrollTop === before) return // hit the end
            m.update()
            m.raf = requestAnimationFrame(step)
        }
        marqueeRef.current = m
        window.addEventListener("pointermove", m.onMove)
        window.addEventListener("pointerup", m.onUp)
        document.addEventListener("scroll", m.onScroll, true)
    }
    const beginMarqueeRef = useRef(beginMarquee)
    beginMarqueeRef.current = beginMarquee
    // The grid's own padding is only a few px, so "drag from outside the
    // items" needs more surface: presses landing on the surrounding
    // gallery panel's frame (its padding and the gaps around the board,
    // tagged data-pinboard-frame in ImageGallery) arm the marquee too.
    // Only presses hitting the frame element ITSELF qualify — anything
    // inside the header, the thumbnail strip or other panel children
    // handles its own events and never targets the frame directly.
    // In fullscreen the board effectively IS the screen, so the surface
    // widens to the whole viewport: any press not claimed by the board
    // itself (whose background handler already arms), a pin, an overlay
    // control or a floating panel starts a marquee. The maximized search
    // overlay is one of those panels: a press on its own padding must not
    // rubber-band the board underneath it
    // (docs/maximized-pinboard-search-overlay-design.md §7).
    useEffect(() => {
        const onDown = (e: PointerEvent) => {
            if (e.button !== 0) return
            const t = e.target as HTMLElement | null
            if (!t) return
            const onFrame = t.hasAttribute?.("data-pinboard-frame")
            const fromViewport = fs && !isInteractiveTarget(t) && !t.closest?.(
                '[data-pinboard-area], [data-pin-key], [data-selection-toolbar],'
                + ' [data-pinboard-history], [data-search-overlay],'
                + ' [data-radix-popper-content-wrapper],'
                + ' [role="menu"], [role="dialog"]'
            )
            if (!onFrame && !fromViewport) return
            e.preventDefault()
            beginMarqueeRef.current(e, e.ctrlKey || e.metaKey || e.shiftKey)
        }
        document.addEventListener("pointerdown", onDown)
        return () => document.removeEventListener("pointerdown", onDown)
    }, [fs])
    // Esc clears the selection and cancels an in-progress marquee
    const escActive = selected.length > 0 || marquee !== null
    useEffect(() => {
        if (!escActive) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || inElementFullscreen()) return
            // While hole targeting is active Esc belongs to it (its own
            // listener cancels the targeting); the selection survives
            if (holeActiveRef.current) return
            // Same for the Scale & Move session: its overlay's listener
            // cancels the gesture or ends the session
            if (transformActiveRef.current) return
            endMarqueeRef.current()
            usePinSelection.getState().clear()
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [escActive])
    // Ctrl/Cmd+A selects every pin, file-manager style — in reading order,
    // so a shift+click right after shrinks the range predictably. Presses
    // aimed at a text field keep their native select-all.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.key !== "a" && e.key !== "A") || !(e.ctrlKey || e.metaKey)
                || e.altKey || e.shiftKey || inElementFullscreen()) return
            const t = e.target as HTMLElement | null
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
            const keys = readingOrder.filter(k => !k.endsWith("__preview"))
            if (keys.length === 0) return
            e.preventDefault()
            usePinSelection.getState().replace(keys, keys[0])
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [readingOrder])
    // Delete runs Remove Selected — the keyboard twin of the toolbar verb.
    // Backspace is deliberately NOT bound: it is the browser-back gesture
    // on some setups, and Back is this feature's undo.
    useEffect(() => {
        if (selected.length === 0) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Delete" || inElementFullscreen()) return
            // A press aimed at a text field is that field's own edit
            const t = e.target as HTMLElement | null
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
            // Crop mode, hole targeting, a live carry and the Scale & Move
            // session each own the keyboard while they run (Escape already
            // routes to them first), and a splice under them would shift
            // the record offsets they are holding mid-gesture
            if (cropKey !== null || holeActiveRef.current || carrySha
                || transformActiveRef.current) return
            // An open dialog OWNS Delete: the library dialog, the rename
            // dialog and the confirm dialogs (deleting a saved version,
            // say) all sit over the board, and a press aimed at one of
            // them must not silently take the board's pins away behind
            // the overlay. Matched against the document rather than the
            // event target — Radix parks focus on the dialog content or
            // on <body>, neither of which a closest() from the press can
            // relate back to the board.
            if (document.querySelector('[role="dialog"]')) return
            e.preventDefault()
            removePins(selected)
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
        // records: the splice closes over this render's board state, so the
        // listener must be re-bound when the board changes underneath it
    }, [selected, records, cropKey, carrySha])
    // Pressing anywhere that isn't a pin, the selection toolbar or a popup
    // menu — the board background, the rest of the app — deselects, the
    // way every file manager does. Ctrl/shift presses are exempt so
    // additive marquees and range clicks can start anywhere. Capture
    // phase on document, so this runs before any React handler. The
    // maximized search overlay is exempt too: running a search over the
    // board must not clear the pin selection (design doc §7).
    useEffect(() => {
        if (selected.length === 0) return
        const onDown = (e: PointerEvent) => {
            if (e.ctrlKey || e.metaKey || e.shiftKey) return
            const t = e.target as HTMLElement | null
            // A press dismissing a MODAL Radix layer (the context menu)
            // hit-tests to <html>/<body> — Radix put pointer-events:none on
            // the body — so it can't be matched against the exemptions
            // below. It's consuming the dismissal, not aiming at the
            // background: never deselect on it.
            if (!t || t === document.documentElement || t === document.body) return
            if (t.closest?.(
                '[data-pin-key], [data-selection-toolbar], [data-scroll-area-scrollbar],'
                + ' [data-radix-popper-content-wrapper], [role="menu"], [data-hole-overlay],'
                + ' [data-transform-overlay], [data-search-overlay]'
            )) return
            usePinSelection.getState().clear()
        }
        document.addEventListener("pointerdown", onDown, true)
        return () => document.removeEventListener("pointerdown", onDown, true)
    }, [selected.length])
    // Overlay controls handle their own (modifier-)clicks — those are
    // never selection gestures
    const isInteractiveTarget = (t: EventTarget | null) =>
        !!(t as HTMLElement | null)?.closest?.("button, a, input, .react-resizable-handle")
    // Selection gestures on the pins themselves, in the capture phase so
    // modifier presses never reach RGL's drag machinery (both the pointer-
    // and mouse-event layers are stopped — RGL starts its drags on
    // mousedown). The movement guard separates clicks from plain drags,
    // which still move the item.
    const selectionMouseDownRef = useRef<{ x: number; y: number } | null>(null)
    const onPinPointerDownCapture = (e: React.PointerEvent) => {
        if (cropKey !== null || e.button !== 0 || isInteractiveTarget(e.target)) return
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
            // If the pointer moves this becomes an additive marquee; a
            // release in place falls through to the click handler below
            e.stopPropagation()
            beginMarquee(e, true)
        }
    }
    const onPinMouseDownCapture = (e: React.MouseEvent) => {
        selectionMouseDownRef.current = { x: e.clientX, y: e.clientY }
        if (cropKey !== null || e.button !== 0 || isInteractiveTarget(e.target)) return
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
            e.stopPropagation()
            // No native text/image selection during the gesture
            e.preventDefault()
        }
    }
    const onPinClickCapture = (key: string) => (e: React.MouseEvent) => {
        if (cropKey !== null || isInteractiveTarget(e.target)) return
        const d = selectionMouseDownRef.current
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return
        const sel = usePinSelection.getState()
        if (e.shiftKey) {
            e.preventDefault()
            e.stopPropagation()
            rangeSelectTo(key, e.ctrlKey || e.metaKey)
        } else if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            e.stopPropagation()
            sel.toggle(key)
        } else {
            // Plain click: a fresh single-item selection replacing any
            // previous one, file-manager style. Deliberately not stopped —
            // nothing else on the pin consumes plain clicks.
            sel.replace([key], key)
        }
    }
    // Refs so the effects below read the CURRENT flags and action at fire
    // time while only reacting to their own trigger conditions
    const autoLayoutRef = useRef(autoLayout)
    autoLayoutRef.current = autoLayout
    const fillViewportRef = useRef(fillViewport)
    fillViewportRef.current = fillViewport
    // Previous pin count; null until the first observation so loading a
    // board never rewrites it (the first run just records the baseline)
    const prevPinCountRef = useRef<number | null>(null)
    useEffect(() => {
        const count = records.length / 5
        const prev = prevPinCountRef.current
        // Keep the baseline current even while the mode is off, so toggling
        // it on later can't misfire from a stale count
        prevPinCountRef.current = count
        // Consume the marks unconditionally so they can't linger past the
        // write they were set for and misfire on a later real pin add/remove
        const wasNavigation = consumePinboardNavigation()
        const pendingEdit = consumePinboardPendingEdit()
        const explicitPlacement = consumePinboardExplicitPlacement()
        const maximizeRequest = consumePinboardMaximizeRequest()
        if (prev === null) {
            // First observation is normally just the baseline — but a
            // pending-edit mark means pins were added/removed from outside
            // the gallery (search-grid pin buttons) while this trigger was
            // unmounted, and that edit still needs laying out. Navigation
            // takes precedence: a restored version replaced those records.
            if (pendingEdit && !wasNavigation && count > 0 && autoLayoutRef.current) {
                void fillViewportRef.current(false)
            } else if ((maximizeRequest || variant === "grid") && !wasNavigation
                && count > 0 && autoLayoutRef.current) {
                // Opening the board in the grid host is an intent to expand:
                // its viewport is the gallery's with the thumbnail row gone,
                // so the fill targets the bigger fold and ratchets the high
                // water up to it in the same write. skipIfCovered keeps
                // Results<->Pinboard tab flips idempotent — a board already
                // laid out at this size (or fullscreen) doesn't repaint.
                // Not in the gallery: a tab switch back there is navigation,
                // not a layout request. (The pending-edit fill above already
                // targets the current fold, so it subsumes this trigger.)
                //
                // `maximizeRequest` is the SAME intent arriving by a route
                // the viewport-growth effect below cannot see: the tab
                // chip's maximize button activates the tab and sets `fs` in
                // one tick, so the board mounts already fullscreen and that
                // effect's baseline reads "was already maximized" (see
                // lib/pinboardNavigation.ts). Handled HERE rather than
                // there so the grid host cannot fill twice for one press —
                // both routes share this single branch, and skipIfCovered
                // makes a second attempt a no-op anyway.
                void fillViewportRef.current(false, true)
            }
            return
        }
        if (prev === count) return
        // Loading a saved version/board with a different item count is
        // navigation, not a pin edit: relayouting it here would rewrite the
        // just-restored layout (and bounce the history panel's selection
        // back off it)
        if (wasNavigation) return
        // Count-change detection is itself the loop guard: the relayout's
        // own record write preserves the count, as do drags, resizes, crops
        // and the v1->v2 migration — none of them can re-trigger this.
        if (count === 0) return // board emptied: nothing to lay out
        // The whole point of a positioned add (drag-drop, carry, hole
        // drop) is its position — auto-layout sits that one out
        if (explicitPlacement) return
        if (!autoLayoutRef.current) return
        // Fire-and-forget: fillViewport is async (fetches metadata) and
        // no-ops on its own when the container can't be measured.
        // REPLACE, not push: this fill is the tail of somebody else's
        // structural write (a pin add, or a removal), and it must land in
        // that write's history entry. Being async — it awaits a metadata
        // fetch — nuqs cannot merge it, so a push would leave a second
        // entry holding the removed-but-not-repacked board. That entry is
        // what one Back press would reach, while removePins' toast
        // promises Back restores the pins; the same asymmetry would make
        // Back after a pin add land on a half-integrated board. Only the
        // explicit fills (menu verbs, the viewport-growth trigger) are
        // their own undo step and keep push.
        void fillViewportRef.current(false, false, "replace")
    }, [records])
    // Viewport-growth trigger: explicit user actions that give the board
    // more room — maximizing it, hiding the gallery thumbnails — re-run the
    // layout so it fills the space. Deliberately asymmetric: shrinking back
    // never triggers, so returning to the search UI isn't a "commitment"
    // that repaints the board (the next pin add recomputes anyway). Keying
    // off the state flags rather than measured size means window resizes
    // can't trigger; and since this component is unmounted while the
    // full-size-image tab is focused, flags flipped over there don't fire
    // either — the baseline re-initializes on mount, so a tab switch back
    // is navigation, not a layout request. An empty board is safe:
    // fillViewport no-ops with no participants.
    const prevViewportFlagsRef = useRef({ fs, thumbnailsOpen })
    useEffect(() => {
        const prev = prevViewportFlagsRef.current
        prevViewportFlagsRef.current = { fs, thumbnailsOpen }
        const grewByMaximize = fs && !prev.fs
        // Thumbnails only affect the board height outside fullscreen (the
        // fs branch of the height class ignores them), so toggling them
        // while maximized changes nothing on screen and must not repaint
        const grewByThumbnails = !fs && !prev.fs && prev.thumbnailsOpen && !thumbnailsOpen
        if (!grewByMaximize && !grewByThumbnails) return
        if (!autoLayoutRef.current) return
        // Post-commit the height class has applied, so fillViewport
        // measures the grown container. skipIfCovered: a board already laid
        // out at this size (shrunk and regrown without edits) keeps its
        // layout — otherwise peeking at the search UI and coming back would
        // repaint for nothing.
        void fillViewportRef.current(false, true)
    }, [fs, thumbnailsOpen])
    return (<>
        {/* Maximized mode hides the gallery header, so the tab's controls
            reappear as a hover-revealed bar at the top of the viewport */}
        {fs && <PinboardFullscreenBar />}
        {/* data-pinboard-area: the version-history panel docks into this
            box's corners (PinboardHistory measures it by this attribute)

            h-[97vh] WHILE MAXIMIZED IS LOAD-BEARING AND SUBTLE — do not
            remove it as redundant with the wrapper's own h-[97vh] below.
            Without a DEFINITE height on this Root the bottom-dock scroll
            reservation (the two spacers further down) adds exactly ZERO net
            range, and it corrupts every measurement taken off this element.
            Why: Radix's Viewport is `h-full`, so with an auto-height Root
            (this box is a flex item in an auto-height [data-pinboard-frame])
            the percentage resolves against an auto containing block and the
            Viewport is auto too — it then GROWS by the spacer's height 1:1,
            cancelling the reservation term for term, and drags this Root's
            own clientHeight up with it. That clientHeight is consumed by
            hooks/pinboardLayout.ts (the fill/mosaic FOLD, which is
            PERSISTED), PinboardExportMenu / PinboardMosaicMenu /
            lib/pinboardAnimatedExport (export height — a dock-height empty
            band in the output), and PinboardHistory's corner docking; the
            Viewport's rect drives the drag autoscroll edge and the selection
            toolbar's viewport cap. Measured at 1920x1080 with a 400px dock,
            in a static harness reproducing this exact chain:

              auto Root + spacers: Root clientHeight 1448 (was 1048),
                                   range 600 tall / 0 fits — no gain at all
              97vh Root + spacers: Root clientHeight 1048 (unchanged),
                                   range 1000 tall / 400 fits — +inset, no
                                   double count

            NOT h-full on the grid wrapper below either: Radix wraps the
            Viewport's children in a `display:table; min-width:100%` div, so
            a percentage height there resolves against an auto table box and
            collapses the wrapper to its content (measured: wrapper 2048
            instead of 1048, range double-counted at 1400). The wrapper keeps
            its own 97vh, which is the same number this Root now has.

            Non-maximized is untouched: no class is added, and the Root goes
            back to being sized by its content. */}
        <ScrollArea
            ref={scrollAreaRef}
            data-pinboard-area
            className={cn("overflow-y-auto", fs && "h-[97vh]")}
        >
            <div
                ref={gridAreaRef}
                // Rubber-band start from the board background (presses on
                // pins are handled by their own capture handlers and, when
                // unmodified, never reach the marquee)
                onPointerDown={(e) => {
                    if (e.button !== 0) return
                    const t = e.target as HTMLElement
                    if (t.closest("[data-pin-key], [data-selection-toolbar]")
                        || isInteractiveTarget(t)) return
                    e.preventDefault()
                    beginMarquee(e, e.ctrlKey || e.metaKey || e.shiftKey)
                }}
                // Shift-held external drags run in hole mode: RGL's
                // dropConfig rejected the dragover (no placeholder, no
                // cascade), so this tracker drives the overlay instead —
                // and must preventDefault to keep the drop alive. CAPTURE
                // phase everywhere: RGL's own dragover/dragleave handlers
                // stopPropagation unconditionally, so bubble handlers on
                // this wrapper would never fire over the grid.
                onDragOverCapture={(e) => {
                    if (e.shiftKey) {
                        e.preventDefault()
                        const rect = e.currentTarget.getBoundingClientRect()
                        setDragHole({ x: e.clientX - rect.left, y: e.clientY - rect.top })
                    } else if (dragHole) {
                        setDragHole(null)
                    }
                }}
                onDragLeaveCapture={(e) => {
                    if (dragHole
                        && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
                        setDragHole(null)
                    }
                }}
                // Capture phase so a hole-mode drop never reaches RGL's
                // own drop handler on the grid below
                onDropCapture={(e) => {
                    if (!dragHole) return
                    e.preventDefault()
                    e.stopPropagation()
                    setDragHole(null)
                    const sha256 = e.dataTransfer?.getData("text/plain")
                    if (!sha256) {
                        holeToast("Only gallery images can be dropped into holes")
                        return
                    }
                    const rect = e.currentTarget.getBoundingClientRect()
                    const gx = (e.clientX - rect.left - effGrid.padding) / (holeColW + effGrid.margin)
                    const gy = (e.clientY - rect.top - effGrid.padding) / rowStep(effGrid)
                    const r = pickRectAt(holeRects, gx, gy)
                    if (!r || !validHole(r)) {
                        holeToast("No hole under the drop — nothing was added")
                        return
                    }
                    markPinboardExplicitPlacement()
                    pinItem.pinItem(sha256, r)
                }}
                // The gesture floor (see gestureFreeze): the wrapper only
                // stamps the variable and the phase class — the min-height
                // itself lives on .react-grid-layout via globals.css. Never
                // move it onto this wrapper as an inline style: a
                // min-height HERE (block inside the Radix viewport's
                // display:table div) resets the viewport's scrollTop to 0.
                // On release the grid's min-height transitions to 0 and the
                // browser walks scrollTop down with it, one followable
                // glide; the bubbled transitionend below ends the phase.
                style={gestureFreeze ? {
                    // The ref, not state.h: autoscroll ratchets the floor
                    // mid-gesture without re-rendering (see freezeHRef)
                    ["--pinboard-freeze" as string]:
                        `${freezeHRef.current ?? gestureFreeze.h}px`,
                } as React.CSSProperties : undefined}
                onTransitionEnd={(e) => {
                    if (e.propertyName === "min-height"
                        && e.target instanceof HTMLElement
                        && e.target.classList.contains("react-grid-layout")) {
                        freezeHRef.current = null
                        setGestureFreeze((f) => f?.releasing ? null : f)
                    }
                }}
                className={`relative grow ${rglSettling ? "rgl-mount-still " : ""}${transformGesture ? "pinboard-transforming " : ""}${gestureFreeze ? (gestureFreeze.releasing ? "pinboard-freeze-releasing " : "pinboard-freeze ") : ""}${fs ? "h-[97vh]" : (
                    variant === "grid" ?
                        // Grid host: gallery-without-thumbnails sizing, with
                        // the 48px update-ribbon offset the grid view
                        // subtracts (the gallery ignores the ribbon — a
                        // known, separate inconsistency)
                        (showPagination ?
                            (updateRibbonVisible ? "h-[calc(100vh-261px)]" : "h-[calc(100vh-213px)]")
                            :
                            (updateRibbonVisible ? "h-[calc(100vh-199px)]" : "h-[calc(100vh-151px)]"))
                        :
                        (showPagination ?
                            (thumbnailsOpen ? "h-[calc(100vh-567px)]" : "h-[calc(100vh-213px)]")
                            :
                            (thumbnailsOpen ? "h-[calc(100vh-505px)]" : "h-[calc(100vh-151px)]"))
                )
                    }`}
            >
                {showGrid && (
                    // Faint overlay of react-grid-layout's cells, for
                    // eyeballing item sizes while debugging layouts. RGL's own
                    // GridBackground shares the grid's exact cell math, so it
                    // can't drift from the real cell positions.
                    <GridBackground
                        className="z-0"
                        width={gridWidth}
                        cols={effGrid.columns}
                        rowHeight={effGrid.rowHeight}
                        margin={[effGrid.margin, effGrid.margin]}
                        containerPadding={[effGrid.padding, effGrid.padding]}
                        rows="auto"
                        height={gridContentHeight}
                        color="rgba(128,128,128,0.18)"
                        borderRadius={2}
                    />
                )}
                <GridLayout
                    // Remount when the grid parameters change (v1 -> v2
                    // migration, future per-board settings): GridLayout keeps
                    // an internal layout state that only re-syncs from props
                    // in a post-paint effect, so without the remount one
                    // frame renders the old layout against the new column
                    // width. Remounting re-initializes the state from the new
                    // props atomically.
                    key={gridKey}
                    className="layout"
                    width={gridWidth}
                    layout={layout}
                    gridConfig={gridConfig}
                    dragConfig={DRAG_CONFIG}
                    resizeConfig={RESIZE_CONFIG}
                    dropConfig={DROP_CONFIG}
                    onLayoutChange={(currentLayout) => {
                        // A report not claimed by a just-finished gesture is
                        // RGL's own normalization — write it as replace
                        const echo = !gestureRef.current
                        gestureRef.current = false
                        const manual = manualGestureRef.current
                        // A gesture resize makes the item's stored auto crop
                        // stale (it was a fit to the OLD cell size) — drop it
                        // in the same write, so the true image letterboxes
                        // instead of showing a nonsense crop. Not in crop
                        // mode: there the box resize IS the crop edit, and
                        // the manual-crop commit rides this write. Echo
                        // reports and drags only move items, never resize.
                        let drops: Record<string, CropRect | null> | undefined
                        if (!echo && cropKey === null) {
                            const oldSize = new Map(layout.map(l => [l.i, `${l.w}x${l.h}`]))
                            for (const l of currentLayout) {
                                if (autoCrops[l.i] && oldSize.get(l.i) !== `${l.w}x${l.h}`) {
                                    (drops ??= {})[l.i] = null
                                }
                            }
                        }
                        onLayoutChange([...currentLayout], drops, undefined,
                            undefined, undefined, echo ? "replace" : undefined,
                            manual, true)
                    }}
                    // Drags shrink the grid too (compaction pulls the rest
                    // up when the bottom item moves), so they get the same
                    // scroll-range freeze as resizes
                    onDragStart={() => freezeScrollRange()}
                    // The crop-mode exemption: there the drag/resize IS the
                    // crop edit, not a layout statement — it composes with
                    // auto-layout (the manual crop survives as the base of
                    // future auto-crops), so it must not turn the mode off
                    onDragStop={() => {
                        gestureRef.current = true
                        if (cropKey === null) markManualGesture()
                        releaseScrollFloor()
                    }}
                    // Size of the grey preview box (10x10 in v1 units)
                    droppingItem={{ i: '__preview', x: 0, y: 0, w: Math.round(10 * sx), h: Math.round(10 * sy) }}
                    // Compacts items vertically to keep them visible on
                    // screen — EXCEPT in crop mode. RGL v2's GridItem
                    // re-anchors every resize event to the item's current
                    // layout position (v1 curried the live in-resize
                    // position into its handlers), so with compaction on,
                    // a north/west shrink is snapped back to the compacted
                    // edge after the first event and the box shrinks from
                    // the wrong side. With compaction off, the mid-gesture
                    // layout matches the visual box and the anchor holds;
                    // leaving crop mode re-compacts, which is where v1
                    // ended up too (the crop committed at release is
                    // immune to that move, see onResizeStop). Verb writes
                    // don't wait for that: they compact themselves inside
                    // onLayoutChange while crop mode is on, since their
                    // layouts assume a compaction pass RGL isn't providing
                    // here. The vertical compactor is the skyline
                    // O(n log n) one from extras; same semantics as the
                    // classic quadratic compactor for non-overlapping,
                    // non-static layouts like ours.
                    //
                    // And off for the whole board whenever gravity is off
                    // (the layout token's float switch) — that IS the
                    // feature: items stay exactly where they were put.
                    // noCompactor still pushes collisions apart during
                    // drags, which is the desired no-gravity feel; the verbs
                    // whose writes can create overlaps resolve them
                    // themselves (see resolveGrowth in pinboardLayout).
                    compactor={cropKey !== null || float ? noCompactor : fastVerticalCompactor}
                    onResizeStart={(_currentLayout, oldItem, newItem, _placeholder, e, node) => {
                        // Every resize freezes the board height (see
                        // gestureFreeze), crop-mode or not
                        freezeScrollRange()
                        if (!oldItem || !newItem || oldItem.i !== cropKey) return
                        setCropResizing(true)
                        // In crop mode the box is the crop window: clamp its
                        // growth at the image's edges. A window past the image
                        // frames dead space the stored crop (box∩image) cannot
                        // represent, which would render as letterbox at rest.
                        // RGL passes its LIVE layout item here; maxW/maxH set
                        // on it feed react-resizable's maxConstraints, so the
                        // dragged edge hard-stops at the image edge. The grid
                        // resyncs items from our layouts prop on the next
                        // record write, which drops the constraint again.
                        const geom = cropImageExtentRef.current?.()
                        const areaWidth = gridAreaRef.current?.clientWidth
                        if (!geom || !areaWidth) return
                        // e.target is the react-resizable handle span; note
                        // that `node` is that same handle element, NOT the
                        // grid item, so the box rect comes from CropView
                        const handle = /react-resizable-handle-(se|sw|ne|nw|e|w|n|s)(?:\s|$)/
                            .exec(String((e.target as HTMLElement)?.className ?? ''))?.[1]
                        if (!handle) return
                        const { image, box } = geom
                        const colWidth = (areaWidth - 2 * effGrid.padding
                            - (effGrid.columns - 1) * effGrid.margin) / effGrid.columns
                        const unitX = colWidth + effGrid.margin
                        const unitY = effGrid.rowHeight + effGrid.margin
                        if (!(unitX > 0) || !(unitY > 0)) return
                        // Smallest span (units) whose moving edge reaches AT
                        // LEAST the image edge (span of w cells = w*unit −
                        // margin, hence the +margin) — ceil, so the user can
                        // always consume the whole image; floor left up to a
                        // cell of unreachable ghost, a different sub-cell
                        // amount per side. The <1-cell overshoot is trimmed by
                        // the box∩image commit, leaving only a sub-cell
                        // letterbox on par with the lattice quantization every
                        // block has. Never below the current span, so
                        // pre-existing dead space doesn't snap the box on grab
                        // (growth is simply capped, shrinking stays free)
                        const cap = (px: number, unit: number, current: number) =>
                            Math.max(current, Math.ceil((px + effGrid.margin) / unit))
                        if (handle.includes('e')) newItem.maxW = cap(image.right - box.left, unitX, newItem.w)
                        if (handle.includes('w')) newItem.maxW = cap(box.right - image.left, unitX, newItem.w)
                        if (handle.includes('s')) newItem.maxH = cap(image.bottom - box.top, unitY, newItem.h)
                        if (handle.includes('n')) newItem.maxH = cap(box.bottom - image.top, unitY, newItem.h)
                    }}
                    onResizeStop={(currentLayout, oldItem, newItem) => {
                        gestureRef.current = true
                        if (cropKey === null) markManualGesture()
                        setCropResizing(false)
                        releaseScrollFloor()
                        if (newItem) {
                            newItem.maxW = undefined
                            newItem.maxH = undefined
                        }
                        // Crop-mode release does two things, both computed
                        // from the same release-time geometry (the image's
                        // drag-frozen viewport extent and the box rect, read
                        // synchronously before RGL re-renders anything):
                        //
                        // 1. COMMIT the crop: box∩image in image fractions —
                        //    exactly the window the user saw at mouseup. This
                        //    must happen HERE, not in CropView's boxResizing
                        //    effect: the editor's live view crop is fed by
                        //    ResizeObserver deliveries that lag the drag by a
                        //    frame or more, so on a fast drag a commit from
                        //    that state bakes in the box from ~one frame ago
                        //    — up to hundreds of px behind the drop point.
                        //    Computing at mouseup is also inherently immune
                        //    to everything that moves the box afterwards
                        //    (lattice snap, vertical compaction, the trim
                        //    below, and the resize transition). The commit
                        //    rides the onLayoutChange write RGL fires right
                        //    after this callback (pendingManualCropRef): a
                        //    separate updateRecords here would be clobbered
                        //    by that same-tick layout write (see
                        //    rebuildRecords).
                        // 2. TRIM the box: any box edge left hanging in dead
                        //    space (typically the letterbox opposite the
                        //    dragged edge) makes the box aspect diverge from
                        //    the crop aspect, and the rest view's centered
                        //    contain fit then re-letterboxes the crop on BOTH
                        //    sides, detaching the freshly placed edge from
                        //    the image. Overhang is floored to whole cells
                        //    (the box never cuts into committed content; at
                        //    most the usual sub-cell letterbox remains).
                        //    Unlike onResizeStart, the mutation can't go on
                        //    `newItem`: RGL has already compact()ed the
                        //    layout it is about to commit to state and report
                        //    through onLayoutChange, and `newItem` is the
                        //    pre-compact clone — the trim goes on that final
                        //    layout's item instead.
                        //
                        // A no-op resize (grab and release) skips both, so
                        // merely touching a handle neither snaps the box nor
                        // rewrites the crop.
                        if (!newItem || newItem.i !== cropKey) return
                        if (oldItem && oldItem.x === newItem.x && oldItem.y === newItem.y
                            && oldItem.w === newItem.w && oldItem.h === newItem.h) return
                        const geom = cropImageExtentRef.current?.()
                        const areaWidth = gridAreaRef.current?.clientWidth
                        const item = currentLayout.find((l) => l.i === newItem.i)
                        if (!geom || !areaWidth || !item) return
                        const { image, box } = geom
                        const iw = image.right - image.left
                        const ih = image.bottom - image.top
                        const il = Math.max(box.left, image.left)
                        const ir = Math.min(box.right, image.right)
                        const it = Math.max(box.top, image.top)
                        const ib = Math.min(box.bottom, image.bottom)
                        if (iw > 0 && ih > 0 && ir > il && ib > it) {
                            pendingManualCropRef.current = {
                                [newItem.i]: clampCrop({
                                    x: (il - image.left) / iw,
                                    y: (it - image.top) / ih,
                                    w: (ir - il) / iw,
                                    h: (ib - it) / ih,
                                }),
                            }
                        }
                        const colWidth = (areaWidth - 2 * effGrid.padding
                            - (effGrid.columns - 1) * effGrid.margin) / effGrid.columns
                        const unitX = colWidth + effGrid.margin
                        const unitY = effGrid.rowHeight + effGrid.margin
                        if (!(unitX > 0) || !(unitY > 0)) return
                        const cells = (px: number, unit: number) =>
                            Math.max(0, Math.floor(px / unit))
                        const dl = Math.min(cells(image.left - box.left, unitX), item.w - 1)
                        item.x += dl
                        item.w -= dl
                        item.w -= Math.min(cells(box.right - image.right, unitX), item.w - 1)
                        const dt = Math.min(cells(image.top - box.top, unitY), item.h - 1)
                        item.y += dt
                        item.h -= dt
                        item.h -= Math.min(cells(box.bottom - image.bottom, unitY), item.h - 1)
                    }}
                    onDrop={(layout, layoutItem, e) => {
                        if (!layoutItem) return
                        // The user chose this position — auto-layout must
                        // not immediately repaint it away
                        markPinboardExplicitPlacement()
                        const event = e as unknown as React.DragEvent<HTMLDivElement>
                        if (event.dataTransfer && event.dataTransfer.getData("text/plain")) {
                            const sha256 = event.dataTransfer.getData("text/plain")
                            pinItem.pinItem(sha256, {
                                x: layoutItem.x,
                                y: layoutItem.y,
                                w: layoutItem.w,
                                h: layoutItem.h
                            })
                            return
                        }
                        if (event.dataTransfer && event.dataTransfer.files.length > 0) {
                            const file = event.dataTransfer.files[0]

                            file.arrayBuffer().then(async (arrayBuffer) => {
                                const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
                                // Convert to hex for display
                                const sha256 = [...new Uint8Array(hashBuffer)]
                                    .map(b => b.toString(16).padStart(2, '0'))
                                    .join('');
                                pinItem.pinItem(sha256, {
                                    x: layoutItem.x,
                                    y: layoutItem.y,
                                    w: layoutItem.w,
                                    h: layoutItem.h
                                })

                            })
                        }

                    }}
                >
                    {pinnedFiles.map(([i, sha256, thumbnail, file]) => (
                        <div
                            key={i}
                            data-pin-key={i}
                            className={cn(
                                "relative bg-gray-800 border rounded shadow-sm group pinboard-pin",
                                cropKey === i && "z-30 pinboard-crop-item",
                                selectedSet.has(i) && "ring-2 ring-blue-400",
                            )}
                            onPointerDownCapture={onPinPointerDownCapture}
                            onMouseDownCapture={onPinMouseDownCapture}
                            onClickCapture={onPinClickCapture(i)}
                            onMouseEnter={onBoardHover}
                            onMouseLeave={onBoardHoverEnd}
                        >
                            {sha256 === "__preview" ?
                                <div key={i} className="drag-handle cursor-move absolute top-0 left-0 w-full h-full" />
                                :
                                <PinBoardPin
                                    key={i}
                                    layoutKey={i}
                                    sha256={sha256}
                                    thumbnail={thumbnail}
                                    file={file}
                                    onLayoutChange={onLayoutChange}
                                    layout={layout}
                                    crops={crops}
                                    autoCrops={autoCrops}
                                    locks={itemLocks}
                                    orients={orients}
                                    highWater={highWater}
                                    float={float}
                                    uniform={uniform}
                                    crop={crops[i] ?? null}
                                    autoCrop={autoCrops[i] ?? null}
                                    trim={trims[i] ?? null}
                                    lock={itemLocks[i] ?? null}
                                    orientation={orients[i] ?? null}
                                    audio={audios[i] ?? null}
                                    onAudioChange={(audio) => onItemAudioChange(i, audio)}
                                    lockBadgesVisible={lockBadgesVisible}
                                    onLockChange={(lock) => setLockForKeys([i], lock)}
                                    cropKey={cropKey}
                                    cropMode={cropKey === i}
                                    boxResizing={cropKey === i && cropResizing}
                                    imageExtentRef={cropImageExtentRef}
                                    onCropModeToggle={() => setCropKey((k) => k === i ? null : i)}
                                    onCropChange={(crop) => onItemCropChange(i, crop)}
                                    onTrimChange={(trim) => onItemTrimChange(i, trim)}
                                    onDuplicate={() => onDuplicatePin(i)}
                                    onUnpin={() => onUnpinPin(i)}
                                    onRemove={removePins}
                                    onRemoveAllBut={removeAllBut}
                                    scrollAreaRef={scrollAreaRef}
                                    // The pin's context menu runs its own
                                    // layout-verb instance, so it needs the
                                    // rendered grid like the board's does
                                    grid={effGrid}
                                    gridWidth={gridWidth}
                                    isV1={isV1}
                                    onUpgradeGrid={upgradeGrid}
                                    dbs={dbs}
                                />}
                        </div>
                    ))}
                </GridLayout>
                {/* Bottom-dock scroll reservation, half one
                    (docs/maximized-pinboard-search-overlay-design.md §7).
                    While maximized the search dock covers the bottom band of
                    the viewport, and without extra scroll range the board's
                    last rows sit under it forever — worse than the normal
                    gallery, where the thumbnail strip takes real layout space
                    so the board can always be scrolled clear of it.
                    --pinboard-bottom-inset is published by the dock while it
                    is SHOWN (pinned or not) and tracks its live height, so
                    consuming the var is the whole implementation; absent, it
                    resolves to 0px and this is a zero-height box.

                    Two spacers, because the board has two possible bottoms.
                    A board taller than the wrapper overflows it and the
                    scroll range is the GRID's bottom — this spacer, the
                    grid's in-flow successor, follows it. A board that FITS
                    (the common case: fillViewport sizes it to the container)
                    leaves the range at the wrapper's own fixed-height box,
                    which clamps this spacer away — the twin after the wrapper
                    covers that. The range ends up at max(grid bottom, wrapper
                    bottom) + inset either way.

                    In-flow blocks deliberately: the grid is the wrapper's
                    in-flow child whose height already defines the range at
                    rest (see the gesture-floor note above), whereas an
                    absolutely positioned spacer relies on abspos overflow
                    reaching the Radix viewport's scrollable area — the
                    engine-dependent propagation that already bit the floor.

                    THIS ONLY WORKS BECAUSE THE SCROLLAREA ROOT HAS A DEFINITE
                    HEIGHT while maximized (see the long note on the Root
                    above). Radix's Viewport is `h-full`; against an
                    auto-height Root it is auto too and simply GROWS by the
                    spacer, so the reservation nets to zero and the Root's
                    clientHeight — which the fold, the exporters and the
                    history panel all measure — inflates by a dock height.
                    Both spacers and the Root's height class are one
                    mechanism; removing any of the three breaks the other two.

                    Nothing here feeds the grid's math. The grid's width comes
                    from the WRAPPER (useContainerWidth's ResizeObserver on
                    gridAreaRef) and a block child's height cannot move it;
                    holeRows and gridContentHeight read that wrapper's own
                    clientHeight, fixed by its height class; and the fill
                    verbs' fold measures [data-pinboard-area] — the ScrollArea
                    ROOT, outside the scrolling content entirely. Never move
                    the reservation onto the wrapper as padding: clientHeight
                    includes padding, which would silently change both the
                    hole mask and the fold. */}
                {fs && (
                    <div
                        aria-hidden
                        style={{ height: "var(--pinboard-bottom-inset, 0px)" }}
                    />
                )}
                {marquee && (
                    <div
                        className="absolute z-40 pointer-events-none border border-blue-400 bg-blue-400/10 rounded-xs"
                        style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
                    />
                )}
                {holeMode && gridWidth > 0 && (
                    <HoleTargetOverlay
                        grid={effGrid}
                        gridWidth={gridWidth}
                        // Cover the full free mask even when the grid
                        // content ends above it (the empty bottom band)
                        contentHeight={Math.max(gridContentHeight,
                            effGrid.padding + holeRows * rowStep(effGrid))}
                        rows={holeRows}
                        occupied={holeOccupied}
                        freeRects={holeRects}
                        mode={holeMode}
                        dragPoint={dragHole}
                        carryGhost={{ w: Math.round(10 * sx), h: Math.round(10 * sy) }}
                        validHole={validHole}
                        validFree={validFree}
                        onCommit={onHoleCommit}
                        onMiss={holeToast}
                        onCancel={() => {
                            setHoleVerb(false)
                            setDragHole(null)
                            usePinboardCarry.getState().cancel()
                        }}
                    />
                )}
                {carrySha && carryPoint && (
                    // The carried image's thumbnail rides the cursor
                    // (fixed: it follows over the gallery strip too)
                    <div
                        className="fixed z-[60] pointer-events-none"
                        style={{ left: carryPoint.x + 14, top: carryPoint.y + 10 }}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            // An 80x80 box, so the smallest tier covers it to
                            // beyond any display density (§2 names this ghost
                            // explicitly: it paints plain centre
                            // `object-cover`, and a top-crop shown here for an
                            // extreme-aspect item is accepted as a non-issue).
                            src={getFileURL(dbs, "thumbnail", "sha256", carrySha, "grid-s")}
                            alt=""
                            className="w-20 h-20 object-cover rounded shadow-lg opacity-80 border border-white/40"
                        />
                    </div>
                )}
                {transformOn && gridWidth > 0 && transformItems
                    && transformItems.length >= 2 && (
                        <PinboardTransformOverlay
                            grid={effGrid}
                            gridWidth={gridWidth}
                            // Cover the selection even when it reaches below
                            // the grid content box (items parked below the
                            // fold), same envelope logic as the hole overlay
                            contentHeight={Math.max(gridContentHeight,
                                Math.max(...transformItems.map(r => r.t + r.h))
                                + effGrid.padding)}
                            items={transformItems}
                            gridAreaRef={gridAreaRef}
                            onGesture={(active) => {
                                setTransformGesture(active)
                                // The preview changes item heights like any
                                // RGL gesture, so it gets the same
                                // scroll-range freeze and edge autoscroll
                                if (active) freezeScrollRange()
                                else releaseScrollFloor()
                            }}
                            onCommit={commitTransform}
                            onExit={() => setTransformOn(false)}
                        />
                    )}
                {selected.length > 0 && toolbarPos && !transformOn && (
                    <SelectionToolbar
                        innerRef={toolbarRef}
                        style={{ left: toolbarPos.x, top: toolbarPos.y }}
                        onGripDown={onToolbarGripDown}
                        keys={selected}
                        cropOn={selectionCrop}
                        gravity={!float}
                        selHasAnchor={selected.some(k => itemLocks[k] === "anchor")}
                        holeActive={holeVerb}
                        onVerb={(id) => {
                            switch (id) {
                                case "arrange": runVerb("Arrange", arrangeSelection(selected)); break
                                case "uniform": runVerb("Uniform", uniformSelection(selected)); break
                                case "swap": runVerb("Swap", swapItems(selected[0], selected[1])); break
                                case "hole": holeVerb ? setHoleVerb(false) : enterHoleTarget(); break
                                case "transform": enterTransform(); break
                                case "reflow": runVerb("Reflow", arrangeSelection(selected, true)); break
                                case "shuffle": runVerb("Shuffle", arrangeSelection(selected, false, true)); break
                                case "grow": runVerb("Grow to Fill", growSelection(selected)); break
                                case "shiftLeft": shiftSelection(selected, "left"); break
                                case "shiftCenter": shiftSelection(selected, "center"); break
                                case "shiftRight": shiftSelection(selected, "right"); break
                                case "compressLeft": runVerb("Compress Left", compressSelection(selected, "left")); break
                                case "compressRight": runVerb("Compress Right", compressSelection(selected, "right")); break
                                case "compressUp": runVerb("Compress Up", compressSelection(selected, "up")); break
                                case "mirrorH": void mirrorSelection(selected, "horizontal"); break
                                case "mirrorV": void mirrorSelection(selected, "vertical"); break
                                case "flipImageH": runVerb("Flip Images", orientSelection(selected, "flipH")); break
                                case "flipImageV": runVerb("Flip Images", orientSelection(selected, "flipV")); break
                                case "rotateImageL": runVerb("Rotate Images", orientSelection(selected, "ccw")); break
                                case "rotateImageR": runVerb("Rotate Images", orientSelection(selected, "cw")); break
                                case "clearCrop": clearAutoCropSelection(selected); break
                                case "removeSel": removePins(selected); break
                                case "removeRest": removeAllBut(selected); break
                            }
                        }}
                        onRegion={(preset) => runVerb("Send to Region", sendSelectionToRegion(selected, preset))}
                        onLock={(lock) => setLockForKeys(selected, lock)}
                        onCropToggle={() => {
                            const next = !selectionCrop
                            void setSelectionCrop(next)
                            // Turning it on doubles as "crop now": off→on
                            // re-fits the selection to its current cells
                            if (next) void autoCropSelection(selected)
                        }}
                        onClear={() => usePinSelection.getState().clear()}
                    />
                )}
            </div>
            {/* Bottom-dock scroll reservation, half two: the case where the
                board FITS its wrapper, so the wrapper's own box — not the
                grid — is the bottom of the scroll range and the spacer
                inside it is clamped away. Sibling of the grid area, still
                in-flow inside the Radix viewport's content, so it extends
                the range by the dock's height without touching the wrapper
                the grid measures itself against. See the long note beside
                its twin, above the grid. */}
            {fs && (
                <div
                    aria-hidden
                    style={{ height: "var(--pinboard-bottom-inset, 0px)" }}
                />
            )}
        </ScrollArea>
    </>)
}

// Floating verb bar shown while a selection exists. All buttons are
// icon-only (hover for the name — the icons match the ones used on the pin
// overlays and menus): the pinned verbs first, then the crop toggle, the
// lock management, the all-verbs dropdown and the clear button. Which
// verbs are pinned onto the bar is chosen from the dropdown's per-row pin
// toggles. Positioned by the parent (anchored above the selection, or
// wherever the grip parked it).
function SelectionToolbar({
    innerRef,
    style,
    onGripDown,
    keys,
    cropOn,
    gravity,
    selHasAnchor,
    holeActive = false,
    onVerb,
    onRegion,
    onLock,
    onCropToggle,
    onClear,
}: {
    innerRef: React.Ref<HTMLDivElement>
    style: React.CSSProperties
    onGripDown: (e: React.PointerEvent) => void
    // The selected layout keys. The bar shows their count and the verbs
    // are dispatched by the parent, but the export menu needs the keys
    // themselves — it composites exactly these items.
    keys: string[]
    cropOn: boolean
    // The board's gravity, for the verbs whose description depends on it
    gravity: boolean
    // Whether the selection contains an anchored item (greys the mirrors)
    selHasAnchor: boolean
    // Whether Move-to-Hole targeting is live (lights its button up; the
    // verb toggles, so the lit button is also the off switch)
    holeActive?: boolean
    onVerb: (id: string) => void
    onRegion: (preset: RegionPreset) => void
    onLock: (lock: PinLock) => void
    onCropToggle: () => void
    onClear: () => void
}) {
    const count = keys.length
    const [pinned, setPinned] = useState<string[]>(DEFAULT_TOOLBAR_VERBS)
    // localStorage is read after mount (the initializer also runs during
    // SSR, where there is no storage); the bar only exists while a
    // selection does, so the default never visibly flashes
    useEffect(() => {
        try {
            const ids = JSON.parse(localStorage.getItem(TOOLBAR_VERBS_KEY) ?? "")
            if (Array.isArray(ids)) {
                setPinned(ids.filter(id =>
                    id === REGION_MENU_ID || id === EXPORT_MENU_ID
                    || SELECTION_VERBS.some(v => v.id === id)))
            }
        } catch { /* absent or corrupted preference: keep the default */ }
    }, [])
    const togglePin = (id: string) => setPinned(prev => {
        const next = prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
        try { localStorage.setItem(TOOLBAR_VERBS_KEY, JSON.stringify(next)) } catch { }
        return next
    })
    const verbDisabled = (v: SelectionVerb) =>
        (v.exact !== undefined && count !== v.exact)
        || (v.min !== undefined && count < v.min)
        || (!!v.noAnchors && selHasAnchor)
    const btn = "rounded-full px-2.5 py-1 hover:bg-gray-200 disabled:opacity-40 disabled:hover:bg-transparent"
    // Dropdown trigger buttons light up while their menu is open (Radix
    // stamps data-state on the trigger)
    const menuBtn = cn(btn,
        "data-[state=open]:bg-blue-100 data-[state=open]:text-blue-700 data-[state=open]:hover:bg-blue-200")
    // One row renderer for both halves of the dropdown: the ordinary verbs
    // (plus the region submenu) first, the removals last behind a separator
    const verbRow = (v: SelectionVerb) => {
        const disabled = verbDisabled(v)
        return (
            // Not Radix-disabled even when the verb is: that would make the
            // row inert and unpinnable (e.g. Swap could never leave the bar
            // except with exactly two items selected). The row just looks
            // disabled and ignores selects instead.
            <DropdownMenuItem key={v.id} title={verbTitle(v, gravity)}
                onSelect={(e) => {
                    // A select that originated on the pin toggle is never a
                    // verb invocation — Radix fires select from pointerup,
                    // so this guard backs up the toggle's own propagation
                    // stops
                    const t = (e as CustomEvent<{ originalEvent?: Event }>)
                        .detail?.originalEvent?.target as HTMLElement | null
                    if (t?.closest?.("[data-pin-toggle]")) { e.preventDefault(); return }
                    if (disabled) { e.preventDefault(); return }
                    onVerb(v.id)
                }}
            >
                <span className={cn(
                    "flex items-center gap-2",
                    disabled && "opacity-40",
                )}>
                    <v.icon className="w-4 h-4" />
                    {v.label}
                </span>
                {/* Shortcut label takes over the row's ml-auto, so the pin
                    toggle keeps its place at the far right instead of the
                    two auto margins splitting the free space between them. */}
                {v.shortcut && (
                    <DropdownMenuShortcut>{v.shortcut}</DropdownMenuShortcut>
                )}
                <PinToggle
                    isPinned={pinned.includes(v.id)}
                    onToggle={() => togglePin(v.id)}
                    className={v.shortcut ? "ml-2" : undefined}
                />
            </DropdownMenuItem>
        )
    }
    return (
        <div
            ref={innerRef}
            data-selection-toolbar
            style={style}
            // w-max + nowrap: an absolute box with only `left` set would
            // shrink-to-fit against the board's right edge, wrapping the
            // bar onto two rows — and the wrapped bar's narrower measured
            // width then keeps the clamp from ever moving it back left
            className="absolute z-40 flex w-max items-center gap-1 whitespace-nowrap rounded-full bg-white/95 shadow-lg px-3 py-1 text-sm text-gray-800"
        >
            <div
                className="cursor-grab active:cursor-grabbing -ml-1.5 pr-0.5 text-gray-400 hover:text-gray-600 touch-none"
                title="Drag to move the toolbar out of the way"
                onPointerDown={onGripDown}
            >
                <GripVertical className="w-4 h-4" />
            </div>
            <span className="font-medium mr-1 select-none">{count} selected</span>
            {/* modal={false} on the bar's menus: modal mode puts
                pointer-events:none on the body while open, so the press
                that dismisses the menu hit-tests to <html> instead of the
                bar — it slipped past the bar entirely (and past the
                deselect handler's exemptions, clearing the selection and
                clicking the pin behind the bar). Non-modal, the dismissing
                press lands on whatever the user actually aimed at. */}
            <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                    <button className={menuBtn} title="All selection verbs">
                        <ChevronDown className="w-4 h-4" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                    {SELECTION_VERBS.filter(v => !v.removal).map(verbRow)}
                    {/* The region presets live in one submenu (seven
                        rarely-simultaneous targets would flood the list);
                        its pin toggle puts a menu-opening icon button on
                        the bar rather than a direct verb */}
                    <DropdownMenuSeparator />
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger
                            title="Clear a preset region and pack the selection to fill it; bystanders drop below the board"
                        >
                            <span className="flex items-center gap-2">
                                <Columns3 className="w-4 h-4" />
                                Send to Region
                            </span>
                            <span className="ml-auto pl-2">
                                <PinToggle
                                    isPinned={pinned.includes(REGION_MENU_ID)}
                                    onToggle={() => togglePin(REGION_MENU_ID)}
                                />
                            </span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-48">
                            {REGION_PRESETS.map(([preset, label]) => (
                                <DropdownMenuItem key={preset} onSelect={() => onRegion(preset)}>
                                    <span className="flex items-center gap-2">
                                        <RegionIcon preset={preset} className="w-4 h-4" />
                                        {label}
                                    </span>
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    {/* The other menu-not-verb: what the selection looks
                        like as a FILE. One item saves the picture itself
                        (cropped, oriented, at source resolution), several
                        save a mosaic of exactly them. */}
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger
                            title={count === 1
                                ? "Save this item as an image file, cropped and oriented as it is on the board"
                                : "Save the selected items as one image file"}
                        >
                            <span className="flex items-center gap-2">
                                <ImageDown className="w-4 h-4" />
                                {selectionExportLabel(count)}
                            </span>
                            <span className="ml-auto pl-2">
                                <PinToggle
                                    isPinned={pinned.includes(EXPORT_MENU_ID)}
                                    onToggle={() => togglePin(EXPORT_MENU_ID)}
                                />
                            </span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-56">
                            <SelectionExportMenuItems
                                kit={dropdownMenuKit}
                                keys={keys}
                            />
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    {/* The removals close the list, fenced off from the
                        verbs that only rearrange what's there */}
                    <DropdownMenuSeparator />
                    {SELECTION_VERBS.filter(v => v.removal).map(verbRow)}
                </DropdownMenuContent>
            </DropdownMenu>
            {BAR_ORDER.filter(id => pinned.includes(id)).map(id => {
                // The pinned Send to Region opens its preset menu in
                // place — an icon button can't carry eight targets directly
                if (id === REGION_MENU_ID) return (
                    <DropdownMenu modal={false} key={id}>
                        <DropdownMenuTrigger asChild>
                            <button className={menuBtn}
                                title="Send the selection to a region of the board">
                                <Columns3 className="w-4 h-4" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-48">
                            {REGION_PRESETS.map(([preset, label]) => (
                                <DropdownMenuItem key={preset} onSelect={() => onRegion(preset)}>
                                    <span className="flex items-center gap-2">
                                        <RegionIcon preset={preset} className="w-4 h-4" />
                                        {label}
                                    </span>
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )
                // Same shape for the pinned export menu: a size list can't
                // live on an icon button either
                if (id === EXPORT_MENU_ID) return (
                    <DropdownMenu modal={false} key={id}>
                        <DropdownMenuTrigger asChild>
                            <button className={menuBtn}
                                title={count === 1
                                    ? "Save this item as an image file"
                                    : "Save the selected items as one image file"}>
                                <ImageDown className="w-4 h-4" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-56">
                            <SelectionExportMenuItems
                                kit={dropdownMenuKit}
                                keys={keys}
                            />
                        </DropdownMenuContent>
                    </DropdownMenu>
                )
                const v = SELECTION_VERBS.find(v => v.id === id)
                if (!v) return null
                return (
                    <button key={id}
                        // A pinned removal is an ordinary bar button: it is
                        // undoable, and a filled red pill on the bar shouts
                        // louder than the verb deserves
                        className={cn(btn, v.id === "hole" && holeActive
                            && "bg-blue-100 text-blue-700 hover:bg-blue-200")}
                        disabled={verbDisabled(v)}
                        onClick={() => onVerb(v.id)} title={verbTitle(v, gravity)}>
                        <v.icon className="w-4 h-4" />
                    </button>
                )
            })}
            <button
                className={cn(btn, cropOn && "bg-blue-100 text-blue-700 hover:bg-blue-200")}
                onClick={onCropToggle}
                title={cropOn
                    ? "Selection verbs crop items to their cells. Click to turn off (existing crops stay until a verb resizes their cell)"
                    : "Selection verbs leave items letterboxed. Click to turn on and crop the selection to its cells now"}
            >
                <Crop className="w-4 h-4" />
            </button>
            <button className={btn} onClick={() => onLock("anchor")}
                title="Anchor in place: position and size fixed, layouts pack around them">
                <Anchor className="w-4 h-4" />
            </button>
            <button className={btn} onClick={() => onLock("size")}
                title="Lock size: items keep their size but may be moved">
                <Ruler className="w-4 h-4" />
            </button>
            <button className={btn} onClick={() => onLock(null)} title="Remove locks">
                <LockOpen className="w-4 h-4" />
            </button>
            <button className={btn} onClick={onClear} title="Clear selection (Esc)">
                <X className="w-4 h-4" />
            </button>
        </div>
    )
}

// The dropdown rows' toolbar-membership checkbox. A real checkbox look:
// empty outlined box when unpinned, filled box with a check when pinned —
// a same-glyph color change alone reads as enabled either way. All three
// pointer phases are stopped so toggling never selects the row or closes
// the menu (Radix fires item select from pointerup via item.click()).
function PinToggle({
    isPinned,
    onToggle,
    className,
}: {
    isPinned: boolean
    onToggle: () => void
    className?: string
}) {
    return (
        <button
            data-pin-toggle
            className={cn("ml-auto rounded p-0.5 hover:bg-gray-200", className)}
            title={isPinned
                ? "Shown on the toolbar — click to remove"
                : "Show directly on the toolbar"}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => { e.preventDefault(); e.stopPropagation() }}
            onClick={(e) => {
                // Keep the menu open: the click must not reach the row's
                // select handling
                e.preventDefault()
                e.stopPropagation()
                onToggle()
            }}
        >
            <span className={cn(
                "flex h-4 w-4 items-center justify-center rounded border",
                isPinned
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-gray-400 text-transparent hover:border-gray-600",
            )}>
                <Check className="w-3 h-3" />
            </span>
        </button>
    )
}

function PinBoardPin({
    layoutKey,
    sha256,
    thumbnail,
    file,
    onLayoutChange,
    layout,
    crops,
    autoCrops,
    locks,
    orients,
    highWater,
    float,
    uniform,
    crop,
    autoCrop,
    trim,
    lock,
    orientation,
    audio,
    onAudioChange,
    lockBadgesVisible,
    onLockChange,
    cropKey,
    cropMode,
    boxResizing,
    imageExtentRef,
    onCropModeToggle,
    onCropChange,
    onTrimChange,
    onDuplicate,
    onUnpin,
    onRemove,
    onRemoveAllBut,
    scrollAreaRef,
    grid,
    gridWidth,
    isV1,
    onUpgradeGrid,
    dbs,
}: {
    layoutKey: string
    sha256: string
    thumbnail: string
    file: string
    onLayoutChange: (
        currentLayout: LayoutItem[],
        autoCropOverrides?: Record<string, CropRect | null>,
        newHighWater?: number,
        orientationOverrides?: Record<string, PinOrientation | null>,
        manualCropOverrides?: Record<string, CropRect | null>,
    ) => void
    layout: LayoutItem[]
    crops: Record<string, CropRect | null>
    autoCrops: Record<string, CropRect | null>
    locks: Record<string, PinLock>
    orients: Record<string, PinOrientation | null>
    highWater: number
    // Gravity off (the layout token's float switch); the size and rotation
    // verbs resolve their own overlaps then
    float: boolean
    // Uniform auto-layout (the token's uniform switch); the context menu's
    // fill verbs route by it
    uniform: boolean
    // Manual crop (the editable base) and the derived fit-to-cell auto crop
    crop: CropRect | null
    autoCrop: CropRect | null
    trim: TrimRange | null
    // This pin's layout lock and its single-item setter
    lock: PinLock
    // This pin's D4 orientation; null is identity
    orientation: PinOrientation | null
    // This pin's stored playback snapshot (null = never stamped) and its
    // record writer. The writer is a replace-history URL write; it fires on
    // every user playback transition (see onUserTransition below).
    audio: PinAudioState | null
    onAudioChange: (audio: PinAudioState) => void
    // While true (the board was recently hovered), ACTIVE lock toggles are
    // shown on every locked pin so locks are visible at a glance
    lockBadgesVisible: boolean
    onLockChange: (lock: PinLock) => void
    // The board's open crop item, whichever pin it is; cropMode is just
    // whether that is this one. The context menu's layout verbs need the
    // board-wide key to hold the crop window still (see resolveGrowth).
    cropKey: string | null
    cropMode: boolean
    boxResizing: boolean
    imageExtentRef?: React.MutableRefObject<(() => CropGeometry | null) | null>
    onCropModeToggle: () => void
    onCropChange: (crop: CropRect | null) => void
    onTrimChange: (trim: TrimRange | null) => void
    onDuplicate: () => void
    // Removal writers, all record splices owned by the board (this
    // component only holds geometry): this pin's own Unpin, and the two
    // selection-scoped removals the context menu mirrors from the toolbar
    onUnpin: () => void
    onRemove: (keys: string[]) => void
    onRemoveAllBut: (keys: string[]) => void
    scrollAreaRef: React.RefObject<HTMLDivElement | null>
    // The EFFECTIVE grid (see effGrid in the board) and the measured board
    // width — the context menu publishes both onward for the board-global
    // section's "Scale With Window" toggle
    grid: GridParams
    gridWidth: number
    isV1: boolean
    onUpgradeGrid: () => void
    dbs: {
        index_db: string | null
        user_data_db: string | null
    }
}) {
    const { data } = $api.useQuery("get", "/api/items/item", {
        params: {
            query: {
                ...dbs,
                id: sha256,
                id_type: "sha256" // Supports prefix or full sha256 hash
            },
        }
    })
    // The playability tri-state (lib/videoPlayability.ts), the same ladder the
    // gallery runs: `unsupported` is the only verdict with no play affordance
    // (and no `data-playable` band), `needs-transcode` plays the server's
    // rendition. The item query already carries both codec columns and the
    // stream counts.
    const transcodeEnabled = useVideoTranscodeEnabled()
    const playability = useVideoPlayability(data?.item, transcodeEnabled)
    const isPlayable = playability !== "unsupported"
    const videoRef = React.useRef<HTMLVideoElement>(null)
    // The element as STATE alongside the ref: a needs-transcode pin mounts its
    // <video> when the job finishes, long after showVideo flipped, and the
    // hook's volume/speed effects have no other way to notice. Memoised so the
    // callback ref keeps one identity — an inline arrow would detach and
    // reattach the element on every render.
    const [videoEl, setVideoEl] = React.useState<HTMLVideoElement | null>(null)
    const attachVideo = React.useCallback((el: HTMLVideoElement | null) => {
        videoRef.current = el
        setVideoEl(el)
    }, [])
    // The stored snapshot as READ-ONCE state, captured at mount: the parsed
    // prop's identity churns with every board write (the extras maps
    // rebuild wholesale), and a restore keyed on the live prop would re-fire
    // into playback the user has since changed. A remount (the pin keys
    // embed record offsets, so unpinning a neighbour remounts this pin, and
    // its <video> with it) re-seeds from the then-current record — which is
    // exactly the restore that keeps the pin playing across the remount.
    const [audioAtMount] = React.useState(audio)
    // Set when the autoplay policy refused the restore's unmuted play():
    // the pin plays muted until the first user gesture applies the stored
    // unmuted state (see the listener effect below). Cleared by any user
    // transition on the pin — once the user has spoken, the fallback must
    // not stomp their choice.
    const blockedUnmuteRef = React.useRef(false)
    const videoState = useVideoPlayerState({
        videoRef,
        element: videoEl,
        persistVolume: true,
        // Every user playback transition snapshots the pin's FULL effective
        // state into its record — pressing play stamps the muted/volume it
        // just inherited, so the pin restores identically even after the
        // global preference drifts. Heuristic starts and restores go
        // through the raw setters/applyAudioState and never stamp.
        onUserTransition: (snap) => {
            blockedUnmuteRef.current = false
            onAudioChange(snap)
        },
    })
    // The pin's content layer: the only element containing BOTH the <video>
    // (which lives inside the .drag-handle layer) and the player surface
    // (which must not). It is the player's pointer container and its
    // fullscreen target, and its width drives the player's size ladder —
    // the surface's tier is a prop, not a container query, and --spacing
    // (which the pin does scope by container query) says nothing about it.
    const contentRef = React.useRef<HTMLDivElement>(null)
    const [contentWidth, setContentWidth] = React.useState(0)
    React.useEffect(() => {
        const el = contentRef.current
        if (!el) return
        const measure = () => setContentWidth(el.clientWidth)
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    // Double-click makes this pin the app-level current item — the same
    // thing the corner select button does. Independent of the board's own
    // multi-selection: the two clicks it is made of just select the pin
    // there, which double-clicking implies anyway.
    const setCurrentItem = useItemSelection((s) => s.setItem)
    const selectAsCurrentItem = () => {
        if (!data?.item || !data.files?.length) return
        const file = data.files[0]
        setCurrentItem({
            file_id: file.id,
            path: file.path,
            sha256: data.item.sha256,
            item_id: data.item.id,
            last_modified: file.last_modified,
            type: data.item.type,
            width: data.item.width,
            height: data.item.height,
            // The gallery headers read this off the selection when the item
            // is not in the current result page, exactly as they read the
            // fields below — without it, the size line vanishes for
            // pin-selected items and reads as a bug rather than as a
            // missing value.
            size: data.item.size,
            // The gallery's own player needs these for outro skip, and this
            // snapshot is what it renders when the item is not in the
            // current result page (see currentItem in ImageGallery).
            // `duration` is what end-anchors the cut point.
            duration: data.item.duration,
            content_end_ms: data.item.content_end_ms,
        })
    }

    // Natural dimensions read off the media element itself. The item query
    // above is the authoritative source, but on a fresh page load it races
    // the (usually browser-cached) thumbnail: while it's in flight CropView
    // has no dimensions and can't place a stored crop. The crop math only
    // uses the aspect ratio, which the thumbnail preserves, so the element's
    // own dimensions are an exact stand-in the moment it can paint.
    // Both sources report SOURCE dimensions (an element knows nothing of the
    // pin's orientation); CropView swaps them for odd quarter turns.
    const [mediaDims, setMediaDims] = useState<{ w: number; h: number } | null>(null)
    const noteMediaDims = (w: number, h: number) => {
        if (!w || !h) return
        setMediaDims((prev) => prev && prev.w === w && prev.h === h ? prev : { w, h })
    }
    const naturalSize = data?.item?.width && data?.item?.height
        ? { w: data.item.width, h: data.item.height }
        : mediaDims

    // Precedence: record > heuristic > global preference. Any stored
    // snapshot — a stopped one included — stands the heuristic down: a
    // short video the user explicitly closed must not loop back to life on
    // reload, and one they unmuted restores through the restore effect
    // below, not through this. The MOUNT snapshot plus a one-shot latch,
    // never the live prop: records influence playback at mount only, the
    // same invariant the restore effects hold. A live gate would re-fire on
    // Back/Forward — audio stamps are replace writes, so Back can revert
    // the segment to absent under a still-mounted pin, and a re-armed
    // heuristic would mute the video the user is watching. The latch also
    // keeps `data` identity churn (query refetches) from re-running the
    // start against a pin the user has since paused.
    const heuristicFiredRef = React.useRef(false)
    useEffect(() => {
        if (audioAtMount || heuristicFiredRef.current) return
        // `playable` ONLY, never the tri-state: a board that laid out a
        // dozen unplayable pins would otherwise queue a dozen encodes by
        // merely existing. A transcode is started by a deliberate press and
        // by nothing else.
        if (playability === "playable") {
            // Autoplay short videos
            if (data?.item?.duration && data?.item.duration <= 10) {
                heuristicFiredRef.current = true
                videoState.setShowVideo(true)
                videoState.setVideoIsPlaying(true)
                videoState.setVideoIsMuted(true)
            }
        }
    }, [data, playability, audioAtMount])

    useEffect(() => {
        if (!cropMode) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onCropModeToggle()
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [cropMode, onCropModeToggle])

    // The bytes this pin mounts: the original file when the browser can
    // decode it, the artifact once a needs-transcode item's job finishes,
    // null until then. The download row and the drag-out keep `file`.
    const playback = useVideoPlayback({
        // The board's own records carry a 10-char PREFIX; the job store is
        // keyed by the full hash so a pin and the gallery share one job (and
        // so the POST never asks the server to disambiguate a prefix). Null
        // until the item query resolves — which is also when `playability`
        // stops saying `unsupported`, so nothing is playable before then
        // anyway.
        sha256: data?.item?.sha256 ?? null,
        playability,
        fileURL: file,
        dbs,
    })
    const playbackURL = playback.url

    // Restoring the stored snapshot, in three read-only steps (none of them
    // stamps — a load must leave the record byte-identical):
    //
    // 1. The audio fields apply at mount, playing or stopped: a dormant
    //    record still seeds the muted/volume the next play uses, overriding
    //    the global-preference seed the hook's own mount effect applied
    //    (this one runs after it — hook effects run in call order).
    useEffect(() => {
        if (audioAtMount) {
            videoState.applyAudioState(audioAtMount.muted, audioAtMount.volume)
        }
        // Mount-only: audioAtMount is the mount capture by construction
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    // 2. A playing record starts playback once the item's verdict arrives
    //    (`unsupported` doubles as "no item data yet", so waiting out that
    //    verdict IS waiting for the query; a genuinely unsupported item
    //    simply never restores). One-shot: the latch, not the effect deps,
    //    decides — later verdict flips (the in-session downgrade) must not
    //    re-run a restore the user has since overridden.
    const restoredRef = React.useRef(false)
    const pendingUnmutedPlayRef = React.useRef(false)
    useEffect(() => {
        if (restoredRef.current || !audioAtMount?.playing) return
        if (playability === "unsupported") return
        restoredRef.current = true
        // A playing needs-transcode pin auto-starts its job on load — the
        // one deliberate exception to "a transcode starts only from a
        // press": the stored playing state IS the press, made last session,
        // and the disk cache usually still holds the artifact.
        if (playability === "needs-transcode") playback.start()
        // Unmuted restores need an explicit play() probe: the autoplay
        // policy may refuse them, and the autoPlay attribute fails
        // silently. Armed here, run by the element effect below.
        if (!audioAtMount.muted) pendingUnmutedPlayRef.current = true
        videoState.setShowVideo(true)
        videoState.setVideoIsPlaying(true)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playability])
    // 3. The unmuted-play probe, once the element exists. A NotAllowedError
    //    is the policy asking for a gesture: fall back to muted playback
    //    (always allowed) and leave the finish to the gesture listener
    //    below. Any other rejection (AbortError on a src swap,
    //    NotSupportedError racing onError) resolves through its own
    //    channel, exactly as in setPlaying.
    useEffect(() => {
        if (!videoEl || !pendingUnmutedPlayRef.current) return
        pendingUnmutedPlayRef.current = false
        videoEl.muted = false
        videoEl.play().catch((err: unknown) => {
            if ((err as DOMException)?.name !== "NotAllowedError") return
            videoEl.muted = true
            videoState.setVideoIsMuted(true)
            blockedUnmuteRef.current = true
            videoEl.play().catch(() => {})
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [videoEl])
    // The finishing gesture for blocked restores: the first user gesture
    // anywhere (the same gesture that unlocks audio for the page) applies
    // the stored unmuted state — zero added gestures, the user was about to
    // interact anyway. Applying stored state is not a user transition, so
    // it goes through the raw setter and never stamps. The raw setter's
    // identity is stable, so the mount-time closure stays valid for the
    // pin's life.
    useEffect(() => {
        const onGesture = () => {
            if (!blockedUnmuteRef.current) return
            blockedUnmuteRef.current = false
            const el = videoRef.current
            if (el) el.muted = false
            videoState.setVideoIsMuted(false)
        }
        window.addEventListener("pointerdown", onGesture, true)
        window.addEventListener("keydown", onGesture, true)
        return () => {
            window.removeEventListener("pointerdown", onGesture, true)
            window.removeEventListener("keydown", onGesture, true)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    const showVideo = isPlayable && videoState.showVideo && playbackURL != null
    // A detected TikTok end card is a playback-time DEFAULT for the end
    // bound, never a stored one: the pin's h field keeps carrying the user's
    // trim alone (docs/video-outro-skip-design.md §1). The item query already
    // returns content_end_ms, and the API nulls it when the index DB has
    // detection off, so no config plumbing reaches the player.
    // The element's own duration: the cut point is anchored to the END of
    // the browser's timeline (the card is appended there, and edit lists /
    // audio priming shift the origin away from ffprobe's), and the rail
    // draws its geometry from the same one number.
    // sha as reset key: a pin swaps `src` in place under an unchanged ref
    // and unchanged showVideo when the board reflows, and the departed
    // item's duration must not anchor the new item's cut
    const browserDuration = useVideoDuration(videoRef, showVideo, sha256)
    const outroSkip = useOutroSkipEnabled()
    // The measured end of the video track in the browser's timeline, which
    // replaces the split-the-difference estimate above with arithmetic
    // (lib/videoEndProbe.ts). It runs on its OWN offscreen element — the
    // pin's <video> is never seeked by it — and is deduplicated per sha with
    // a concurrency cap, which is what makes it safe on a board that mounts
    // dozens of eligible pins in one pass. The EFFECTIVE playback URL, not
    // `file`: the probe measures the bytes the element mounts, and a
    // transcoded rendition has its own timeline — hence also the null gate,
    // since an item still waiting on its encode has nothing to measure. The
    // cache stays keyed by the pin's sha either way.
    const probedVideoEnd = useVideoEndProbe(
        playbackURL,
        sha256,
        playbackURL != null
        && outroSkip && outroProbeEligible(data?.item?.content_end_ms, data?.item?.duration),
    )
    const outroCut = outroCutPoint(
        data?.item?.content_end_ms,
        data?.item?.duration,
        browserDuration,
        probedVideoEnd,
    )
    const effectiveTrim = effectiveVideoTrim(trim, outroCut, outroSkip)
    // Whether the outro default is what ends playback here. The context menu's
    // clip rows turn this into `cut: "outro"` rather than sending the client's
    // own cut point (see lib/videoClip's clipRequestFor).
    const outroGoverns = outroSkipGoverns(trim, outroCut, outroSkip)
    useVideoTrim({ videoRef, trim: effectiveTrim, active: showVideo })
    // The FULL hash and the item's type, for the menu's clip rows: the board's
    // records carry only a 10-char prefix, and only a video has a clip.
    // The duration rides along for the animated-image rows, which are offered
    // only inside the server's length cap and have nothing else to measure an
    // untrimmed export against.
    const clipItem = data?.item
        ? {
            sha256: data.item.sha256,
            mime: data.item.type,
            duration: data.item.duration,
        }
        : null
    // Native controls stand the whole player world down (only the escape
    // kebab remains), so the controller is inactive there too. Crop mode
    // stands it down as well: the surface would sit on the crop area's
    // bottom band, over the pan/resize layer that IS the tool while that
    // mode runs. showOnEnable stays off: a board of autoplaying pins would
    // flash every surface at once on load — the S0 play button reveals its
    // own surface instead.
    const playerActive = showVideo && !videoState.showControls && !cropMode
    const player = useVideoPlayerSurface({
        videoRef,
        active: playerActive,
        fullscreenTargetRef: contentRef,
    })

    // Rendering shows the composition of both crop slots; the crop editor
    // edits the manual slot only (the auto crop is derived from it and gets
    // cleared when a new manual crop is committed)
    const effectiveCrop = composeCrops(crop, autoCrop)

    return (
        <>
            {/* Content layer. The overlay buttons below stay OUTSIDE it: they
                are item verbs, they must remain direct children of
                .pinboard-pin for the `> button` z-index rule in globals.css,
                and keeping them out means fullscreen shows the picture and
                the player alone. data-playable reserves the bottom band in
                the pin's --spacing clamp before any <video> exists (see
                globals.css). */}
            <div
                ref={contentRef}
                data-playable={isPlayable ? "" : undefined}
                // Crop mode is the board's THIRD modal gesture, and the only
                // one with no overlay element of its own — it restyles this
                // pin instead. It exits on Esc through the window listener
                // above, so it has to be discoverable to the surfaces that
                // would otherwise swallow the key (PreviewSurface's guard,
                // which explains the attribute): without this, Esc with the
                // viewer open closed the VIEWER, tearing down a playing
                // video, and left the pin still cropping.
                data-esc-owner={cropMode ? "" : undefined}
                className={cn(
                    "pinboard-pin-content absolute inset-0",
                    player.cursorHidden && "cursor-none",
                )}
                // Only while the player world is on: these fire on every
                // pointer move, and neither an image pin nor a pin handed
                // over to the native controls has a surface to reveal
                {...(playerActive ? player.containerProps : null)}
            >
                <ContextMenu>
                    <ContextMenuTrigger>
                        <div
                            className={cn(
                                "absolute top-0 left-0 w-full h-full",
                                !cropMode && "drag-handle cursor-move",
                            )}
                            onDoubleClick={cropMode ? undefined : selectAsCurrentItem}
                        >
                            {/* Playing videos always render through CropView (even
                                uncropped: rest mode with a null crop is a plain
                                contain fit) so toggling crop mode only restyles the
                                <video> instead of remounting it, which would reset
                                the playback position. Oriented items route here for
                                the same reason the crop does — CropView owns the
                                source-to-display transform, and duplicating it on
                                the plain contain-fit branch below would be a second
                                copy of the same eight cases. */}
                            {(cropMode || effectiveCrop || showVideo || !isIdentityOrientation(orientation)) ?
                                <CropView
                                    crop={cropMode ? crop : effectiveCrop}
                                    cropMode={cropMode}
                                    boxResizing={boxResizing}
                                    imageExtentRef={imageExtentRef}
                                    naturalWidth={naturalSize?.w}
                                    naturalHeight={naturalSize?.h}
                                    orientation={orientation}
                                    onCropChange={onCropChange}
                                    ghostSrc={showVideo ? undefined : thumbnail}
                                    renderMedia={(style) => showVideo ?
                                        <video
                                            ref={attachVideo}
                                            autoPlay
                                            // With a trim set, looping is handled by
                                            // useVideoTrim so it restarts from the
                                            // trim start rather than 0. The
                                            // EFFECTIVE trim: an outro-skipping pin
                                            // has a loop point with no user trim.
                                            loop={isEmptyTrim(effectiveTrim)}
                                            muted={videoState.videoIsMuted}
                                            controls={videoState.showControls}
                                            className="rounded"
                                            style={style}
                                            src={playbackURL ?? undefined}
                                            onLoadedMetadata={(e) => noteMediaDims(
                                                e.currentTarget.videoWidth,
                                                e.currentTarget.videoHeight,
                                            )}
                                            // A failing ARTIFACT is the job's
                                            // problem, not evidence about the
                                            // source: the disk cache can
                                            // evict it between `done` and
                                            // this fetch, and one automatic
                                            // re-POST recovers it. A failing
                                            // SOURCE is the representative-
                                            // profile recovery (docs/video-
                                            // transcoding-design.md §6) —
                                            // but only on a DECODE error,
                                            // never on a network one, or a
                                            // blip would cost this sha its
                                            // native playback for the
                                            // session.
                                            onError={(e) => {
                                                if (playback.isArtifact) {
                                                    playback.noteArtifactError()
                                                    return
                                                }
                                                if (playability === "playable"
                                                    && shouldDowngradeOnError(
                                                        e.currentTarget.error)) {
                                                    noteVideoPlaybackError(
                                                        data?.item?.sha256 ?? sha256)
                                                }
                                            }}
                                            // The artifact played: re-arm the
                                            // one automatic recovery
                                            onPlaying={playback.notePlaying}
                                        />
                                        :
                                        <img
                                            src={thumbnail}
                                            alt={`Sha256 Hash ${sha256}`}
                                            draggable={false}
                                            className="rounded select-none"
                                            style={style}
                                            // The ref covers cache hits that complete
                                            // before React attaches the load handler
                                            ref={(el) => {
                                                if (el?.complete) noteMediaDims(el.naturalWidth, el.naturalHeight)
                                            }}
                                            onLoad={(e) => noteMediaDims(
                                                e.currentTarget.naturalWidth,
                                                e.currentTarget.naturalHeight,
                                            )}
                                        />
                                    }
                                />
                                :
                                <Image
                                    src={thumbnail}
                                    alt={`Sha256 Hash ${sha256}`}
                                    fill
                                    className="rounded object-contain"
                                    unoptimized={true}
                                />}
                        </div>
                    </ContextMenuTrigger>
                    <PinBoardCtx
                        layoutKey={layoutKey}
                        sha256={sha256}
                        file_url={file}
                        onLayoutChange={onLayoutChange}
                        layout={layout}
                        crops={crops}
                        autoCrops={autoCrops}
                        locks={locks}
                        orients={orients}
                        highWater={highWater}
                        float={float}
                        uniform={uniform}
                        cropKey={cropKey}
                        cropMode={cropMode}
                        hasCrop={!!(crop || autoCrop)}
                        onToggleCrop={onCropModeToggle}
                        onClearCrop={() => onCropChange(null)}
                        trim={trim}
                        onTrimChange={onTrimChange}
                        effectiveTrim={effectiveTrim}
                        outroGoverns={outroGoverns}
                        clipItem={clipItem}
                        // The set-at-playhead loop verbs read the element
                        // directly, and only exist while there is a playhead
                        // to read (they are the trim UI for pins too narrow
                        // for the player's own row)
                        videoRef={videoRef}
                        videoLoaded={showVideo}
                        onDuplicate={onDuplicate}
                        onUnpin={onUnpin}
                        onRemove={onRemove}
                        onRemoveAllBut={onRemoveAllBut}
                        lock={lock}
                        onLockChange={onLockChange}
                        pinboardRef={scrollAreaRef}
                        grid={grid}
                        gridWidth={gridWidth}
                        isV1={isV1}
                        onUpgradeGrid={onUpgradeGrid}
                        dbs={dbs}
                    />
                </ContextMenu>
                {/* S1. A sibling of the .drag-handle layer, never a child of
                    it, so react-grid-layout (DRAG_CONFIG handle
                    ".drag-handle") can never start a grid drag from the
                    player; the surface root additionally stops pointer,
                    mouse and click events, which covers the board's own
                    bubble-phase handlers. The board's capture-phase
                    selection handlers still see the press, exactly as they
                    did through the old timeline, and skip it for every
                    control that is a <button>. */}
                {showVideo && !cropMode && (videoState.showControls
                    // The video's top-right belongs to Select and Navigate on
                    // a pin; the escape kebab takes the next seat down the
                    // same edge
                    ? <NativeControlsEscape videoState={videoState} className="top-26" />
                    : <VideoPlayerSurface
                        videoRef={videoRef}
                        videoState={videoState}
                        controller={player}
                        trim={trim}
                        onTrimChange={onTrimChange}
                        outroCutPoint={outroCut}
                        duration={browserDuration}
                        // Same URL the element plays. The name needs the
                        // item query (the board's records carry a sha256
                        // prefix and nothing else), so the row appears with
                        // the data rather than waiting on it.
                        download={data ? {
                            url: file,
                            filename: downloadFileName(
                                data.files?.[0]?.path,
                                data.item?.sha256 ?? sha256,
                                data.item?.type),
                        } : undefined}
                        size={playerSizeForWidth(contentWidth)}
                    />)}
            </div>
            <PinButton sha256={sha256} layoutKey={layoutKey} hidePins={true} />
            <button
                title={cropMode ? "Finish cropping" : "Crop this image"}
                className={cn(
                    "hover:scale-105 absolute top-2 left-14 rounded-full p-2 transition-opacity duration-300",
                    cropMode
                        ? "opacity-100 bg-blue-200"
                        : "opacity-0 group-hover:opacity-100 bg-white",
                )}
                onClick={onCropModeToggle}
            >
                {cropMode ? (
                    <Check className="w-6 h-6 text-gray-800" />
                ) : (
                    <Crop className="w-6 h-6 text-gray-800" />
                )}
            </button>
            {/* Layout locks. An ACTIVE lock doubles as the item's badge: it
                shows whenever the board was recently hovered (see
                lockBadgesVisible), so locks are visible at a glance while
                laying out but fade away during plain viewing. Inactive
                toggles only appear on this pin's own hover like the other
                overlay controls. */}
            <button
                title={lock === "anchor"
                    ? "Anchored in place: position and size fixed, layouts pack around it — click to release"
                    : "Anchor in place (lock position and size)"}
                className={cn(
                    "hover:scale-105 absolute top-2 left-26 rounded-full p-2 transition-opacity duration-300",
                    lock === "anchor" ? "bg-blue-200" : "bg-white",
                    lock === "anchor" && lockBadgesVisible
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100",
                )}
                onClick={() => onLockChange(lock === "anchor" ? null : "anchor")}
            >
                <Anchor className="w-6 h-6 text-gray-800" />
            </button>
            <button
                title={lock === "size"
                    ? "Size locked: keeps this size, may still be moved — click to unlock"
                    : "Lock size (item keeps its size, can still be moved)"}
                className={cn(
                    "hover:scale-105 absolute top-2 left-38 rounded-full p-2 transition-opacity duration-300",
                    lock === "size" ? "bg-blue-200" : "bg-white",
                    lock === "size" && lockBadgesVisible
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100",
                )}
                onClick={() => onLockChange(lock === "size" ? null : "size")}
            >
                <Ruler className="w-6 h-6 text-gray-800" />
            </button>
            {/* `?? null` is load-bearing: null means PENDING, undefined
                means "this call site has no files". Passing `data?.files`
                raw collapsed the two, and inside the loading window the
                button fell back to the sha CONTENT test — which opens the
                Data View on the wrong row for a duplicate or hardlink of
                the selected file (see SelectButton's isReClick). */}
            <SelectButton
                sha256={sha256}
                item={data?.item}
                files={data?.files ?? null}
            />
            {/* S0 only: the play button is the last overlay verb ("become a
                player"), and it sits bottom-LEFT so the cursor is already on
                the player row's play/pause the moment S1 comes up. Once the
                video is loaded the surface owns mute, close and the native
                toggle, so MediaControls stands down entirely. show() gives the
                deliberate press its surface without showOnEnable, which
                would flash every autoplaying pin on the board. */}
            {isPlayable && !showVideo && <MediaControls
                isPlaying={false}
                setPlaying={(playing) => {
                    // The only thing that ever starts a playback transcode:
                    // a deliberate press (a no-op on a playable pin, and
                    // deduplicated per sha:preset, so pressing again while
                    // the job runs joins it).
                    playback.start()
                    videoState.setPlaying(playing)
                    player.show()
                }}
                progress={playback.badge}
                playButtonClassName="left-2 bottom-2"
            />}
            {/* Navigate has one permanent home on pins: the right edge under
                Select, for image and video pins alike, in every state. It is
                an item verb, so it never moves out of the player's way and
                never joins the kebab; bottom-left is the play button's and
                bottom-right is reserved for the player's own group.
                z-20 explicitly: once the hover prefetch resolves a link this
                button renders inside an <a>, which the `.pinboard-pin >
                button` rule in globals.css no longer matches — without it the
                button silently drops behind the resize handles the moment it
                is prefetched. The <a> is static, so both the offsets and the
                z-index still resolve against the pin. */}
            <FindButton
                id={data?.files[0]?.id || sha256}
                id_type={data?.files[0] ? "file_id" : "sha256"}
                path={data?.files[0]?.path || ""}
                buttonClassName="bottom-auto left-auto top-14 right-2 z-20"
            />
        </>
    )
}

export function usePinItem() {
    const prefixLength = 10 // The length of the prefix of the sha256 hash
    const { updateRecords } = usePinBoard()
    // Trim rides along with the act of pinning: a new record takes the
    // gallery's trim when the `vt` slot belongs to this item (see
    // newPinHField), and a bare height otherwise
    const galleryTrim = useGalleryTrim()
    const pinItem = (sha256: string, pos?: { x: number, y: number, w: number, h: number }) => {
        updateRecords((records, grid) => {
            // An explicit position (e.g. from a drop) is already in the
            // board's grid units; the fallback size is 2x2 in v1 units,
            // placed in the first free slot found scanning starting at the
            // bottom row (see pinboardPlace.ts)
            const { sx, sy } = v1ScaleFactors(grid)
            const w = Math.round(2 * sx)
            const h = Math.round(2 * sy)
            const p = pos ?? { ...placeNewPin(records, grid, w, h), w, h }
            return [
                ...records,
                sha256.slice(0, prefixLength),
                p.x.toString(),
                p.y.toString(),
                p.w.toString(),
                newPinHField(p.h, sha256, galleryTrim),
            ]
        })
    }
    return { pinItem }
}
