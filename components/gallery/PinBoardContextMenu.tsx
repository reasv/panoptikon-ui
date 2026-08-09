import type { LayoutItem } from "react-grid-layout";
import { ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "../ui/context-menu";
import { useGalleryPinAutoCrop, useGalleryPinSelectionCrop } from "@/lib/state/gallery";
import { BoardGlobalMenuItems, contextMenuKit } from "./PinboardGlobalMenu";
import type { PinboardBoardApi } from "@/lib/state/pinboardBoardApi";
import { CropRect, PinLock, PinOrientation, TrimRange, isIdentityOrientation } from "@/lib/pinboardCrop";
import { GridParams } from "@/lib/pinboardGrid";
import { useFileOpenActions } from "@/hooks/fileOpen";
import { useFileShare } from "@/hooks/fileShare";
import { REGION_PRESETS, usePinboardLayoutActions } from "@/hooks/pinboardLayout";
import { RegionIcon } from "./RegionIcon";
import { useToast } from "@/components/ui/use-toast";
import { usePinSelection } from "@/lib/state/pinboardSelection";
import { usePinboardCarry } from "@/lib/state/pinboardCarry";
import { SelectionExportSubmenu } from "./PinboardExportMenu";
import { trimWithBound } from "@/lib/videoTrim";

export function PinBoardCtx({
    layoutKey,
    sha256,
    file_url,
    onLayoutChange,
    layout,
    crops,
    autoCrops,
    locks,
    orients,
    highWater,
    float,
    cropKey,
    cropMode,
    hasCrop,
    onToggleCrop,
    onClearCrop,
    trim,
    onTrimChange,
    videoRef,
    videoLoaded,
    onDuplicate,
    onUnpin,
    onRemove,
    onRemoveAllBut,
    lock,
    onLockChange,
    pinboardRef,
    dbs,
    grid,
    gridWidth,
    isV1,
    onUpgradeGrid,
}: {
    layoutKey: string
    sha256: string
    file_url: string
    // autoCropOverrides ride along with the layout so both land in one
    // record write (one URL update, one history entry); newHighWater
    // updates the board's layout-height ratchet in the same write, and the
    // orientation/manual-crop maps carry the remaining hField slots the
    // rotate/flip verbs rewrite alongside the geometry
    onLayoutChange: (
        layout: LayoutItem[],
        autoCropOverrides?: Record<string, CropRect | null>,
        newHighWater?: number,
        orientationOverrides?: Record<string, PinOrientation | null>,
        manualCropOverrides?: Record<string, CropRect | null>,
    ) => void
    layout: LayoutItem[],
    // Manual crops (the layout-math base) and derived fit-to-cell auto crops
    crops: Record<string, CropRect | null>,
    autoCrops: Record<string, CropRect | null>,
    locks: Record<string, PinLock>,
    // Per-pin D4 orientations; the layout math needs them to read the
    // natural dimensions in display space
    orients: Record<string, PinOrientation | null>,
    highWater: number,
    // Gravity off (the layout token's float switch): the size and rotation
    // verbs this menu owns resolve their own overlaps then
    float: boolean,
    // The BOARD's open crop item (cropMode below is only whether it is this
    // pin): an overlap resolution run for another pin's verb has to hold it
    // still, so the crop window never moves mid-session
    cropKey: string | null,
    cropMode: boolean,
    hasCrop: boolean,
    onToggleCrop: () => void,
    onClearCrop: () => void,
    trim: TrimRange | null,
    onTrimChange: (trim: TrimRange | null) => void,
    // The pin's <video>, for the set-at-playhead loop verbs; videoLoaded is
    // whether it exists (a playhead to read), which the menu cannot learn
    // from a ref during render
    videoRef: React.RefObject<HTMLVideoElement | null>,
    videoLoaded: boolean,
    onDuplicate: () => void,
    // Record splices, owned by the board: this pin's own removal (the
    // context-menu twin of the overlay unpin button) and the two
    // selection-scoped removals, which also back the below-viewport purge
    // in the board-global section
    onUnpin: () => void,
    onRemove: (keys: string[]) => void,
    onRemoveAllBut: (keys: string[]) => void,
    // This pin's layout lock and its setter
    lock: PinLock,
    onLockChange: (lock: PinLock) => void,
    pinboardRef: React.RefObject<HTMLDivElement | null>,
    // The EFFECTIVE grid the board renders with (the proportional scale is
    // already folded in), and the board's measured pixel width — published
    // onward as the board API's boardWidth
    grid: GridParams,
    gridWidth: number,
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
    // Set one loop bound to the video's current time — the same verb as the
    // player surface's set-start/set-end buttons and the gallery's I/O keys,
    // sharing their bound-placement rule (see trimWithBound).
    const setLoopBound = (which: "start" | "end") => {
        const video = videoRef.current
        if (!video) return
        const next = trimWithBound(trim, which, video.currentTime)
        onTrimChange(next)
        // Setting the end mid-playback parks the playhead exactly at the end
        // point, from which crossing detection would never fire — restart the
        // loop, which doubles as "here's your loop" feedback
        if (which === "end" && !video.paused) video.currentTime = next?.start ?? 0
    }
    // The pinboard stores the 10-char sha256 prefix; the open/folder endpoints
    // accept a prefix as the sha256 id, same as the pin's own item lookup.
    const { openFile, showInFolder, disableBackendOpen, relayEnabled } = useFileOpenActions({ sha256 })
    const share = useFileShare({ sha256 })
    // In restricted mode the File actions degrade to things this pin already
    // offers: Open File becomes a new browser tab (== "Open in New Tab" below)
    // and Show in Folder becomes the FindButton the pin already renders. Only
    // a relay (real local open) makes the submenu worth showing there.
    const showFileMenu = relayEnabled || !disableBackendOpen
    const [autoLayoutCrop] = useGalleryPinAutoCrop()
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
        orientItem,
        resetOrientation,
        orientSelection,
        shiftLayout,
        shiftSelection,
        compressSelection,
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
        belowViewportKeys,
    } = usePinboardLayoutActions({
        layout, crops, autoCrops, locks, orients, highWater, float, cropKey,
        dbs, grid, pinboardRef, onLayoutChange,
        layoutAutoCrop: autoLayoutCrop,
        selectionAutoCrop: selectionCrop,
    })
    const selected = usePinSelection(s => s.selected)
    // Layout verbs report refusals (anchored items that can't travel,
    // size-locked items that can't fit, packer failures) as messages
    // instead of silently doing nothing — surface them as toasts
    const { toast } = useToast()
    const runVerb = (label: string, result: Promise<string | null> | void) => {
        void Promise.resolve(result).then(err => {
            if (err) toast({ title: label, description: err, duration: 4000 })
        })
    }

    // The size actions target this menu's own pin
    const changeItemSize = (increase: number) => changeItemSizeByKey(layoutKey, increase)
    const setItemSize = (size: number) => setItemSizeByKey(layoutKey, size)
    // This pin's orientation, read from the map the board already threads
    // through for the layout math; null is identity and hides the reset
    const orientation = orients[layoutKey] ?? null
    // Undoing an odd number of quarter turns turns the box back too, so
    // that alone is the case a lock can forbid (a 180 or a bare mirror
    // leaves the box aspect untouched)
    const resetTurnsBox = !!orientation && orientation.quarterTurns % 2 === 1
    // The board-global section (shared with the pinboard tab menu) gets
    // its verbs from this menu's own layout-actions instance
    const boardApi: PinboardBoardApi = {
        changeLayout, fillViewport, fillViewportRows, justifyCurrentRows,
        autoCropToCells, clearAutoCrops, shiftLayout, mirrorLayout,
        rerollLayout, refitToView, reflowKeepProportions, growInPlace,
        hasLocks, hasAnchors,
        highWater, isV1, boardWidth: gridWidth, upgradeGrid: onUpgradeGrid,
        belowViewportCount: () => belowViewportKeys()?.length ?? null,
        removeBelowViewport: () => onRemove(belowViewportKeys() ?? []),
    }
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
                        {share.primaryVerb === "copy" && (
                            <ContextMenuItem onClick={() => share.execute()}>Copy file</ContextMenuItem>
                        )}
                        <ContextMenuItem onClick={() => share.download()}>Download original</ContextMenuItem>
                    </ContextMenuSubContent>
                </ContextMenuSub>
            )}
            {/* This pin as a file on disk, cropped and oriented as it is on
                the board — the one export that needs no selection at all,
                and the reason the crop/rotate tools are usable as an image
                editor. Deliberately scoped to THIS pin even when a
                selection exists: the selection's own export lives in the
                Selection submenu below, next to the verbs it belongs with. */}
            <SelectionExportSubmenu
                kit={contextMenuKit}
                keys={[layoutKey]}
                inset
            />
            <ContextMenuItem onClick={onDuplicate}>Duplicate</ContextMenuItem>
            {/* Removes THIS copy, not the first record matching the sha256 —
                the layout key carries the record offset. Same weight as the
                hover overlay's unpin button (a single click there too). */}
            <ContextMenuItem onClick={onUnpin}>Unpin</ContextMenuItem>
            {/* Layout locks for this pin; the same toggles exist as overlay
                buttons. Anchored = position+size fixed (RGL static, an
                obstacle every fill packs around); size-locked = keeps w x h
                but may be moved. These two are the kit's checkbox rows
                spelled out (the kit is for sections shared between menus),
                so they repeat its keep-open select — a toggle shows its
                answer on the row and has no business closing the menu. */}
            <ContextMenuCheckboxItem
                checked={lock === "anchor"}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(checked) => onLockChange(checked ? "anchor" : null)}
            >
                Anchor in Place
            </ContextMenuCheckboxItem>
            <ContextMenuCheckboxItem
                checked={lock === "size"}
                onSelect={(e) => e.preventDefault()}
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
                                onClick={() => runVerb("Arrange", arrangeSelection(selected))}>
                                Arrange
                            </ContextMenuItem>
                            <ContextMenuItem disabled={selected.length !== 2}
                                onClick={() => runVerb("Swap", swapItems(selected[0], selected[1]))}>
                                Swap
                            </ContextMenuItem>
                            <ContextMenuItem disabled={selected.length < 2}
                                onClick={() => runVerb("Reflow", arrangeSelection(selected, true))}>
                                Reflow (Keep Proportions)
                            </ContextMenuItem>
                            {/* Reroll: arrange again in a random order until
                                the composition actually changes */}
                            <ContextMenuItem disabled={selected.length < 2}
                                onClick={() => runVerb("Shuffle", arrangeSelection(selected, false, true))}>
                                Shuffle
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => runVerb("Grow to Fill", growSelection(selected))}>
                                Grow to Fill
                            </ContextMenuItem>
                            {/* Clear a preset region and pack the selection
                                to fill it; bystanders drop below the board */}
                            <ContextMenuSub>
                                <ContextMenuSubTrigger>Send to Region</ContextMenuSubTrigger>
                                <ContextMenuSubContent className="w-48">
                                    {REGION_PRESETS.map(([preset, label]) => (
                                        <ContextMenuItem key={preset}
                                            onClick={() => runVerb("Send to Region", sendSelectionToRegion(selected, preset))}>
                                            <span className="flex items-center gap-2">
                                                <RegionIcon preset={preset} className="w-4 h-4" />
                                                {label}
                                            </span>
                                        </ContextMenuItem>
                                    ))}
                                </ContextMenuSubContent>
                            </ContextMenuSub>
                            {/* The selection as one image file, the twin of
                                the toolbar's own export row */}
                            <SelectionExportSubmenu
                                kit={contextMenuKit}
                                keys={selected}
                            />
                            {/* Enters the board's targeting mode (via the
                                carry store — the board owns that state):
                                hover highlights holes, click places the
                                selection there */}
                            <ContextMenuItem
                                onClick={() => usePinboardCarry.getState().requestHoleTarget()}>
                                Move to Hole…
                            </ContextMenuItem>
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
                            {/* Same family as the Shifts, one step further:
                                each letterboxed item also loses its bars on
                                that axis, and every item keeps the gap it
                                had toward the compression side instead of
                                falling flush. Up needs no gap logic — the
                                vertical compactor closes the freed rows,
                                and with gravity off it is simply an
                                in-place letterbox trim (nothing closes
                                them; see verbTitle in GalleryPinBoard). */}
                            <ContextMenuItem
                                onClick={() => runVerb("Compress Left", compressSelection(selected, "left"))}>
                                Compress Left
                            </ContextMenuItem>
                            <ContextMenuItem
                                onClick={() => runVerb("Compress Right", compressSelection(selected, "right"))}>
                                Compress Right
                            </ContextMenuItem>
                            <ContextMenuItem
                                onClick={() => runVerb("Compress Up", compressSelection(selected, "up"))}>
                                Compress Up
                            </ContextMenuItem>
                            <ContextMenuItem disabled={selHasAnchor}
                                onClick={() => mirrorSelection(selected, "horizontal")}>
                                Mirror Horizontally
                            </ContextMenuItem>
                            <ContextMenuItem disabled={selHasAnchor}
                                onClick={() => mirrorSelection(selected, "vertical")}>
                                Mirror Vertically
                            </ContextMenuItem>
                            {/* The Mirror pair above rearranges the items;
                                these turn the pictures themselves. Rotation
                                is all-or-nothing on a locked selection and
                                says so in a toast rather than greying. */}
                            <ContextMenuItem
                                onClick={() => runVerb("Flip Images", orientSelection(selected, "flipH"))}>
                                Flip Images Horizontally
                            </ContextMenuItem>
                            <ContextMenuItem
                                onClick={() => runVerb("Flip Images", orientSelection(selected, "flipV"))}>
                                Flip Images Vertically
                            </ContextMenuItem>
                            <ContextMenuItem
                                onClick={() => runVerb("Rotate Images", orientSelection(selected, "ccw"))}>
                                Rotate Images Left
                            </ContextMenuItem>
                            <ContextMenuItem
                                onClick={() => runVerb("Rotate Images", orientSelection(selected, "cw"))}>
                                Rotate Images Right
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
                            {/* The removal pair sits last, below Clear
                                Selection. No confirm dialog and no
                                destructive styling: one record write is one
                                history entry, so the browser Back button
                                restores the removed pins (the toast says
                                so), and a filled red row would advertise a
                                finality these verbs don't have. The
                                separator alone does the fencing. */}
                            <ContextMenuSeparator />
                            <ContextMenuItem onClick={() => onRemove(selected)}>
                                Remove Selected
                                <ContextMenuShortcut>Del</ContextMenuShortcut>
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => onRemoveAllBut(selected)}>
                                Remove All but Selected
                            </ContextMenuItem>
                        </ContextMenuSubContent>
                    </ContextMenuSub>
                )
            })()}
            <ContextMenuItem onClick={onToggleCrop}>
                {cropMode ? "Finish Cropping" : "Crop Image"}
            </ContextMenuItem>
            {hasCrop && <ContextMenuItem onClick={onClearCrop}>Clear Crop</ContextMenuItem>}
            {/* The loop verbs work at every pin size — the player's own row
                drops its trim button on narrow pins, and its rail vanishes
                below ~90px, but the context menu is always full size. */}
            {videoLoaded && <ContextMenuItem onClick={() => setLoopBound("start")}>
                Set Loop Start at Playhead
            </ContextMenuItem>}
            {videoLoaded && <ContextMenuItem onClick={() => setLoopBound("end")}>
                Set Loop End at Playhead
            </ContextMenuItem>}
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
            {/* Resizing is the one thing a lock legitimately forbids —
                greyed instead of silently ignoring the clicks */}
            <ContextMenuSub>
                <ContextMenuSubTrigger inset disabled={lock !== null}>Resize Item</ContextMenuSubTrigger>
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
            {/* Orientation of the IMAGE (the Selection submenu's Mirror
                entries move items instead). A quarter turn swaps the box's
                pixel dimensions, so it follows Resize Item's lock rule —
                greyed, not silently ignored; flips move nothing and stay
                available. Repeating composes: two turns are 180 degrees,
                and every op is exactly undone by its opposite. */}
            <ContextMenuSub>
                <ContextMenuSubTrigger inset>Rotate / Flip</ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-48">
                    <ContextMenuItem disabled={lock !== null}
                        onClick={() => void orientItem(layoutKey, "ccw")}>
                        Rotate Left
                    </ContextMenuItem>
                    <ContextMenuItem disabled={lock !== null}
                        onClick={() => void orientItem(layoutKey, "cw")}>
                        Rotate Right
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => void orientItem(layoutKey, "flipH")}>
                        Flip Horizontally
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => void orientItem(layoutKey, "flipV")}>
                        Flip Vertically
                    </ContextMenuItem>
                    {!isIdentityOrientation(orientation) && (
                        <>
                            <ContextMenuSeparator />
                            <ContextMenuItem disabled={lock !== null && resetTurnsBox}
                                onClick={() => void resetOrientation(layoutKey)}>
                                Reset Orientation
                            </ContextMenuItem>
                        </>
                    )}
                </ContextMenuSubContent>
            </ContextMenuSub>
            <BoardGlobalMenuItems kit={contextMenuKit} api={boardApi} />
        </ContextMenuContent>
    )
}
