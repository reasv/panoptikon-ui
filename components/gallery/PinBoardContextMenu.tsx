import type { LayoutItem } from "react-grid-layout";
import { ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "../ui/context-menu";
import { useGalleryFullscreen, useGalleryPinAutoCrop, useGalleryPinAutoLayout, useGalleryPinGrid, useGalleryPinSelectionCrop } from "@/lib/state/gallery";
import { CropRect, PinLock, TrimRange } from "@/lib/pinboardCrop";
import { GridParams } from "@/lib/pinboardGrid";
import { useFileOpenActions } from "@/hooks/fileOpen";
import { REGION_PRESETS, usePinboardLayoutActions } from "@/hooks/pinboardLayout";
import { usePinSelection } from "@/lib/state/pinboardSelection";

export function PinBoardCtx({
    layoutKey,
    sha256,
    file_url,
    onLayoutChange,
    layout,
    crops,
    autoCrops,
    locks,
    highWater,
    cropMode,
    hasCrop,
    onToggleCrop,
    onClearCrop,
    trim,
    onTrimChange,
    onDuplicate,
    lock,
    onLockChange,
    pinboardRef,
    dbs,
    grid,
    isV1,
    onUpgradeGrid,
}: {
    layoutKey: string
    sha256: string
    file_url: string
    // autoCropOverrides ride along with the layout so both land in one
    // record write (one URL update, one history entry); newHighWater
    // updates the board's layout-height ratchet in the same write
    onLayoutChange: (
        layout: LayoutItem[],
        autoCropOverrides?: Record<string, CropRect | null>,
        newHighWater?: number,
    ) => void
    layout: LayoutItem[],
    // Manual crops (the layout-math base) and derived fit-to-cell auto crops
    crops: Record<string, CropRect | null>,
    autoCrops: Record<string, CropRect | null>,
    locks: Record<string, PinLock>,
    highWater: number,
    cropMode: boolean,
    hasCrop: boolean,
    onToggleCrop: () => void,
    onClearCrop: () => void,
    trim: TrimRange | null,
    onTrimChange: (trim: TrimRange | null) => void,
    onDuplicate: () => void,
    // This pin's layout lock and its setter
    lock: PinLock,
    onLockChange: (lock: PinLock) => void,
    pinboardRef: React.RefObject<HTMLDivElement | null>,
    grid: GridParams,
    isV1: boolean,
    onUpgradeGrid: () => void,
    dbs: {
        index_db: string | null
        user_data_db: string | null
    }
}) {
    function openURL() {
        window.open(file_url, "_blank")
    }
    // The pinboard stores the 10-char sha256 prefix; the open/folder endpoints
    // accept a prefix as the sha256 id, same as the pin's own item lookup.
    const { openFile, showInFolder, disableBackendOpen, relayEnabled } = useFileOpenActions({ sha256 })
    // In restricted mode the File actions degrade to things this pin already
    // offers: Open File becomes a new browser tab (== "Open in New Tab" below)
    // and Show in Folder becomes the FindButton the pin already renders. Only
    // a relay (real local open) makes the submenu worth showing there.
    const showFileMenu = relayEnabled || !disableBackendOpen
    const [autoLayout, setAutoLayout] = useGalleryPinAutoLayout()
    const [autoLayoutCrop, setAutoLayoutCrop] = useGalleryPinAutoCrop()
    const [selectionCrop] = useGalleryPinSelectionCrop()
    const {
        changeLayout,
        fillViewport,
        fillViewportRows,
        justifyCurrentRows,
        autoCropToCells,
        clearAutoCrops,
        clearAutoCropSelection,
        changeItemSize: changeItemSizeByKey,
        setItemSize: setItemSizeByKey,
        shiftLayout,
        shiftSelection,
        mirrorLayout,
        mirrorSelection,
        rerollLayout,
        refitToView,
        reflowKeepProportions,
        growInPlace,
        growSelection,
        swapItems,
        arrangeSelection,
        sendSelectionToRegion,
        hasLocks,
        hasAnchors,
    } = usePinboardLayoutActions({
        layout, crops, autoCrops, locks, highWater, dbs, grid, pinboardRef, onLayoutChange,
        layoutAutoCrop: autoLayoutCrop,
        selectionAutoCrop: selectionCrop,
    })
    const selected = usePinSelection(s => s.selected)

    function layoutFixedRows(rows: number) {
        fillViewportRows(rows)
    }
    // The size actions target this menu's own pin
    const changeItemSize = (increase: number) => changeItemSizeByKey(layoutKey, increase)
    const setItemSize = (size: number) => setItemSizeByKey(layoutKey, size)
    const [fs, setFs] = useGalleryFullscreen()
    const [showGrid, setShowGrid] = useGalleryPinGrid()
    // Width presets are fixed fractions of the board width, so the menu is
    // the same on every grid resolution; the step sizes scale with the
    // resolution (1 v1 column = `stepUnit` columns on this grid)
    const widthPresets: [number, string][] = [
        [1 / 18, "1/18"],
        [1 / 9, "1/9"],
        [1 / 6, "1/6"],
        [1 / 4, "1/4"],
        [1 / 3, "1/3"],
        [2 / 3, "2/3"],
        [1, "Full"],
    ]
    const stepUnit = Math.max(1, Math.round(grid.columns / 36))
    return (
        <ContextMenuContent>
            <ContextMenuItem onClick={() => openURL()}>Open in New Tab</ContextMenuItem>
            {showFileMenu && (
                <ContextMenuSub>
                    <ContextMenuSubTrigger inset>File</ContextMenuSubTrigger>
                    <ContextMenuSubContent className="w-48">
                        <ContextMenuItem onClick={openFile}>Open File</ContextMenuItem>
                        <ContextMenuItem onClick={showInFolder}>Show File in Folder</ContextMenuItem>
                    </ContextMenuSubContent>
                </ContextMenuSub>
            )}
            <ContextMenuItem onClick={onDuplicate}>Duplicate</ContextMenuItem>
            {/* Layout locks for this pin; the same toggles exist as overlay
                buttons. Anchored = position+size fixed (RGL static, an
                obstacle every fill packs around); size-locked = keeps w x h
                but may be moved. */}
            <ContextMenuCheckboxItem
                checked={lock === "anchor"}
                onCheckedChange={(checked) => onLockChange(checked ? "anchor" : null)}
            >
                Anchor in Place
            </ContextMenuCheckboxItem>
            <ContextMenuCheckboxItem
                checked={lock === "size"}
                onCheckedChange={(checked) => onLockChange(checked ? "size" : null)}
            >
                Lock Size
            </ContextMenuCheckboxItem>
            {/* Every multi-select verb, mirroring the selection toolbar.
                Deliberately shown whenever a selection exists, whether or
                not THIS pin is part of it (the submenu names its target, so
                there's no ambiguity) — and right-clicking never changes the
                selection: most of this menu is board-global, and clobbering
                the selection on the way to a global action would make every
                use of the menu destructive. */}
            {selected.length > 0 && (() => {
                const selHasAnchor = selected.some(k => locks[k] === "anchor")
                return (
                    <ContextMenuSub>
                        <ContextMenuSubTrigger inset>Selection ({selected.length})</ContextMenuSubTrigger>
                        <ContextMenuSubContent className="w-56">
                            <ContextMenuItem disabled={selected.length < 2}
                                onClick={() => arrangeSelection(selected)}>
                                Arrange
                            </ContextMenuItem>
                            <ContextMenuItem disabled={selected.length !== 2}
                                onClick={() => swapItems(selected[0], selected[1])}>
                                Swap
                            </ContextMenuItem>
                            <ContextMenuItem disabled={selected.length < 2}
                                onClick={() => arrangeSelection(selected, true)}>
                                Reflow (Keep Proportions)
                            </ContextMenuItem>
                            {/* Reroll: arrange again in a random order until
                                the composition actually changes */}
                            <ContextMenuItem disabled={selected.length < 2}
                                onClick={() => arrangeSelection(selected, false, true)}>
                                Shuffle
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => growSelection(selected)}>
                                Grow to Fill
                            </ContextMenuItem>
                            {/* Clear a preset region and pack the selection
                                to fill it; bystanders drop below the board */}
                            <ContextMenuSub>
                                <ContextMenuSubTrigger>Send to Region</ContextMenuSubTrigger>
                                <ContextMenuSubContent className="w-44">
                                    {REGION_PRESETS.map(([preset, label]) => (
                                        <ContextMenuItem key={preset}
                                            onClick={() => sendSelectionToRegion(selected, preset)}>
                                            {label}
                                        </ContextMenuItem>
                                    ))}
                                </ContextMenuSubContent>
                            </ContextMenuSub>
                            <ContextMenuSeparator />
                            <ContextMenuItem onClick={() => shiftSelection(selected, "left")}>
                                Shift Left
                            </ContextMenuItem>
                            {/* Unlike the global Center (whole-row repack,
                                greyed with anchors) this packs the selection
                                and centers it in its free span */}
                            <ContextMenuItem onClick={() => shiftSelection(selected, "center")}>
                                Center
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => shiftSelection(selected, "right")}>
                                Shift Right
                            </ContextMenuItem>
                            <ContextMenuItem disabled={selHasAnchor}
                                onClick={() => mirrorSelection(selected, "horizontal")}>
                                Mirror Horizontally
                            </ContextMenuItem>
                            <ContextMenuItem disabled={selHasAnchor}
                                onClick={() => mirrorSelection(selected, "vertical")}>
                                Mirror Vertically
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => clearAutoCropSelection(selected)}>
                                Clear Auto-Crops
                            </ContextMenuItem>
                            {selHasAnchor && (
                                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                    Mirroring can't hold an anchored item in
                                    place; release the anchors in the selection.
                                </div>
                            )}
                            <ContextMenuSeparator />
                            <ContextMenuItem onClick={() => usePinSelection.getState().clear()}>
                                Clear Selection
                                <ContextMenuShortcut>Esc</ContextMenuShortcut>
                            </ContextMenuItem>
                        </ContextMenuSubContent>
                    </ContextMenuSub>
                )
            })()}
            <ContextMenuItem onClick={onToggleCrop}>
                {cropMode ? "Finish Cropping" : "Crop Image"}
            </ContextMenuItem>
            {hasCrop && <ContextMenuItem onClick={onClearCrop}>Clear Crop</ContextMenuItem>}
            {trim?.start != null && <ContextMenuItem
                onClick={() => onTrimChange(trim.end != null ? { start: null, end: trim.end } : null)}
            >
                Clear Loop Start
            </ContextMenuItem>}
            {trim?.end != null && <ContextMenuItem
                onClick={() => onTrimChange(trim.start != null ? { start: trim.start, end: null } : null)}
            >
                Clear Loop End
            </ContextMenuItem>}
            {trim?.start != null && trim?.end != null && <ContextMenuItem onClick={() => onTrimChange(null)}>
                Clear Loop Range
            </ContextMenuItem>}
            <ContextMenuSub>
                <ContextMenuSubTrigger inset>Resize Item</ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-48">
                    {widthPresets.map(([frac, label]) => {
                        const w = Math.max(1, Math.round(grid.columns * frac))
                        return (
                            <ContextMenuItem key={label} onClick={() => setItemSize(w)}>
                                Width {w}/{grid.columns} ({label})
                            </ContextMenuItem>
                        )
                    })}
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => changeItemSize(stepUnit)}>+{stepUnit}/{grid.columns} Width</ContextMenuItem>
                    <ContextMenuItem onClick={() => changeItemSize(4 * stepUnit)}>+{4 * stepUnit}/{grid.columns} Width</ContextMenuItem>
                    <ContextMenuItem onClick={() => changeItemSize(6 * stepUnit)}>+{6 * stepUnit}/{grid.columns} Width</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => changeItemSize(-stepUnit)}>-{stepUnit}/{grid.columns} Width</ContextMenuItem>
                    <ContextMenuItem onClick={() => changeItemSize(-4 * stepUnit)}>-{4 * stepUnit}/{grid.columns} Width</ContextMenuItem>
                    <ContextMenuItem onClick={() => changeItemSize(-6 * stepUnit)}>-{6 * stepUnit}/{grid.columns} Width</ContextMenuItem>
                </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => setFs(!fs)}>
                {fs ? "Restore Pinboard Size" : "Maximize Pinboard"}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => setShowGrid(!showGrid)}>
                {showGrid ? "Hide Grid" : "Show Grid"}
            </ContextMenuItem>
            {/* When on, the board re-runs Fill Viewport (all items) whenever
                a pin is added, removed or duplicated, or the board viewport
                is explicitly grown (see PinBoard). Toggling it on IS a
                layout request, so it applies immediately. */}
            <ContextMenuCheckboxItem
                checked={autoLayout}
                onCheckedChange={(checked) => {
                    setAutoLayout(!!checked)
                    if (checked) void fillViewport(false)
                }}
            >
                Auto-Layout
            </ContextMenuCheckboxItem>
            {/* Rides on auto-layout: each auto relayout also fits every item
                to its cell (same write). The stored flag survives auto-layout
                toggling off — it just greys out — but never acts alone: both
                the disabled state here and the flag checks in PinBoard's
                effects require auto-layout on. Toggling it on applies
                crops-only immediately (the geometry is already current);
                toggling it off stops future seeding without clearing
                anything — that stays the job of Clear Auto-Crops. */}
            <ContextMenuCheckboxItem
                checked={autoLayoutCrop}
                disabled={!autoLayout}
                onCheckedChange={(checked) => {
                    setAutoLayoutCrop(!!checked)
                    if (checked) void autoCropToCells(false)
                }}
            >
                Auto-Crop to Cells
            </ContextMenuCheckboxItem>
            {isV1 && <ContextMenuItem onClick={onUpgradeGrid}>
                Upgrade Board Grid
            </ContextMenuItem>}
            <ContextMenuSeparator />
            <ContextMenuSub>
                <ContextMenuSubTrigger inset>Layout</ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-56">
                    <ContextMenuItem onClick={() => fillViewport(false)}>Fill Viewport</ContextMenuItem>
                    <ContextMenuItem onClick={() => fillViewport(true)}>Fill Viewport (Visible Only)</ContextMenuItem>
                    {/* Cycle through the packer's near-best alternative
                        compositions; later auto-fills keep the chosen one */}
                    <ContextMenuItem onClick={() => rerollLayout()}>Reroll Layout</ContextMenuItem>
                    {/* Re-solve sizes only: the arrangement keeps its
                        structure and grows to fill the viewport. No-ops when
                        locked items sit inside the target area. */}
                    <ContextMenuItem onClick={() => growInPlace()}>Grow to Fill (In Place)</ContextMenuItem>
                    {/* Reflow freely but keep each item's current share of
                        the board area */}
                    <ContextMenuItem onClick={() => reflowKeepProportions()}>Reflow (Keep Proportions)</ContextMenuItem>
                    {/* Reset the layout-height ratchet to the current
                        viewport (see pinboardGrid.ts) and fill it */}
                    {highWater > 0 && (
                        <ContextMenuItem onClick={() => refitToView()}>Refit to Current View</ContextMenuItem>
                    )}
                    <ContextMenuItem disabled={hasLocks} onClick={() => justifyCurrentRows()}>Justify Rows</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => autoCropToCells(false)}>Auto-Crop to Cells</ContextMenuItem>
                    <ContextMenuItem onClick={() => autoCropToCells(true)}>Auto-Crop to Cells (Visible Only)</ContextMenuItem>
                    <ContextMenuItem onClick={() => clearAutoCrops()}>Clear Auto-Crops</ContextMenuItem>
                    <ContextMenuSeparator />
                    {/* Items-per-Row rebuilds whole rows and cannot hold a
                        locked item in place, so it greys out while any lock
                        exists (the caption below says why). Rows stays
                        enabled: with locks it flows rows around them.
                        Shift Left/Right are gravity now — anchors just hold
                        their ground — so only Center (a whole-row flush
                        repack) and the Mirrors (a rigid flip, broken by any
                        fixed point off the axis) need an anchor-free board. */}
                    <ContextMenuSub>
                        <ContextMenuSubTrigger disabled={hasLocks}>Items per Row</ContextMenuSubTrigger>
                        <ContextMenuSubContent className="w-48">
                            {[3, 4, 5, 6].map(n => (
                                <ContextMenuItem key={n} onClick={() => changeLayout(n)}>
                                    {n} Items per Row
                                </ContextMenuItem>
                            ))}
                        </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuSub>
                        <ContextMenuSubTrigger>Rows</ContextMenuSubTrigger>
                        <ContextMenuSubContent className="w-48">
                            {[1, 2, 3, 4].map(n => (
                                <ContextMenuItem key={n} onClick={() => layoutFixedRows(n)}>
                                    {n} {n === 1 ? "Row" : "Rows"}
                                </ContextMenuItem>
                            ))}
                        </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuSub>
                        <ContextMenuSubTrigger>Shift</ContextMenuSubTrigger>
                        <ContextMenuSubContent className="w-48">
                            <ContextMenuItem onClick={() => shiftLayout("left")}>Shift Left</ContextMenuItem>
                            <ContextMenuItem disabled={hasAnchors} onClick={() => shiftLayout("center")}>Center</ContextMenuItem>
                            <ContextMenuItem onClick={() => shiftLayout("right")}>Shift Right</ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem disabled={hasAnchors} onClick={() => mirrorLayout("horizontal")}>Mirror Horizontally</ContextMenuItem>
                            <ContextMenuItem disabled={hasAnchors} onClick={() => mirrorLayout("vertical")}>Mirror Vertically</ContextMenuItem>
                        </ContextMenuSubContent>
                    </ContextMenuSub>
                    {(hasLocks || hasAnchors) && (
                        <>
                            <ContextMenuSeparator />
                            <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                {hasLocks && "Greyed row actions rebuild whole rows and can't work around locked items."}
                                {hasAnchors && " Center and Mirror can't hold anchored items in place."}
                            </div>
                        </>
                    )}
                </ContextMenuSubContent>
            </ContextMenuSub>
        </ContextMenuContent>
    )
}
