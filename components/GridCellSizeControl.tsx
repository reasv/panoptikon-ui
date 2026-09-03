"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { LayoutGrid } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    CELL_WIDTH_STEP,
    GRID_GAP_PX,
    cellWidthForColumns,
    clampCellWidth,
    coWrittenPageSize,
    columnsForCellWidth,
} from "@/lib/gridCellSize"
import { MAX_CELL_WIDTH, MIN_CELL_WIDTH } from "@/lib/searchLimits"
import { type AnimateMode } from "@/lib/thumbnailTier"
import { cellRange, setAnimateSlot, type CellRange } from "@/lib/state/animatePref"
import { useAnimateModeForRange } from "@/hooks/useAnimateMode"
import {
    hoverPreviewChoice,
    setHoverPreviewChoice,
    type HoverPreviewCapability,
    type HoverPreviewChoice,
} from "@/lib/state/hoverPreviewPref"
import { useHoverPreview, useHoverPreviewCapability } from "@/lib/useClientConfig"
import { useGridCellSize } from "@/lib/state/cellSize"
import { useCellSizePageLock } from "@/lib/state/cellSizePageLock"
import { EMPTY_GRID_METRICS, type GridMetricsStore } from "@/lib/state/gridMetricsBox"
import { SMALL_CELL_THRESHOLD_PX } from "@/lib/gridCellSize"
import { useCommitPageSize } from "@/lib/searchHooks"
import { usePageSize } from "@/lib/state/searchQuery/clientHooks"

/**
 * The result grid's cell-size slider (docs/search-scroll-mode-design.md §9).
 *
 * ONE VARIABLE, whose default value is "auto" — the breakpoint column counts
 * the grid has always used, parameter absent — and whose explicit values are
 * target cell WIDTHS. Moving the thumb is the auto→explicit switch; the Auto
 * button is the only way back. There is no blended mode.
 *
 * The thumb sits at the grid's MEASURED cell width while auto is in force
 * (published through the box this is handed), so the first drag continues from
 * the size on screen instead of jumping to an arbitrary number.
 *
 * WRITES ON RELEASE, never during the drag: Radix's `onValueCommit` fires once
 * per gesture, so a sweep across the track is one URL write and one re-layout
 * rather than one per pixel — and, with `cs` a history:"replace" parameter,
 * one drag cannot mint a pile of history entries for Back to replay.
 *
 * A commit also co-writes `page_size` by default, so the screen-to-items ratio
 * survives the change (coWrittenPageSize). The lock switch turns that off for
 * someone who picked a page size deliberately; it is a stored preference
 * rather than URL state, because it decides what a FUTURE drag writes rather
 * than what this view is.
 */
