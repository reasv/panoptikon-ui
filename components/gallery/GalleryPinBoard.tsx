import Image from 'next/image'
import { cn, getFileURL } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"
import { useGalleryFullscreen, useGalleryPinAutoCrop, useGalleryPinAutoLayout, useGalleryPinGrid, useGalleryPinSelectionCrop } from '@/lib/state/gallery'
import { consumePinboardExplicitPlacement, consumePinboardNavigation, consumePinboardPendingEdit, markPinboardExplicitPlacement } from '@/lib/pinboardNavigation'
import { usePinBoard } from '@/lib/state/pinboard'
import { GridParams, minPinUnits, rowStep, v1ScaleFactors } from '@/lib/pinboardGrid'
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
import { useVideoPlayerState } from '@/lib/videoPlayerState'
import { CropRect, PinLock, TrimRange, clampCrop, composeCrops, isEmptyTrim, packHField, parseHField } from '@/lib/pinboardCrop'
import { useVideoTrim } from '@/lib/videoTrim'
import { CropGeometry, CropView } from './CropView'
import { VideoTimeline } from './VideoTimeline'
import { Anchor, ArrowLeftRight, ArrowLeftToLine, ArrowRightFromLine, ArrowRightToLine, Check, ChevronDown, Columns3, Crop, Dices, Expand, FlipHorizontal2, FlipVertical2, FoldHorizontal, GripVertical, LayoutDashboard, LockOpen, Maximize, Ruler, Scaling, SquareDashed, X, type LucideIcon } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
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

const ALL_RESIZE_HANDLES: LayoutItem["resizeHandles"] =
    ["s", "w", "e", "n", "sw", "nw", "se", "ne"]

