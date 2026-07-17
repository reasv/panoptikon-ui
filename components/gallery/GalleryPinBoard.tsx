import Image from 'next/image'
import { cn, getFileURL } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"
import { useGalleryFullscreen, useGalleryPinAutoCrop, useGalleryPinAutoLayout, useGalleryPinGrid } from '@/lib/state/gallery'
import { consumePinboardNavigation, consumePinboardPendingEdit } from '@/lib/pinboardNavigation'
import { usePinBoard } from '@/lib/state/pinboard'
import { GridParams, v1ScaleFactors } from '@/lib/pinboardGrid'
import { PinButton } from './PinButton'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Responsive, WidthProvider, type LayoutItem } from "react-grid-layout/legacy"
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
import { CropRect, TrimRange, clampCrop, composeCrops, isEmptyTrim, packHField, parseHField } from '@/lib/pinboardCrop'
import { useVideoTrim } from '@/lib/videoTrim'
import { CropGeometry, CropView } from './CropView'
import { VideoTimeline } from './VideoTimeline'
import { ArrowRightFromLine, ArrowRightToLine, Check, Crop } from 'lucide-react'
import { usePinboardLayoutActions } from '@/hooks/pinboardLayout'
const ResponsiveGridLayout = WidthProvider(Responsive)

const ALL_RESIZE_HANDLES: LayoutItem["resizeHandles"] =
    ["s", "w", "e", "n", "sw", "nw", "se", "ne"]