export function GridCellSizeControl({ metricsStore }: {
    metricsStore?: GridMetricsStore
}) {
    const [cellSize, setCellSize] = useGridCellSize()
    const pageSize = usePageSize()
    // Not a plain `page_size` write: in pages mode the change is remapped onto
    // the item the user is looking at and the page holding it is prefetched
    // first, and in scroll mode it is the pure relabel that mode defines (see
    // useCommitPageSize). Both write "replace", which is what keeps a slider
    // commit off the history stack — and both take the cell-size write as
    // their `alongside` write, so the whole change is ONE URL update (see
    // `commit`).
    const commitPageSize = useCommitPageSize()
    const locked = useCellSizePageLock((state) => state.locked)
    const setLocked = useCellSizePageLock((state) => state.setLocked)
    // The grid's measured geometry. `getServerSnapshot` is the empty record —
    // the server has no layout, and its zeroes read as "unmeasured" everywhere
    // below.
    const metrics = useSyncExternalStore(
        metricsStore ? metricsStore.subscribe : NO_STORE_SUBSCRIBE,
        metricsStore ? metricsStore.get : NO_STORE_GET,
        NO_STORE_GET
    )
    const auto = cellSize === null
    const effective = clampCellWidth(cellSize ?? (metrics.cellWidth || DEFAULT_CELL_WIDTH))
    // The animate toggle is bound to the range the grid is LAID OUT at (D4),
    // taken from the committed width rather than from the thumb's live
    // position: while a drag is in flight the cells on screen are still the
    // old size, and a control that flipped ranges under the pointer would be
    // describing a grid that does not exist yet.
    const range = cellRange(effective)
    const animateMode = useAnimateModeForRange(range)
    // The thumb's live position during a drag. Re-seeded whenever the value it
    // stands for moves underneath it — a commit landing, a switch back to
    // auto, or (in auto) the grid re-measuring after a resize.
    const [pending, setPending] = useState(effective)
    useEffect(() => {
        setPending(effective)
    }, [effective])

    const commit = async (next: number) => {
        const target = clampCellWidth(next)
        if (target === cellSize) return
        // ONE TICK for the whole change (design §9). The cell-size write is
        // handed to the page-size commit as its `alongside` write rather than
        // awaited first, because two ticks are observably wrong in pages mode:
        // `cs` alone re-lays the grid out at the OLD page size, and the
        // scroll-stop anchor that layout produces lands after — and on top of
        // — the position this commit remapped.
        const writeCellSize = () => setCellSize(target, { history: "replace" })
        // The RATIO is measured between the widths actually LAID OUT, not
        // between the targets: a target of 500px in a 2473px row lays out as
        // four 611px cells, and it is the 611 that decides how many cells a
        // screen holds. The new column count comes from the same expression
        // the grid will run on the width it has already published.
        const container = metrics.containerWidth
        const nextColumns = columnsForCellWidth(container, target, GRID_GAP_PX)
        const nextWidth = cellWidthForColumns(container, nextColumns, GRID_GAP_PX) || target
        // The width the ratio is measured FROM: the laid-out width the grid is
        // showing right now. On the auto→explicit switch that is the whole
        // point — the page size follows the change the user just made, not a
        // change from some notional default.
        const previous = metrics.cellWidth || cellSize || target
        const nextPageSize = locked
            ? null
            : coWrittenPageSize(pageSize, previous, nextWidth, nextColumns)
        if (nextPageSize === null) {
            await writeCellSize()
            return
        }
        await commitPageSize(nextPageSize, writeCellSize)
    }

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    // shrink-0 for the same reason as its neighbours': this
                    // cluster shares the header row with the pinboard tabs,
                    // and a squeezed icon button squashes its glyph rather
                    // than moving.
                    className="shrink-0"
                    title={auto ? "Cell size: automatic" : `Cell size: ${cellSize}px`}
                    aria-label="Cell size"
                >
                    <LayoutGrid className="h-5 w-5" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
                <div className="flex items-center justify-between">
                    <Label className="text-base">Cell Size</Label>
                    {/* tabular-nums and a reserved width so the row does not
                        reflow while the thumb moves. */}
                    <span className="text-sm text-muted-foreground tabular-nums">
                        {auto ? "Auto" : `${pending} px`}
                    </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                    How wide a result card is. Auto follows the window size.
                </p>
                <Slider
                    value={[pending]}
                    onValueChange={(value) => setPending(value[0])}
                    onValueCommit={(value) => void commit(value[0])}
                    min={MIN_CELL_WIDTH}
                    max={MAX_CELL_WIDTH}
                    step={CELL_WIDTH_STEP}
                    className="mt-4"
                    aria-label="Cell width in pixels"
                />
                <div className="mt-4 flex items-center justify-between">
                    <div className="pr-4">
                        <Label className="text-sm">Keep page size</Label>
                        <p className="text-xs text-muted-foreground">
                            Off, the page size follows the cell size so a page
                            stays the same number of screenfuls.
                        </p>
                    </div>
                    <Switch
                        checked={locked}
                        onCheckedChange={setLocked}
                        aria-label="Keep page size when the cell size changes"
                    />
                </div>
                <div className="mt-4 flex items-center justify-between">
                    <div className="pr-4">
                        <Label className="text-sm">Animate</Label>
                        {/* WHICH RANGE this writes is the one thing the
                            control has to say out loud (D4): the same popover
                            shows a different value once the slider crosses the
                            threshold, and without this that reads as the
                            toggle having flipped itself. */}
                        <p className="text-xs text-muted-foreground">
                            {range === "below"
                                ? `For cells under ${SMALL_CELL_THRESHOLD_PX}px wide. Larger cells keep their own setting.`
                                : `For cells ${SMALL_CELL_THRESHOLD_PX}px wide and over. Smaller cells keep their own setting.`}
                        </p>
                    </div>
                    <AnimateModeSegment mode={animateMode} range={range} />
                </div>
                <HoverPreviewRow />
                {/* The only way back to the automatic policy: an explicit cell
                    size REPLACES it rather than adjusting it, so "auto" is not
                    a position on the track. Page size is deliberately left
                    alone here — the width auto will produce is not known until
                    the grid has re-laid-out, so there is no ratio to preserve
                    it against. */}
                <Button
                    variant="outline"
                    size="sm"
                    className="mt-4 w-full"
                    disabled={auto}
                    onClick={() => void setCellSize(null)}
                >
                    Use automatic size
                </Button>
            </PopoverContent>
        </Popover>
    )
}

/**
 * The animate toggle (D4): two segments showing the EFFECTIVE mode for the
 * range on screen, and writing only that range's slot.
 *
 * Not a `Switch` like its neighbour, because the two states are named
 * behaviours rather than an on/off of one: "on hover" is not the absence of
 * "always", and a switch labelled with either one reads as the wrong question.
 * `radiogroup`/`radio` rather than a listbox for the same reason a segmented
 * control is not a select — both options are visible and one is chosen.
 *
 * The write goes STRAIGHT to the preference box (lib/state/animatePref.ts):
 * nothing here touches the URL or the creation-defaults layer, which is the
 * rule the preference exists under (D3).
 */
function AnimateModeSegment({ mode, range }: {
    mode: AnimateMode
    range: CellRange
}) {
    const segment = (value: AnimateMode, label: string) => (
        <button
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => setAnimateSlot(range, value === "always")}
            className={cn(
                "rounded-sm px-2 py-1 text-xs transition-colors",
                mode === value
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
            )}
        >
            {label}
        </button>
    )
    return (
        <div
            role="radiogroup"
            aria-label="When animated results play"
            className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted p-0.5"
        >
            {segment("always", "Always")}
            {segment("hover", "On hover")}
        </div>
    )
}

