import Image from 'next/image'
import { cn, getFileURL } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"
import { useGalleryFullscreen, useGalleryPinAutoLayout, useGalleryPinGrid } from '@/lib/state/gallery'
import { usePinBoard } from '@/lib/state/pinboard'
import { GridParams, v1ScaleFactors } from '@/lib/pinboardGrid'
import { PinButton } from './PinButton'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactGridLayout, { Responsive, WidthProvider } from "react-grid-layout"
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
import { CropRect, TrimRange, composeCrops, isEmptyTrim, packHField, parseHField } from '@/lib/pinboardCrop'
import { useVideoTrim } from '@/lib/videoTrim'
import { CropView } from './CropView'
import { VideoTimeline } from './VideoTimeline'
import { ArrowRightFromLine, ArrowRightToLine, Check, Crop } from 'lucide-react'
import { usePinboardLayoutActions } from '@/hooks/pinboardLayout'
const ResponsiveGridLayout = WidthProvider(Responsive)

const ALL_RESIZE_HANDLES: ReactGridLayout.Layout["resizeHandles"] =
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
    const [layout, pinnedFiles, crops, autoCrops, trims]: [
        ReactGridLayout.Layout[],
        [string, string, string, string][],
        Record<string, CropRect | null>,
        Record<string, CropRect | null>,
        Record<string, TrimRange | null>,
    ] = useMemo(() => {
        const newLayout: ReactGridLayout.Layout[] = []
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
    const rebuildRecords = (
        prev: string[],
        currentLayout: ReactGridLayout.Layout[],
        autoCropOverrides?: Record<string, CropRect | null>,
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
            const nextAuto = autoCropOverrides && key in autoCropOverrides
                ? autoCropOverrides[key]
                : autoCrop
            next.push(
                prev[i],
                item.x.toString(),
                item.y.toString(),
                item.w.toString(),
                // Crop/trim suffixes stored in the h field survive box moves/resizes
                packHField(item.h, crop, nextAuto, trim),
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

    const onLayoutChange = (
        currentLayout: ReactGridLayout.Layout[],
        autoCropOverrides?: Record<string, CropRect | null>,
    ) => {
        // RGL fires onLayoutChange on every layouts-prop change and on mount,
        // not only on user interaction. If nothing actually moved, writing an
        // equal value back would push a redundant history entry and re-trigger
        // this handler — the write must only happen on real changes. This
        // guard is also what keeps merely *viewing* a v1 board from migrating
        // it: updateRecords only converts on writes.
        const candidate = rebuildRecords(records, currentLayout, autoCropOverrides)
        if (
            candidate.length === records.length &&
            candidate.every((v, i) => v === records[i])
        ) {
            return
        }
        // Functional update so crop commits landing in the same tick aren't
        // clobbered
        updateRecords((prev) => rebuildRecords(prev, currentLayout, autoCropOverrides))
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
    const pinItem = usePinItem()
    // Auto-layout mode: when enabled, adding/removing/duplicating a pin
    // re-runs the viewport-filling mosaic over ALL items. The board's own
    // layout-actions instance shares the machinery the context menu uses.
    const [autoLayout] = useGalleryPinAutoLayout()
    const { fillViewport } = usePinboardLayoutActions({
        layout, crops, autoCrops, dbs, grid,
        pinboardRef: scrollAreaRef,
        onLayoutChange,
    })
    // Refs so the effect below reads the CURRENT flag and action at fire
    // time while only reacting to `records` changes (the moment pins land)
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
        if (prev === null || prev === count) return
        // Count-change detection is itself the loop guard: the relayout's
        // own record write preserves the count, as do drags, resizes, crops
        // and the v1->v2 migration — none of them can re-trigger this.
        if (count === 0) return // board emptied: nothing to lay out
        if (!autoLayoutRef.current) return
        // Fire-and-forget: fillViewport is async (fetches metadata) and
        // no-ops on its own when the container can't be measured
        void fillViewportRef.current(false)
    }, [records])
    return (
        <ScrollArea ref={scrollAreaRef} className="overflow-y-auto">
            <div
                ref={gridAreaRef}
                className={`relative flex-grow ${fs ? "h-[97vh]" : (
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
                    key={`grid-${grid.columns}-${grid.rowHeight}-${grid.margin}-${grid.padding}`}
                    className="layout"
                    layouts={rglLayouts}
                    breakpoints={{ lg: 0, }}
                    cols={{ lg: grid.columns, }}
                    rowHeight={grid.rowHeight}
                    margin={[grid.margin, grid.margin]}
                    containerPadding={[grid.padding, grid.padding]}
                    onLayoutChange={(currentLayout) => onLayoutChange(currentLayout)}
                    draggableHandle=".drag-handle"
                    isResizable={true}
                    isDraggable={true}
                    isDroppable={true}
                    // Size of the grey preview box (10x10 in v1 units)
                    droppingItem={{ i: '__preview', w: Math.round(10 * sx), h: Math.round(10 * sy) }}
                    compactType="vertical" // Compacts items vertically to keep them visible on screen
                    preventCollision={false}
                    onResizeStart={(_currentLayout, oldItem) => {
                        if (oldItem.i === cropKey) setCropResizing(true)
                    }}
                    onResizeStop={() => setCropResizing(false)}
                    onDrop={(layout, layoutItem, e) => {
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
                                "relative bg-gray-800 border rounded shadow group",
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
        currentLayout: ReactGridLayout.Layout[],
        autoCropOverrides?: Record<string, CropRect | null>,
    ) => void
    layout: ReactGridLayout.Layout[]
    crops: Record<string, CropRect | null>
    autoCrops: Record<string, CropRect | null>
    // Manual crop (the editable base) and the derived fit-to-cell auto crop
    crop: CropRect | null
    autoCrop: CropRect | null
    trim: TrimRange | null
    cropMode: boolean
    boxResizing: boolean
    onCropModeToggle: () => void
    onCropChange: (crop: CropRect | null) => void
    onTrimChange: (trim: TrimRange | null) => void
    onDuplicate: () => void
    scrollAreaRef: React.RefObject<HTMLDivElement>
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
                                naturalWidth={data?.item?.width}
                                naturalHeight={data?.item?.height}
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
                                    />
                                    :
                                    <img
                                        src={thumbnail}
                                        alt={`Sha256 Hash ${sha256}`}
                                        draggable={false}
                                        className="rounded select-none"
                                        style={style}
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
                        "hover:scale-105 absolute bottom-[6.5rem] left-2 rounded-full p-2 transition-opacity duration-300 opacity-0 group-hover:opacity-100",
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