// Faint overlay of react-grid-layout's cells, for eyeballing item sizes while
// debugging layouts. Each cell's left/right and top/bottom edges are drawn at
// their exact computed positions (the gaps between the paired lines are the
// grid's margins). Positions are placed explicitly rather than via a
// repeating gradient, whose fractional column period would accumulate rounding
// error across the columns and smear into overlapping/uneven lines.
function GridOverlay({ width, height, grid }: {
    width: number
    height: number
    grid: GridParams
}) {
    const { columns, rowHeight, margin, padding } = grid
    const columnWidth = (width - 2 * padding - (columns - 1) * margin) / columns
    if (!(columnWidth > 0) || height <= 0) return null

    const xs: number[] = []
    for (let i = 0; i < columns; i++) {
        const left = padding + i * (columnWidth + margin)
        xs.push(left, left + columnWidth)
    }
    const ys: number[] = []
    for (let top = padding; top < height; top += rowHeight + margin) {
        ys.push(top, top + rowHeight)
    }

    const stroke = "rgba(128,128,128,0.35)"
    return (
        <svg
            className="absolute top-0 left-0 z-0 pointer-events-none"
            width={width}
            height={height}
            shapeRendering="crispEdges"
        >
            {xs.map((x, i) => (
                <line key={`v${i}`} x1={x} y1={0} x2={x} y2={height} stroke={stroke} strokeWidth={1} />
            ))}
            {ys.map((y, i) => (
                <line key={`h${i}`} x1={0} y1={y} x2={width} y2={y} stroke={stroke} strokeWidth={1} />
            ))}
        </svg>
    )
}

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
    const { grid, records, isV1, updateRecords, upgradeGrid } = usePinBoard()
    // Key of the item currently in crop mode, if any
    const [cropKey, setCropKey] = useState<string | null>(null)
    // True while the crop-mode item's box is being resized via a grid handle
    const [cropResizing, setCropResizing] = useState(false)
    // Getter for the crop-mode image's viewport extent, set by its CropView
    const cropImageExtentRef = useRef<(() => CropGeometry | null) | null>(null)
    const [layout, pinnedFiles, crops, autoCrops, trims]: [
        LayoutItem[],
        [string, string, string, string][],
        Record<string, CropRect | null>,
        Record<string, CropRect | null>,
        Record<string, TrimRange | null>,
    ] = useMemo(() => {
        const newLayout: LayoutItem[] = []
        const pinned: [string, string, string, string][] = []
        const cropsMap: Record<string, CropRect | null> = {}
        const autoCropsMap: Record<string, CropRect | null> = {}
        const trimsMap: Record<string, TrimRange | null> = {}
        for (let i = 0; i < records.length; i += 5) {
            const [sha256, x, y, w, hField] = records.slice(i, i + 5)
            const index = `${i}-${sha256}`
            const { h, crop, autoCrop, trim } = parseHField(hField)
            cropsMap[index] = crop
            autoCropsMap[index] = autoCrop
            trimsMap[index] = trim
            newLayout.push({
                i: index,
                x: parseInt(x),
                y: parseInt(y),
                w: parseInt(w),
                h,
                ...(index === cropKey ? { resizeHandles: ALL_RESIZE_HANDLES } : {}),
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
        return [newLayout, pinned, cropsMap, autoCropsMap, trimsMap]
    }, [records, cropKey, dbs])

    // Rebuilds the packed records from RGL's reported layout, in the EXISTING
    // record order: the item keys embed each record's offset, so persisting in
    // RGL's iteration order would shuffle the offsets, change every key,
    // remount every pin (with its ContextMenu popper) and re-fire this handler
    // — feeding the layout back into itself through the URL until React's
    // nested-update limit crashes the page.
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
            if (!item) continue
            byKey.delete(key)
            const { crop, autoCrop, trim } = parseHField(prev[i + 4])
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
                // Crop/trim suffixes stored in the h field survive box moves/resizes
                packHField(item.h, nextCrop, nextAuto, trim),
            )
        }
        // Items RGL reports that have no record yet
        for (const item of byKey.values()) {
            next.push(
                item.i.split("-")[1],
                item.x.toString(),
                item.y.toString(),
                item.w.toString(),
                packHField(item.h, null),
            )
        }
        return next
    }

    // Manual crop waiting to be folded into the next onLayoutChange write —
    // set by the crop-mode resize release, which fires onLayoutChange (via
    // RGL's own resize-stop layout report) in the same tick
    const pendingManualCropRef = useRef<Record<string, CropRect | null> | null>(null)
    const onLayoutChange = (
        currentLayout: LayoutItem[],
        autoCropOverrides?: Record<string, CropRect | null>,
    ) => {
        const manualCropOverrides = pendingManualCropRef.current ?? undefined
        pendingManualCropRef.current = null
        // RGL fires onLayoutChange on every layouts-prop change and on mount,
        // not only on user interaction. If nothing actually moved, writing an
        // equal value back would push a redundant history entry and re-trigger
        // this handler — the write must only happen on real changes. This
        // guard is also what keeps merely *viewing* a v1 board from migrating
        // it: updateRecords only converts on writes.
        const candidate = rebuildRecords(records, currentLayout, autoCropOverrides, manualCropOverrides)
        if (
            candidate.length === records.length &&
            candidate.every((v, i) => v === records[i])
        ) {
            return
        }
        updateRecords((prev) => rebuildRecords(prev, currentLayout, autoCropOverrides, manualCropOverrides))
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
                    next[i + 4] = packHField(parsed.h, crop, null, parsed.trim)
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
                    next[i + 4] = packHField(parsed.h, parsed.crop, parsed.autoCrop, trim)
                    break
                }
            }
            return next
        })
    }

    // Stable layouts object: a fresh identity on every render makes RGL
    // re-sync (and re-fire onLayoutChange) on unrelated parent re-renders
    const rglLayouts = useMemo(() => ({ lg: layout }), [layout])
    const [fs, setFs] = useGalleryFullscreen()
    const [showGrid] = useGalleryPinGrid()
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    // v1 boards use v1-unit sizes for new/dropped pins so they stay
    // consistent pre-migration; on the finer v2 grid the same physical size
    // is these units times the lattice scale factors
    const { sx, sy } = v1ScaleFactors(grid)
    // Measure the grid area so the debug grid overlay can match react-grid-layout's
    // column width (from the container width) and cover the full grid height,
    // which grows past the viewport when an item extends below the fold. The
    // grid content height comes from RGL's own root element rather than the
    // fixed-height container, and we observe it so the overlay follows resizes.
    const gridAreaRef = useRef<HTMLDivElement>(null)
    const [gridAreaSize, setGridAreaSize] = useState({ width: 0, height: 0 })
    useEffect(() => {
        const el = gridAreaRef.current
        if (!el) return
        const gridEl = el.querySelector<HTMLElement>(".react-grid-layout")
        const measure = () => setGridAreaSize({
            width: el.clientWidth,
            height: Math.max(el.clientHeight, gridEl?.offsetHeight ?? 0),
        })
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        if (gridEl) ro.observe(gridEl)
        return () => ro.disconnect()
    }, [records])
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
    const { fillViewport } = usePinboardLayoutActions({
        layout, crops, autoCrops, dbs, grid,
        pinboardRef: scrollAreaRef,
        onLayoutChange,
    })
    // Refs so the effects below read the CURRENT flags and action at fire
    // time while only reacting to their own trigger conditions
    const autoLayoutRef = useRef(autoLayout)
    autoLayoutRef.current = autoLayout
    const autoLayoutCropRef = useRef(autoLayoutCrop)
    autoLayoutCropRef.current = autoLayoutCrop
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
        if (prev === null) {
            // First observation is normally just the baseline — but a
            // pending-edit mark means pins were added/removed from outside
            // the gallery (search-grid pin buttons) while this trigger was
            // unmounted, and that edit still needs laying out. Navigation
            // takes precedence: a restored version replaced those records.
            if (pendingEdit && !wasNavigation && count > 0 && autoLayoutRef.current) {
                void fillViewportRef.current(false, autoLayoutCropRef.current)
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
        if (!autoLayoutRef.current) return
        // Fire-and-forget: fillViewport is async (fetches metadata) and
        // no-ops on its own when the container can't be measured
        void fillViewportRef.current(false, autoLayoutCropRef.current)
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
        void fillViewportRef.current(false, autoLayoutCropRef.current, true)
    }, [fs, thumbnailsOpen])
    return (
        // data-pinboard-area: the version-history panel docks into this
        // box's corners (PinboardHistory measures it by this attribute)
        <ScrollArea ref={scrollAreaRef} data-pinboard-area className="overflow-y-auto">
            <div
                ref={gridAreaRef}
                className={`relative grow ${rglSettling ? "rgl-mount-still " : ""}${fs ? "h-[97vh]" : (
                    showPagination ?
                        (thumbnailsOpen ? "h-[calc(100vh-567px)]" : "h-[calc(100vh-213px)]")
                        :
                        (thumbnailsOpen ? "h-[calc(100vh-505px)]" : "h-[calc(100vh-151px)]")
                )
                    }`}
            >
                {showGrid && (
                    <GridOverlay
                        width={gridAreaSize.width}
                        height={gridAreaSize.height}
                        grid={grid}
                    />
                )}
                <ResponsiveGridLayout
                    // Remount when the grid parameters change (v1 -> v2
                    // migration, future per-board settings): Responsive RGL
                    // otherwise reconciles the new layouts against its stale
                    // internal cols, clamping x+w to the old column count and
                    // compacting items into the wrong places before the new
                    // cols prop is applied.
                    key={gridKey}
                    className="layout"
                    layouts={rglLayouts}
                    breakpoints={{ lg: 0, }}
                    cols={{ lg: grid.columns, }}
                    rowHeight={grid.rowHeight}
                    margin={[grid.margin, grid.margin]}
                    containerPadding={[grid.padding, grid.padding]}
                    onLayoutChange={(currentLayout) => onLayoutChange([...currentLayout])}
                    draggableHandle=".drag-handle"
                    isResizable={true}
                    isDraggable={true}
                    isDroppable={true}
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
                    // immune to that move, see onResizeStop).
                    compactType={cropKey !== null ? null : "vertical"}
                    preventCollision={false}
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
                            className={cn(
                                "relative bg-gray-800 border rounded shadow-sm group",
                                cropKey === i && "z-30 pinboard-crop-item",
                            )}
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
                                    crop={crops[i] ?? null}
                                    autoCrop={autoCrops[i] ?? null}
                                    trim={trims[i] ?? null}
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
                </ResponsiveGridLayout>
            </div>
        </ScrollArea>
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
    crop,
    autoCrop,
    trim,
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
    ) => void
    layout: LayoutItem[]
    crops: Record<string, CropRect | null>
    autoCrops: Record<string, CropRect | null>
    // Manual crop (the editable base) and the derived fit-to-cell auto crop
    crop: CropRect | null
    autoCrop: CropRect | null
    trim: TrimRange | null
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
                    <div className={cn(
                        "absolute top-0 left-0 w-full h-full",
                        !cropMode && "drag-handle cursor-move",
                    )}>
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
                    cropMode={cropMode}
                    hasCrop={!!(crop || autoCrop)}
                    onToggleCrop={onCropModeToggle}
                    onClearCrop={() => onCropChange(null)}
                    trim={trim}
                    onTrimChange={onTrimChange}
                    onDuplicate={onDuplicate}
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
