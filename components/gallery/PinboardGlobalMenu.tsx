"use client"
import { useToast } from "@/components/ui/use-toast"
import {
    useGalleryFullscreen,
    useGalleryPinAutoCrop,
    useGalleryPinAutoLayout,
    useGalleryPinGrid,
    useGalleryPinSelectionCrop,
} from "@/lib/state/gallery"
import { clearUserDefaults, saveUserDefaults } from "@/lib/pinboardDefaults"
import type { PinboardBoardApi } from "@/lib/state/pinboardBoardApi"
import {
    ContextMenuCheckboxItem,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuShortcut,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
} from "../ui/context-menu"
import {
    DropdownMenuCheckboxItem,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
} from "../ui/dropdown-menu"

// The board-global menu section (maximize, grid, auto-layout flags and the
// whole Layout submenu) renders into two different Radix menus: the
// per-pin right-click ContextMenu — the primary surface, the only one
// reachable while maximized without the fullscreen bar — and the pinboard
// tab's chevron DropdownMenu, where it makes the same verbs discoverable
// without knowing about right-click. Radix keeps the two primitive sets
// API-parallel, so one component takes whichever kit and the sections
// cannot drift apart.
interface MenuKit {
    Item: React.ComponentType<{
        children?: React.ReactNode
        className?: string
        inset?: boolean
        disabled?: boolean
        onClick?: () => void
    }>
    CheckboxItem: React.ComponentType<{
        children?: React.ReactNode
        checked?: boolean
        disabled?: boolean
        onCheckedChange?: (checked: boolean) => void
    }>
    Separator: React.ComponentType<object>
    Sub: React.ComponentType<{ children?: React.ReactNode }>
    SubTrigger: React.ComponentType<{
        children?: React.ReactNode
        inset?: boolean
        disabled?: boolean
    }>
    SubContent: React.ComponentType<{
        children?: React.ReactNode
        className?: string
    }>
    Shortcut: React.ComponentType<{ children?: React.ReactNode }>
}

export const contextMenuKit: MenuKit = {
    Item: ContextMenuItem,
    CheckboxItem: ContextMenuCheckboxItem,
    Separator: ContextMenuSeparator,
    Sub: ContextMenuSub,
    SubTrigger: ContextMenuSubTrigger,
    SubContent: ContextMenuSubContent,
    Shortcut: ContextMenuShortcut,
}

export const dropdownMenuKit: MenuKit = {
    Item: DropdownMenuItem,
    CheckboxItem: DropdownMenuCheckboxItem,
    Separator: DropdownMenuSeparator,
    Sub: DropdownMenuSub,
    SubTrigger: DropdownMenuSubTrigger,
    SubContent: DropdownMenuSubContent,
    Shortcut: DropdownMenuShortcut,
}

// Layout verbs report refusals (anchored items that can't travel,
// size-locked items that can't fit, packer failures) as messages
// instead of silently doing nothing — surface them as toasts
function useRunVerb() {
    const { toast } = useToast()
    return (label: string, result: Promise<string | null> | void) => {
        void Promise.resolve(result).then(err => {
            if (err) toast({ title: label, description: err, duration: 4000 })
        })
    }
}