// Static grid configs (referentially stable so the grid's internal memos
// don't churn). The board's own drags start only from .drag-handle layers;
// resize handles come from react-resizable with the default 'se' unless an
// item overrides resizeHandles (the crop-mode item gets all eight).
// threshold: 0 is v1 drag semantics (drag starts on mousedown) and is NOT
// optional: RGL v2's external-drop placeholder drives its grid item through a
// synthetic drag whose fake events never move, so a nonzero threshold leaves
// that drag stuck in the pending state and the hover machinery loops React
// into a nested-update crash. Clicks on the overlay buttons are unaffected —
// they sit outside the .drag-handle layer.
const DRAG_CONFIG = { enabled: true, handle: ".drag-handle", threshold: 0 }
const RESIZE_CONFIG = { enabled: true }
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
}
const SELECTION_VERBS: SelectionVerb[] = [
    {
        id: "arrange", label: "Arrange", icon: LayoutDashboard, min: 2,
        title: "Rearrange the selected items within their combined bounding box",
    },
    {
        id: "swap", label: "Swap", icon: ArrowLeftRight, exact: 2,
        title: "Selected items exchange position and size (select exactly two)",
    },
    {
        id: "hole", label: "Move to Hole", icon: SquareDashed,
        title: "Pick an empty area to move the selection into — click a hole, or drag to carve a spot",
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
    {
        id: "mirrorH", label: "Mirror Horizontally", icon: FlipHorizontal2, min: 2, noAnchors: true,
        title: "Mirror the selected items' arrangement about their vertical middle",
    },
    {
        id: "mirrorV", label: "Mirror Vertically", icon: FlipVertical2, min: 2, noAnchors: true,
        title: "Mirror the selected items' arrangement about their horizontal middle",
    },
    {
        id: "clearCrop", label: "Clear Auto-Crops", icon: Maximize,
        title: "Remove the selected items' auto crops, letterboxing the full image",
    },
]
const TOOLBAR_VERBS_KEY = "pinboardToolbarVerbs"
const DEFAULT_TOOLBAR_VERBS = ["arrange", "swap"]
// Pinnable non-verb: the Send to Region submenu. On the bar it becomes an
// icon button opening the preset menu rather than acting directly.
const REGION_MENU_ID = "region"
// Bar display order for pinned controls: the dropdown's own verb order,
// with the region menu slotted right after Swap. Rendering follows this
// list rather than pin-toggle order, so the bar is stable no matter when
// each control was pinned.
const BAR_ORDER = SELECTION_VERBS.flatMap(v =>
    v.id === "swap" ? [v.id, REGION_MENU_ID] : [v.id])

export function PinBoard(
    {
        thumbnailsOpen,
        showPagination = true
    }: {
        thumbnailsOpen: boolean
        showPagination?: boolean
    }
) {
    const dbs = useSelectedDBs()[0]
    // Token-stripped records plus the board's grid parameters; writes migrate
    // v1 boards to the v2 grid (see lib/pinboardGrid.ts)
    const { grid, records, isV1, highWater, updateRecords, upgradeGrid } = usePinBoard()
    // Key of the item currently in crop mode, if any
    const [cropKey, setCropKey] = useState<string | null>(null)
    // True while the crop-mode item's box is being resized via a grid handle
    const [cropResizing, setCropResizing] = useState(false)
    // Getter for the crop-mode image's viewport extent, set by its CropView
    const cropImageExtentRef = useRef<(() => CropGeometry | null) | null>(null)
    // Width of the grid area, observed by RGL's own hook (the successor of
    // the WidthProvider HOC: same 1280 SSR default, rAF-throttled observer).
    // The grid renders ungated so SSR still paints items (at percentage
    // positions, see rglSettling below). Declared above the layout memo
    // because the minimum-size floors depend on the measured column width.
    const { width: gridWidth, containerRef: gridAreaRef } = useContainerWidth()
    const [layout, pinnedFiles, crops, autoCrops, trims, itemLocks]: [
        LayoutItem[],
        [string, string, string, string][],
        Record<string, CropRect | null>,
        Record<string, CropRect | null>,
        Record<string, TrimRange | null>,
        Record<string, PinLock>,
    ] = useMemo(() => {
        const newLayout: LayoutItem[] = []
        const pinned: [string, string, string, string][] = []
        const cropsMap: Record<string, CropRect | null> = {}
        const autoCropsMap: Record<string, CropRect | null> = {}
        const trimsMap: Record<string, TrimRange | null> = {}
        const locksMap: Record<string, PinLock> = {}
        // Minimum-size floors for resize gestures. RGL applies minW/minH
        // through gesture-time constraints only — the layout sync never
        // clamps — so records already below the minimum (legacy boards,
        // relaxed degenerate layouts) render untouched and only snap up to
        // the minimum when actually resized. The crop-mode item is exempt:
        // its box is the crop window, which may legitimately be tiny.
        const colWidth = (gridWidth - 2 * grid.padding
            - (grid.columns - 1) * grid.margin) / grid.columns
        const { minW, minH } = minPinUnits(grid, colWidth)
        for (let i = 0; i < records.length; i += 5) {
            const [sha256, x, y, w, hField] = records.slice(i, i + 5)
            const index = `${i}-${sha256}`
            const { h, crop, autoCrop, trim, lock } = parseHField(hField)
            cropsMap[index] = crop
            autoCropsMap[index] = autoCrop
            trimsMap[index] = trim
            locksMap[index] = lock
            newLayout.push({
                i: index,
                x: parseInt(x),
                y: parseInt(y),
                w: parseInt(w),
                h,
                ...(index === cropKey
                    ? { resizeHandles: ALL_RESIZE_HANDLES }
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
        return [newLayout, pinned, cropsMap, autoCropsMap, trimsMap, locksMap]
    }, [records, cropKey, dbs, grid, gridWidth])

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
    const rebuildRecords = (
        prev: string[],
        currentLayout: LayoutItem[],
        autoCropOverrides?: Record<string, CropRect | null>,
        manualCropOverrides?: Record<string, CropRect | null>,
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
            const { crop, autoCrop, trim, lock } = parseHField(prev[i + 4])
            const hasManual = manualCropOverrides && key in manualCropOverrides
            const nextCrop = hasManual ? manualCropOverrides[key] : crop
            const nextAuto = hasManual
                ? null // manual crop is the auto crop's base; the old auto is stale
                : autoCropOverrides && key in autoCropOverrides
                    ? autoCropOverrides[key]
                    : autoCrop
            next.push(
                prev[i],
                item.x.toString(),
                item.y.toString(),
                item.w.toString(),
                // Crop/trim/lock suffixes stored in the h field survive box
                // moves/resizes
                packHField(item.h, nextCrop, nextAuto, trim, lock),
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
    const onLayoutChange = (
        currentLayout: LayoutItem[],
        autoCropOverrides?: Record<string, CropRect | null>,
        newHighWater?: number,
        echo = false,
    ) => {
        const manualCropOverrides = pendingManualCropRef.current ?? undefined
        pendingManualCropRef.current = null
        // RGL fires onLayoutChange on every layouts-prop change and on mount,
        // not only on user interaction. If nothing actually moved, writing an
        // equal value back would push a redundant history entry and re-trigger
        // this handler — the write must only happen on real changes. This
        // guard is also what keeps merely *viewing* a v1 board from migrating
        // it: updateRecords only converts on writes. A fill that changed only
        // the ratchet still writes (updateRecords compares the ratchet too).
        const candidate = rebuildRecords(records, currentLayout, autoCropOverrides, manualCropOverrides)
        if (
            candidate.length === records.length &&
            candidate.every((v, i) => v === records[i]) &&
            newHighWater === undefined
        ) {
            return
        }
        updateRecords(
            (prev) => rebuildRecords(prev, currentLayout, autoCropOverrides, manualCropOverrides),
            {
                ...(newHighWater !== undefined ? { highWater: newHighWater } : {}),
                ...(echo ? { history: "replace" as const } : {}),
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
                const parsed = parseHField(prev[i + 4])
                next[i + 4] = packHField(parsed.h, parsed.crop, parsed.autoCrop, parsed.trim, lock)
            }
            return next
        })
    }

    // Append an identical copy of the pin's 5-string record (sha256, x, y, w,
    // packed h+crop). The offset embedded in the layout key locates the source
    // record; compactType="vertical" then nudges the copy off the original.
    const onDuplicatePin = (key: string) => {
        updateRecords((prev) => {
            const offset = parseInt(key.split("-")[0])
            const record = prev.slice(offset, offset + 5)
            if (record.length < 5) return prev
            return [...prev, ...record]
        })
    }

    // Writing the manual crop also clears the auto slot: the manual crop is
    // the base the auto crop was derived from, so any stored auto crop is
    // stale the moment the base changes
    const onItemCropChange = (key: string, crop: CropRect | null) => {
        updateRecords((prev) => {
            const next = [...prev]
            for (let i = 0; i < prev.length; i += 5) {
                if (`${i}-${prev[i]}` === key) {
                    const parsed = parseHField(prev[i + 4])
                    next[i + 4] = packHField(parsed.h, crop, null, parsed.trim, parsed.lock)
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
                    const parsed = parseHField(prev[i + 4])
                    next[i + 4] = packHField(parsed.h, parsed.crop, parsed.autoCrop, trim, parsed.lock)
                    break
                }
            }
            return next
        })
    }

    const [fs, setFs] = useGalleryFullscreen()
    const [showGrid] = useGalleryPinGrid()
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    // v1 boards use v1-unit sizes for new/dropped pins so they stay
    // consistent pre-migration; on the finer v2 grid the same physical size
    // is these units times the lattice scale factors
    const { sx, sy } = v1ScaleFactors(grid)
    // Grid measurement config for RGL; identity keyed on the scalar params so
    // unrelated re-renders don't churn the grid's internal position memos
    const gridConfig = useMemo(() => ({
        cols: grid.columns,
        rowHeight: grid.rowHeight,
        margin: [grid.margin, grid.margin] as [number, number],
        containerPadding: [grid.padding, grid.padding] as [number, number],
    }), [grid.columns, grid.rowHeight, grid.margin, grid.padding])
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
    const pinItem = usePinItem()
    // Auto-layout mode: when enabled, adding/removing/duplicating a pin —
    // or explicitly growing the board's viewport (see below) — re-runs the
    // viewport-filling mosaic over ALL items; with the auto-crop flag also
    // on, every item additionally gets fitted to its new cell in the same
    // write. The board's own layout-actions instance shares the machinery
    // the context menu uses.
    const [autoLayout] = useGalleryPinAutoLayout()
    const [autoLayoutCrop] = useGalleryPinAutoCrop()
    const [selectionCrop, setSelectionCrop] = useGalleryPinSelectionCrop()
    const {
        fillViewport, arrangeSelection, swapItems, autoCropSelection,
        clearAutoCropSelection, growSelection, mirrorSelection, shiftSelection,
        sendSelectionToRegion, sendSelectionToRect,
    } = usePinboardLayoutActions({
        layout, crops, autoCrops, locks: itemLocks, highWater, dbs, grid,
        layoutAutoCrop: autoLayoutCrop,
        selectionAutoCrop: selectionCrop,
        pinboardRef: scrollAreaRef,
        onLayoutChange,
    })
    // Layout verbs report refusals (anchored items that can't travel,
    // size-locked items that can't fit, packer failures) as messages
    // instead of silently doing nothing — surface them as toasts
    const { toast } = useToast()
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
            (areaH - 2 * grid.padding + grid.margin) / rowStep(grid)))
        return Math.max(highWater, fold)
    }, [holeMode, highWater, grid, gridAreaRef])
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
    const holeColW = (gridWidth - 2 * grid.padding
        - (grid.columns - 1) * grid.margin) / grid.columns
    const { minW: holeMinW, minH: holeMinH } = minPinUnits(grid, holeColW)
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
                r.x.toString(), r.y.toString(), r.w.toString(), r.h.toString(),
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
    // ---------------------------------------------------------------------
    // Floating toolbar placement, in CONTENT coordinates (it scrolls with
    // the board, staying glued to the selection). The bar hangs just above
    // the selection's bounding box — except with exactly two items at
    // different heights, where it hangs above the LOWER item's top edge:
    // a two-item bbox is mostly empty diagonal space, and two items are
    // usually selected to swap, so the seam between them is where the
    // mouse is. When the anchor is too close to the board's top for the
    // bar to fit, it pins just below the top edge instead (over the
    // selection — the drag grip below is the escape hatch for that).
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
    const toolbarPos = useMemo(() => {
        if (selected.length === 0 || !gridWidth) return null
        const colW = (gridWidth - 2 * grid.padding - (grid.columns - 1) * grid.margin) / grid.columns
        const unitX = colW + grid.margin
        const px = (x: number) => grid.padding + x * unitX
        const py = (y: number) => grid.padding + y * rowStep(grid)
        const maxY = layout.reduce((acc, l) => Math.max(acc, l.y + l.h), 0)
        // The bar never leaves the board: x within the inner width, y
        // between the top edge and the bottom of the board's content
        const clampPos = (x: number, y: number) => ({
            x: Math.min(
                Math.max(x, TOOLBAR_EDGE),
                Math.max(TOOLBAR_EDGE, gridWidth - toolbarSize.w - TOOLBAR_EDGE)),
            y: Math.min(
                Math.max(y, TOOLBAR_EDGE),
                Math.max(TOOLBAR_EDGE, py(maxY) - grid.margin - toolbarSize.h - TOOLBAR_EDGE)),
        })
        if (toolbarManual) return clampPos(toolbarManual.x, toolbarManual.y)
        const rects = layout.filter(l => selectedSet.has(l.i))
        if (rects.length === 0) return null
        let anchorTop: number
        let centerX: number
        if (rects.length === 2 && rects[0].y !== rects[1].y) {
            const lower = rects[0].y > rects[1].y ? rects[0] : rects[1]
            anchorTop = py(lower.y)
            centerX = px(lower.x) + (lower.w * unitX - grid.margin) / 2
        } else {
            const x0 = Math.min(...rects.map(l => l.x))
            const x1 = Math.max(...rects.map(l => l.x + l.w))
            anchorTop = py(Math.min(...rects.map(l => l.y)))
            centerX = (px(x0) + px(x1) - grid.margin) / 2
        }
        return clampPos(centerX - toolbarSize.w / 2, anchorTop - TOOLBAR_GAP - toolbarSize.h)
    }, [selected.length, toolbarManual, layout, selectedSet, gridWidth, grid, toolbarSize])
    // Dragging the grip moves the bar freely; on release it snaps
    // vertically to the nearest resting spot — just above an item's top
    // edge, or pinned below the board's top — so a parked bar sits at the
    // same kind of place the automatic anchor picks. Only items the bar
    // horizontally overlaps at its drop position count as snap targets: a
    // top edge on the far side of the board is not a visible line here,
    // and snapping to it would park the bar at a seemingly random height
    // through the middle of whatever it IS over. Horizontal stays
    // wherever it was dropped (clamped to the board).
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
            const colW = (gridWidth - 2 * grid.padding - (grid.columns - 1) * grid.margin) / grid.columns
            const unitX = colW + grid.margin
            const px = (x: number) => grid.padding + x * unitX
            const py = (y: number) => grid.padding + y * rowStep(grid)
            // The bar's resting x-span (clamped like the renderer clamps),
            // for the horizontal-overlap test
            const xl = Math.min(
                Math.max(raw.x, TOOLBAR_EDGE),
                Math.max(TOOLBAR_EDGE, gridWidth - toolbarSize.w - TOOLBAR_EDGE))
            const xr = xl + toolbarSize.w
            let best = TOOLBAR_EDGE
            for (const l of layout) {
                if (px(l.x) >= xr || px(l.x + l.w) - grid.margin <= xl) continue
                const c = py(l.y) - TOOLBAR_GAP - toolbarSize.h
                if (c >= TOOLBAR_EDGE && Math.abs(c - raw.y) < Math.abs(best - raw.y)) best = c
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
    // control or a floating panel starts a marquee.
    useEffect(() => {
        const onDown = (e: PointerEvent) => {
            if (e.button !== 0) return
            const t = e.target as HTMLElement | null
            if (!t) return
            const onFrame = t.hasAttribute?.("data-pinboard-frame")
            const fromViewport = fs && !isInteractiveTarget(t) && !t.closest?.(
                '[data-pinboard-area], [data-pin-key], [data-selection-toolbar],'
                + ' [data-pinboard-history], [data-radix-popper-content-wrapper],'
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
            if (e.key !== "Escape") return
            // While hole targeting is active Esc belongs to it (its own
            // listener cancels the targeting); the selection survives
            if (holeActiveRef.current) return
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
                || e.altKey || e.shiftKey) return
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
    // Pressing anywhere that isn't a pin, the selection toolbar or a popup
    // menu — the board background, the rest of the app — deselects, the
    // way every file manager does. Ctrl/shift presses are exempt so
    // additive marquees and range clicks can start anywhere. Capture
    // phase on document, so this runs before any React handler.
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
                + ' [data-radix-popper-content-wrapper], [role="menu"], [data-hole-overlay]'
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
        if (prev === null) {
            // First observation is normally just the baseline — but a
            // pending-edit mark means pins were added/removed from outside
            // the gallery (search-grid pin buttons) while this trigger was
            // unmounted, and that edit still needs laying out. Navigation
            // takes precedence: a restored version replaced those records.
            if (pendingEdit && !wasNavigation && count > 0 && autoLayoutRef.current) {
                void fillViewportRef.current(false)
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
        // no-ops on its own when the container can't be measured
        void fillViewportRef.current(false)
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
    return (
        // data-pinboard-area: the version-history panel docks into this
        // box's corners (PinboardHistory measures it by this attribute)
        <ScrollArea ref={scrollAreaRef} data-pinboard-area className="overflow-y-auto">
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
                    const gx = (e.clientX - rect.left - grid.padding) / (holeColW + grid.margin)
                    const gy = (e.clientY - rect.top - grid.padding) / rowStep(grid)
                    const r = pickRectAt(holeRects, gx, gy)
                    if (!r || !validHole(r)) {
                        holeToast("No hole under the drop — nothing was added")
                        return
                    }
                    markPinboardExplicitPlacement()
                    pinItem.pinItem(sha256, r)
                }}
                className={`relative grow ${rglSettling ? "rgl-mount-still " : ""}${fs ? "h-[97vh]" : (
                    showPagination ?
                        (thumbnailsOpen ? "h-[calc(100vh-567px)]" : "h-[calc(100vh-213px)]")
                        :
                        (thumbnailsOpen ? "h-[calc(100vh-505px)]" : "h-[calc(100vh-151px)]")
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
                        cols={grid.columns}
                        rowHeight={grid.rowHeight}
                        margin={[grid.margin, grid.margin]}
                        containerPadding={[grid.padding, grid.padding]}
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
                        onLayoutChange([...currentLayout], drops, undefined, echo)
                    }}
                    onDragStop={() => { gestureRef.current = true }}
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
                    // immune to that move, see onResizeStop). The vertical
                    // compactor is the skyline O(n log n) one from extras;
                    // same semantics as the classic quadratic compactor for
                    // non-overlapping, non-static layouts like ours.
                    compactor={cropKey !== null ? noCompactor : fastVerticalCompactor}
                    onResizeStart={(_currentLayout, oldItem, newItem, _placeholder, e, node) => {
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
                        const colWidth = (areaWidth - 2 * grid.padding
                            - (grid.columns - 1) * grid.margin) / grid.columns
                        const unitX = colWidth + grid.margin
                        const unitY = grid.rowHeight + grid.margin
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
                            Math.max(current, Math.ceil((px + grid.margin) / unit))
                        if (handle.includes('e')) newItem.maxW = cap(image.right - box.left, unitX, newItem.w)
                        if (handle.includes('w')) newItem.maxW = cap(box.right - image.left, unitX, newItem.w)
                        if (handle.includes('s')) newItem.maxH = cap(image.bottom - box.top, unitY, newItem.h)
                        if (handle.includes('n')) newItem.maxH = cap(box.bottom - image.top, unitY, newItem.h)
                    }}
                    onResizeStop={(currentLayout, oldItem, newItem) => {
                        gestureRef.current = true
                        setCropResizing(false)
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
                        const colWidth = (areaWidth - 2 * grid.padding
                            - (grid.columns - 1) * grid.margin) / grid.columns
                        const unitX = colWidth + grid.margin
                        const unitY = grid.rowHeight + grid.margin
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
                                    highWater={highWater}
                                    crop={crops[i] ?? null}
                                    autoCrop={autoCrops[i] ?? null}
                                    trim={trims[i] ?? null}
                                    lock={itemLocks[i] ?? null}
                                    lockBadgesVisible={lockBadgesVisible}
                                    onLockChange={(lock) => setLockForKeys([i], lock)}
                                    cropMode={cropKey === i}
                                    boxResizing={cropKey === i && cropResizing}
                                    imageExtentRef={cropImageExtentRef}
                                    onCropModeToggle={() => setCropKey((k) => k === i ? null : i)}
                                    onCropChange={(crop) => onItemCropChange(i, crop)}
                                    onTrimChange={(trim) => onItemTrimChange(i, trim)}
                                    onDuplicate={() => onDuplicatePin(i)}
                                    scrollAreaRef={scrollAreaRef}
                                    grid={grid}
                                    isV1={isV1}
                                    onUpgradeGrid={upgradeGrid}
                                    dbs={dbs}
                                />}
                        </div>
                    ))}
                </GridLayout>
                {marquee && (
                    <div
                        className="absolute z-40 pointer-events-none border border-blue-400 bg-blue-400/10 rounded-xs"
                        style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
                    />
                )}
                {holeMode && gridWidth > 0 && (
                    <HoleTargetOverlay
                        grid={grid}
                        gridWidth={gridWidth}
                        // Cover the full free mask even when the grid
                        // content ends above it (the empty bottom band)
                        contentHeight={Math.max(gridContentHeight,
                            grid.padding + holeRows * rowStep(grid))}
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
                            src={getFileURL(dbs, "thumbnail", "sha256", carrySha)}
                            alt=""
                            className="w-20 h-20 object-cover rounded shadow-lg opacity-80 border border-white/40"
                        />
                    </div>
                )}
                {selected.length > 0 && toolbarPos && (
                    <SelectionToolbar
                        innerRef={toolbarRef}
                        style={{ left: toolbarPos.x, top: toolbarPos.y }}
                        onGripDown={onToolbarGripDown}
                        count={selected.length}
                        cropOn={selectionCrop}
                        selHasAnchor={selected.some(k => itemLocks[k] === "anchor")}
                        holeActive={holeVerb}
                        onVerb={(id) => {
                            switch (id) {
                                case "arrange": runVerb("Arrange", arrangeSelection(selected)); break
                                case "swap": runVerb("Swap", swapItems(selected[0], selected[1])); break
                                case "hole": holeVerb ? setHoleVerb(false) : enterHoleTarget(); break
                                case "reflow": runVerb("Reflow", arrangeSelection(selected, true)); break
                                case "shuffle": runVerb("Shuffle", arrangeSelection(selected, false, true)); break
                                case "grow": runVerb("Grow to Fill", growSelection(selected)); break
                                case "shiftLeft": shiftSelection(selected, "left"); break
                                case "shiftCenter": shiftSelection(selected, "center"); break
                                case "shiftRight": shiftSelection(selected, "right"); break
                                case "mirrorH": void mirrorSelection(selected, "horizontal"); break
                                case "mirrorV": void mirrorSelection(selected, "vertical"); break
                                case "clearCrop": clearAutoCropSelection(selected); break
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
        </ScrollArea>
    )
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
    count,
    cropOn,
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
    count: number
    cropOn: boolean
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
    const [pinned, setPinned] = useState<string[]>(DEFAULT_TOOLBAR_VERBS)
    // localStorage is read after mount (the initializer also runs during
    // SSR, where there is no storage); the bar only exists while a
    // selection does, so the default never visibly flashes
    useEffect(() => {
        try {
            const ids = JSON.parse(localStorage.getItem(TOOLBAR_VERBS_KEY) ?? "")
            if (Array.isArray(ids)) {
                setPinned(ids.filter(id =>
                    id === REGION_MENU_ID || SELECTION_VERBS.some(v => v.id === id)))
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
                    {SELECTION_VERBS.map(v => {
                        const disabled = verbDisabled(v)
                        const isPinned = pinned.includes(v.id)
                        return (
                            // Not Radix-disabled even when the verb is: that
                            // would make the row inert and unpinnable (e.g.
                            // Swap could never leave the bar except with
                            // exactly two items selected). The row just
                            // looks disabled and ignores selects instead.
                            <DropdownMenuItem key={v.id} title={v.title}
                                onSelect={(e) => {
                                    // A select that originated on the pin
                                    // toggle is never a verb invocation —
                                    // Radix fires select from pointerup, so
                                    // this guard backs up the toggle's own
                                    // propagation stops
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
                                <PinToggle isPinned={isPinned} onToggle={() => togglePin(v.id)} />
                            </DropdownMenuItem>
                        )
                    })}
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
                const v = SELECTION_VERBS.find(v => v.id === id)
                if (!v) return null
                return (
                    <button key={id}
                        className={cn(btn, v.id === "hole" && holeActive
                            && "bg-blue-100 text-blue-700 hover:bg-blue-200")}
                        disabled={verbDisabled(v)}
                        onClick={() => onVerb(v.id)} title={v.title}>
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
}: {
    isPinned: boolean
    onToggle: () => void
}) {
    return (
        <button
            data-pin-toggle
            className="ml-auto rounded p-0.5 hover:bg-gray-200"
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
    highWater,
    crop,
    autoCrop,
    trim,
    lock,
    lockBadgesVisible,
    onLockChange,
    cropMode,
    boxResizing,
    imageExtentRef,
    onCropModeToggle,
    onCropChange,
    onTrimChange,
    onDuplicate,
    scrollAreaRef,
    grid,
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
    ) => void
    layout: LayoutItem[]
    crops: Record<string, CropRect | null>
    autoCrops: Record<string, CropRect | null>
    locks: Record<string, PinLock>
    highWater: number
    // Manual crop (the editable base) and the derived fit-to-cell auto crop
    crop: CropRect | null
    autoCrop: CropRect | null
    trim: TrimRange | null
    // This pin's layout lock and its single-item setter
    lock: PinLock
    // While true (the board was recently hovered), ACTIVE lock toggles are
    // shown on every locked pin so locks are visible at a glance
    lockBadgesVisible: boolean
    onLockChange: (lock: PinLock) => void
    cropMode: boolean
    boxResizing: boolean
    imageExtentRef?: React.MutableRefObject<(() => CropGeometry | null) | null>
    onCropModeToggle: () => void
    onCropChange: (crop: CropRect | null) => void
    onTrimChange: (trim: TrimRange | null) => void
    onDuplicate: () => void
    scrollAreaRef: React.RefObject<HTMLDivElement | null>
    grid: GridParams
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
    const isPlayable = data?.item?.type === "video/mp4" || data?.item?.type === "video/webm"
    const videoRef = React.useRef<HTMLVideoElement>(null)
    const videoState = useVideoPlayerState({ videoRef })

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
        })
    }

    // Natural dimensions read off the media element itself. The item query
    // above is the authoritative source, but on a fresh page load it races
    // the (usually browser-cached) thumbnail: while it's in flight CropView
    // has no dimensions and can't place a stored crop. The crop math only
    // uses the aspect ratio, which the thumbnail preserves, so the element's
    // own dimensions are an exact stand-in the moment it can paint.
    const [mediaDims, setMediaDims] = useState<{ w: number; h: number } | null>(null)
    const noteMediaDims = (w: number, h: number) => {
        if (!w || !h) return
        setMediaDims((prev) => prev && prev.w === w && prev.h === h ? prev : { w, h })
    }
    const naturalSize = data?.item?.width && data?.item?.height
        ? { w: data.item.width, h: data.item.height }
        : mediaDims

    useEffect(() => {
        if (data?.item?.type === "video/mp4" || data?.item?.type === "video/webm") {
            // Autoplay short videos
            if (data?.item.duration && data?.item.duration <= 10) {
                videoState.setShowVideo(true)
                videoState.setVideoIsPlaying(true)
                videoState.setVideoIsMuted(true)
            }
        }
    }, [data])

    useEffect(() => {
        if (!cropMode) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onCropModeToggle()
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [cropMode, onCropModeToggle])

    const showVideo = isPlayable && videoState.showVideo
    useVideoTrim({ videoRef, trim, active: showVideo })

    // Rendering shows the composition of both crop slots; the crop editor
    // edits the manual slot only (the auto crop is derived from it and gets
    // cleared when a new manual crop is committed)
    const effectiveCrop = composeCrops(crop, autoCrop)

    // Set one trim bound to the video's current time (centisecond-rounded, the
    // URL resolution); shift-click clears the bound instead. Placing a bound
    // on the wrong side of the other one clears the other — the user is
    // redefining the range. Equal bounds are allowed (freeze frame).
    const setTrimPoint = (which: "start" | "end", e: React.MouseEvent) => {
        let start = trim?.start ?? null
        let end = trim?.end ?? null
        if (e.shiftKey) {
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
        if (which === "end" && !e.shiftKey && end != null) {
            const video = videoRef.current
            if (video && !video.paused) video.currentTime = start ?? 0
        }
    }
    return (
        <>
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
                            the playback position */}
                        {(cropMode || effectiveCrop || showVideo) ?
                            <CropView
                                crop={cropMode ? crop : effectiveCrop}
                                cropMode={cropMode}
                                boxResizing={boxResizing}
                                imageExtentRef={imageExtentRef}
                                naturalWidth={naturalSize?.w}
                                naturalHeight={naturalSize?.h}
                                onCropChange={onCropChange}
                                ghostSrc={showVideo ? undefined : thumbnail}
                                renderMedia={(style) => showVideo ?
                                    <video
                                        ref={videoRef}
                                        autoPlay
                                        // With a trim set, looping is handled by
                                        // useVideoTrim so it restarts from the
                                        // trim start rather than 0
                                        loop={isEmptyTrim(trim)}
                                        muted={videoState.videoIsMuted}
                                        controls={videoState.showControls}
                                        className="rounded"
                                        style={style}
                                        src={file}
                                        onLoadedMetadata={(e) => noteMediaDims(
                                            e.currentTarget.videoWidth,
                                            e.currentTarget.videoHeight,
                                        )}
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
                    highWater={highWater}
                    cropMode={cropMode}
                    hasCrop={!!(crop || autoCrop)}
                    onToggleCrop={onCropModeToggle}
                    onClearCrop={() => onCropChange(null)}
                    trim={trim}
                    onTrimChange={onTrimChange}
                    onDuplicate={onDuplicate}
                    lock={lock}
                    onLockChange={onLockChange}
                    pinboardRef={scrollAreaRef}
                    grid={grid}
                    isV1={isV1}
                    onUpgradeGrid={onUpgradeGrid}
                    dbs={dbs}
                />
            </ContextMenu>
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
            <SelectButton
                sha256={sha256}
                item={data?.item}
                files={data?.files}
            />
            {isPlayable && <MediaControls
                isShown={videoState.showVideo}
                isPlaying={videoState.showVideo && videoState.videoIsPlaying}
                setPlaying={videoState.setPlaying}
                stopVideo={videoState.stopVideo}
                isMuted={videoState.videoIsMuted}
                setMuted={videoState.setMuted}
                showControls={videoState.showControls}
                setShowControls={videoState.setControls}
                volume={videoState.volume}
                setVolume={videoState.setVolume}
            />}
            {showVideo && !videoState.showControls &&
                <VideoTimeline
                    videoRef={videoRef}
                    trim={trim}
                    onTrimChange={onTrimChange}
                    className="absolute left-14 right-14 bottom-2 h-10 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                />}
            {showVideo && <>
                <button
                    title={trim?.start != null
                        ? `Loop start: ${trim.start.toFixed(2)}s — click to move here, shift-click to clear`
                        : "Set loop start to current time"}
                    className={cn(
                        "hover:scale-105 absolute bottom-14 left-2 rounded-full p-2 transition-opacity duration-300 opacity-0 group-hover:opacity-100",
                        trim?.start != null ? "bg-blue-200" : "bg-white",
                    )}
                    onClick={(e) => setTrimPoint("start", e)}
                >
                    <ArrowRightFromLine className="w-6 h-6 text-gray-800" />
                </button>
                <button
                    title={trim?.end != null
                        ? `Loop end: ${trim.end.toFixed(2)}s — click to move here, shift-click to clear`
                        : "Set loop end to current time"}
                    className={cn(
                        "hover:scale-105 absolute bottom-26 left-2 rounded-full p-2 transition-opacity duration-300 opacity-0 group-hover:opacity-100",
                        trim?.end != null ? "bg-blue-200" : "bg-white",
                    )}
                    onClick={(e) => setTrimPoint("end", e)}
                >
                    <ArrowRightToLine className="w-6 h-6 text-gray-800" />
                </button>
            </>}
            <FindButton
                id={data?.files[0]?.id || sha256}
                id_type={data?.files[0] ? "file_id" : "sha256"}
                path={data?.files[0]?.path || ""}
            />
        </>
    )
}

export function usePinItem() {
    const prefixLength = 10 // The length of the prefix of the sha256 hash
    const { updateRecords } = usePinBoard()
    const pinItem = (sha256: string, pos?: { x: number, y: number, w: number, h: number }) => {
        updateRecords((records, grid) => {
            // An explicit position (e.g. from a drop) is already in the
            // board's grid units; the fallback size is 2x2 in v1 units
            const { sx, sy } = v1ScaleFactors(grid)
            const p = pos ?? { x: 0, y: 0, w: Math.round(2 * sx), h: Math.round(2 * sy) }
            return [
                ...records,
                sha256.slice(0, prefixLength),
                p.x.toString(),
                p.y.toString(),
                p.w.toString(),
                p.h.toString(),
            ]
        })
    }
    return { pinItem }
}
