import type { LayoutItem } from "react-grid-layout/legacy";
import { ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "../ui/context-menu";
import { useGalleryFullscreen, useGalleryPinAutoCrop, useGalleryPinAutoLayout, useGalleryPinGrid } from "@/lib/state/gallery";
import { CropRect, TrimRange } from "@/lib/pinboardCrop";
import { GridParams } from "@/lib/pinboardGrid";
import { useFileOpenActions } from "@/hooks/fileOpen";
import { usePinboardLayoutActions } from "@/hooks/pinboardLayout";

export function PinBoardCtx({
    layoutKey,
    sha256,
    file_url,
    onLayoutChange,
    layout,
    crops,
    autoCrops,
    cropMode,
    hasCrop,
    onToggleCrop,
    onClearCrop,
    trim,
    onTrimChange,
    onDuplicate,
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
    // record write (one URL update, one history entry)
    onLayoutChange: (
        layout: LayoutItem[],
        autoCropOverrides?: Record<string, CropRect | null>,
    ) => void
    layout: LayoutItem[],
    // Manual crops (the layout-math base) and derived fit-to-cell auto crops
    crops: Record<string, CropRect | null>,
    autoCrops: Record<string, CropRect | null>,
    cropMode: boolean,
    hasCrop: boolean,
    onToggleCrop: () => void,
    onClearCrop: () => void,
    trim: TrimRange | null,
    onTrimChange: (trim: TrimRange | null) => void,
    onDuplicate: () => void,
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
    const {
        changeLayout,
        fillViewport,
        fillViewportRows,
        justifyCurrentRows,
        autoCropToCells,
        clearAutoCrops,
        changeItemSize: changeItemSizeByKey,
        setItemSize: setItemSizeByKey,
        shiftLayout,
        mirrorLayout,
    } = usePinboardLayoutActions({ layout, crops, autoCrops, dbs, grid, pinboardRef, onLayoutChange })

    function layoutFixedRows(rows: number) {
        fillViewportRows(rows)
    }
    // The size actions target this menu's own pin
    const changeItemSize = (increase: number) => changeItemSizeByKey(layoutKey, increase)
    const setItemSize = (size: number) => setItemSizeByKey(layoutKey, size)
    const [fs, setFs] = useGalleryFullscreen()
    const [showGrid, setShowGrid] = useGalleryPinGrid()
    const [autoLayout, setAutoLayout] = useGalleryPinAutoLayout()
    const [autoLayoutCrop, setAutoLayoutCrop] = useGalleryPinAutoCrop()
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
                    if (checked) void fillViewport(false, autoLayoutCrop)
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
                    <ContextMenuItem onClick={() => justifyCurrentRows()}>Justify Rows</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => autoCropToCells(false)}>Auto-Crop to Cells</ContextMenuItem>
                    <ContextMenuItem onClick={() => autoCropToCells(true)}>Auto-Crop to Cells (Visible Only)</ContextMenuItem>
                    <ContextMenuItem onClick={() => clearAutoCrops()}>Clear Auto-Crops</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuSub>
                        <ContextMenuSubTrigger>Items per Row</ContextMenuSubTrigger>
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
                            <ContextMenuItem onClick={() => shiftLayout("center")}>Center</ContextMenuItem>
                            <ContextMenuItem onClick={() => shiftLayout("right")}>Shift Right</ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem onClick={() => mirrorLayout("horizontal")}>Mirror Horizontally</ContextMenuItem>
                            <ContextMenuItem onClick={() => mirrorLayout("vertical")}>Mirror Vertically</ContextMenuItem>
                        </ContextMenuSubContent>
                    </ContextMenuSub>
                </ContextMenuSubContent>
            </ContextMenuSub>
        </ContextMenuContent>
    )
}