export function BoardGlobalMenuItems({
    kit,
    api,
    maximizeLabel = "Maximize Pinboard",
}: {
    kit: MenuKit
    // The mounted board's verbs — from props in the context menu (it lives
    // inside the board), from the registry in the tab menu (it doesn't)
    api: PinboardBoardApi
    // The tab menu shortens this to "Maximize": there the surrounding tab
    // already says "Pinboard", and the long form wraps the w-56 menu
    maximizeLabel?: string
}) {
    const [fs, setFs] = useGalleryFullscreen()
    const [showGrid, setShowGrid] = useGalleryPinGrid()
    const [autoLayout, setAutoLayout] = useGalleryPinAutoLayout()
    const [autoLayoutCrop, setAutoLayoutCrop] = useGalleryPinAutoCrop()
    const [selectionCrop] = useGalleryPinSelectionCrop()
    const { toast } = useToast()
    const runVerb = useRunVerb()
    const { Item, CheckboxItem, Separator, Sub, SubTrigger, SubContent, Shortcut } = kit
    return (
        <>
            <Separator />
            <Item onClick={() => setFs(!fs)}>
                {fs ? "Restore Pinboard Size" : maximizeLabel}
                <Shortcut>Ctrl+Shift+M</Shortcut>
            </Item>
            <Item onClick={() => setShowGrid(!showGrid)}>
                {showGrid ? "Hide Grid" : "Show Grid"}
            </Item>
            {/* When on, the board re-runs Fill Viewport (all items) whenever
                a pin is added, removed or duplicated, or the board viewport
                is explicitly grown (see PinBoard). Toggling it on IS a
                layout request, so it applies immediately. */}
            <CheckboxItem
                checked={autoLayout}
                onCheckedChange={(checked) => {
                    setAutoLayout(!!checked)
                    if (checked) runVerb("Fill Viewport", api.fillViewport(false))
                }}
            >
                Auto-Layout
            </CheckboxItem>
            {/* Rides on auto-layout: each auto relayout also fits every item
                to its cell (same write). The stored flag survives auto-layout
                toggling off — it just greys out — but never acts alone: both
                the disabled state here and the flag checks in PinBoard's
                effects require auto-layout on. Toggling it on applies
                crops-only immediately (the geometry is already current);
                toggling it off stops future seeding without clearing
                anything — that stays the job of Clear Auto-Crops. */}
            <CheckboxItem
                checked={autoLayoutCrop}
                disabled={!autoLayout}
                onCheckedChange={(checked) => {
                    setAutoLayoutCrop(!!checked)
                    if (checked) void api.autoCropToCells(false)
                }}
            >
                Auto-Crop to Cells
            </CheckboxItem>
            {api.isV1 && <Item onClick={api.upgradeGrid}>
                Upgrade Board Grid
            </Item>}
            {/* User layer of the creation-defaults system (see
                lib/pinboardDefaults.ts): Save captures the current board
                flags as what NEW boards start with; Reset returns to the
                built-in defaults. Existing boards — this one included —
                are never touched: defaults apply only when a first pin
                creates a board. */}
            <Sub>
                <SubTrigger inset>New-Board Defaults</SubTrigger>
                <SubContent className="w-64">
                    <Item onClick={() => {
                        saveUserDefaults({
                            pba: autoLayout,
                            pbc: autoLayoutCrop,
                            psc: selectionCrop,
                            pg: showGrid,
                        })
                        toast({
                            title: "New-Board Defaults Saved",
                            description: "New pinboards will start with this"
                                + " board's current Auto-Layout, Auto-Crop,"
                                + " selection-crop and grid settings.",
                            duration: 4000,
                        })
                    }}>
                        Save Current Settings as Default
                    </Item>
                    <Item onClick={() => {
                        clearUserDefaults()
                        toast({
                            title: "Built-in Defaults Restored",
                            description: "New pinboards will start with the"
                                + " app's built-in settings again.",
                            duration: 4000,
                        })
                    }}>
                        Reset to Built-in Defaults
                    </Item>
                </SubContent>
            </Sub>
            <Separator />
            <Sub>
                <SubTrigger inset>Layout</SubTrigger>
                <SubContent className="w-56">
                    <LayoutMenuItems kit={kit} api={api} />
                </SubContent>
            </Sub>
        </>
    )
}