/**
 * The video-preview toggle (A6): what a hovered video cell is allowed to do
 * on this browser (docs/video-hover-preview-implementation.md V7).
 *
 * ITS OWN COMPONENT so that the two client-config reads below live behind the
 * popover rather than in the header button that opens it: this whole control
 * mounts once and only while the popover is open, and the strict rule the
 * package is under is about the GRID's cards, not about a panel.
 *
 * THREE POSITIONS ON ONE SCALE, so a segmented control rather than two
 * switches — "Originals" is not "All minus something", it is the middle of a
 * range from "spend nothing" to "spend a server encode". Same `radiogroup`
 * shape and the same straight-to-localStorage write as the Animate toggle
 * above it; nothing here touches the URL or the creation-defaults layer.
 *
 * WHAT THE SEGMENTS SHOW is the EFFECTIVE answer, D4's rule: a stored "All"
 * against a policy that denies the preview encode lights "Originals" and greys
 * "All" beside it, rather than lighting a segment that does nothing.
 */
function HoverPreviewRow() {
    // The RESOLVED answer (server ∧ preference), which is what the grid is
    // actually doing, and the SERVER's half alone, which is what decides
    // whether a segment is offered at all. Two reads of one cached query.
    const resolved = useHoverPreview()
    const server = useHoverPreviewCapability()
    const choice = hoverPreviewChoice(resolved)
    return (
        <div className="mt-4 flex items-center justify-between">
            <div className="pr-4">
                <Label className="text-sm">Video previews</Label>
                <p className="text-xs text-muted-foreground">
                    {hoverPreviewHint(server)}
                </p>
            </div>
            <HoverPreviewSegment choice={choice} server={server} />
        </div>
    )
}

/**
 * WHY A SEGMENT IS UNAVAILABLE, in a sentence — and it has to be a sentence
 * rather than a greyed button alone, because "your server will not do this"
 * and "you turned this off" are the same picture otherwise.
 */
function hoverPreviewHint(server: HoverPreviewCapability | null): string {
    if (!server) {
        return "This server does not offer hover previews."
    }
    // The two own-bytes rungs are one thing to a person — "play the file
    // itself" — so the hint names what that means rather than which of them
    // a given file will take (docs/video-hover-preview-implementation.md).
    const originals = "Play a video by resting on its card. “Originals” plays"
        + " the file itself, trimmed to its first 16 seconds when it is large."
    if (!server.direct && !server.trim) {
        return "Hover previews are turned off for this server."
    }
    if (!server.transcode) {
        return `${originals} This server does not convert the ones your browser cannot play, so “All” is unavailable.`
    }
    return `${originals} “All” also converts the ones your browser cannot play, which asks the server for a short preview.`
}

function HoverPreviewSegment({ choice, server }: {
    choice: HoverPreviewChoice
    server: HoverPreviewCapability | null
}) {
    const segment = (
        value: HoverPreviewChoice,
        label: string,
        available: boolean
    ) => (
        <button
            type="button"
            role="radio"
            aria-checked={choice === value}
            disabled={!available}
            // The SERVER's half goes with the write: a slot is only recorded
            // for a rung this server offered, or clicking the already-lit
            // "Originals" beside a disabled "All" would silently freeze the
            // encode rung off forever (see `withHoverPreviewSlot`).
            onClick={() => setHoverPreviewChoice(value, server)}
            className={cn(
                "rounded-sm px-2 py-1 text-xs transition-colors",
                !available && "opacity-40 cursor-not-allowed",
                choice === value
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground",
                available && choice !== value && "hover:text-foreground"
            )}
        >
            {label}
        </button>
    )
    // "Off" is always available: turning the feature off is a decision the
    // browser is entitled to whatever the server says — and it is the only
    // segment that means anything when the server offers nothing at all.
    return (
        <div
            role="radiogroup"
            aria-label="Video previews on hover"
            className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted p-0.5"
        >
            {segment("off", "Off", true)}
            {/* Offered as soon as EITHER own-bytes rung is: they are one
                position on this control, and which of the two a given file
                takes is arithmetic on its size. */}
            {segment("originals", "Originals", !!server && (server.direct || server.trim))}
            {segment("all", "All", !!server?.transcode)}
        </div>
    )
}

// Where the slider seeds itself when nothing has been measured yet — a mid
// scale value, only ever reached by a control mounted without a grid behind
// it (or opened in the very first frame after a mount).
const DEFAULT_CELL_WIDTH = 400

// The no-store fallbacks, hoisted to module scope so their identity is stable:
// useSyncExternalStore re-subscribes whenever the subscribe function changes,
// and re-renders forever if the snapshot getter returns a fresh object.
const NO_STORE_SUBSCRIBE = () => () => { }
const NO_STORE_GET = () => EMPTY_GRID_METRICS