// The Layout verb list, separated from its Sub wrapper so the fullscreen
// toolbar can put the same items at the top level of its own dropdown
export function LayoutMenuItems({
    kit,
    api,
}: {
    kit: MenuKit
    api: PinboardBoardApi
}) {
    const runVerb = useRunVerb()
    const { Item, Separator, Sub, SubTrigger, SubContent } = kit
    return (
        <>
            <Item onClick={() => runVerb("Fill Viewport", api.fillViewport(false))}>Fill Viewport</Item>
            <Item onClick={() => runVerb("Fill Viewport", api.fillViewport(true))}>Fill Viewport (Visible Only)</Item>
            {/* Cycle through the packer's near-best alternative
                compositions; later auto-fills keep the chosen one */}
            <Item onClick={() => runVerb("Reroll Layout", api.rerollLayout())}>Reroll Layout</Item>
            {/* Re-solve sizes only: the arrangement keeps its
                structure and grows to fill the viewport. With locks
                inside the target it degrades to a proportional
                reflow around them. */}
            <Item onClick={() => runVerb("Grow to Fill", api.growInPlace())}>Grow to Fill (In Place)</Item>
            {/* Reflow freely but keep each item's current share of
                the board area */}
            <Item onClick={() => runVerb("Reflow", api.reflowKeepProportions())}>Reflow (Keep Proportions)</Item>
            {/* Reset the layout-height ratchet to the current
                viewport (see pinboardGrid.ts) and fill it */}
            {api.highWater > 0 && (
                <Item onClick={() => runVerb("Refit", api.refitToView())}>Refit to Current View</Item>
            )}
            {/* Justify re-stacks rows from the top, which only an
                anchor breaks; size-locked members keep their size
                and their row justifies around them */}
            <Item disabled={api.hasAnchors} onClick={() => runVerb("Justify Rows", api.justifyCurrentRows())}>Justify Rows</Item>
            <Separator />
            <Item onClick={() => void api.autoCropToCells(false)}>Auto-Crop to Cells</Item>
            <Item onClick={() => void api.autoCropToCells(true)}>Auto-Crop to Cells (Visible Only)</Item>
            <Item onClick={() => void api.clearAutoCrops()}>Clear Auto-Crops</Item>
            <Separator />
            {/* Items-per-Row rebuilds whole rows and cannot hold a
                locked item in place, so it greys out while any lock
                exists (the caption below says why). Rows stays
                enabled: with locks it flows rows around them.
                Shift Left/Right are gravity now — anchors just hold
                their ground — so only Center (a whole-row flush
                repack) and the Mirrors (a rigid flip, broken by any
                fixed point off the axis) need an anchor-free board. */}
            <Sub>
                <SubTrigger disabled={api.hasLocks}>Items per Row</SubTrigger>
                <SubContent className="w-48">
                    {[3, 4, 5, 6].map(n => (
                        <Item key={n} onClick={() => void api.changeLayout(n)}>
                            {n} Items per Row
                        </Item>
                    ))}
                </SubContent>
            </Sub>
            <Sub>
                <SubTrigger>Rows</SubTrigger>
                <SubContent className="w-48">
                    {[1, 2, 3, 4].map(n => (
                        <Item key={n} onClick={() => runVerb("Rows", api.fillViewportRows(n))}>
                            {n} {n === 1 ? "Row" : "Rows"}
                        </Item>
                    ))}
                </SubContent>
            </Sub>
            <Sub>
                <SubTrigger>Shift</SubTrigger>
                <SubContent className="w-48">
                    <Item onClick={() => api.shiftLayout("left")}>Shift Left</Item>
                    <Item disabled={api.hasAnchors} onClick={() => api.shiftLayout("center")}>Center</Item>
                    <Item onClick={() => api.shiftLayout("right")}>Shift Right</Item>
                    <Separator />
                    <Item disabled={api.hasAnchors} onClick={() => api.mirrorLayout("horizontal")}>Mirror Horizontally</Item>
                    <Item disabled={api.hasAnchors} onClick={() => api.mirrorLayout("vertical")}>Mirror Vertically</Item>
                </SubContent>
            </Sub>
            {(api.hasLocks || api.hasAnchors) && (
                <>
                    <Separator />
                    {/* Cause first: the user needs to know WHAT disabled
                        these verbs (the lock badges on their pins), not how
                        the packers work */}
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        {api.hasLocks && "Anchored or size-locked items disable Items per Row."}
                        {api.hasAnchors && " Anchored items disable Justify, Center and Mirror."}
                    </div>
                </>
            )}
        </>
    )
}
