"use client"
import {
    AlignHorizontalJustifyCenter,
    AlignVerticalJustifyStart,
    ArrowLeft,
    ArrowRight,
    Columns3,
    Crop,
    Eraser,
    Expand,
    Eye,
    FlipHorizontal2,
    FlipVertical2,
    Frame,
    Grid2x2Plus,
    LayoutDashboard,
    LayoutGrid,
    Maximize2,
    Minimize2,
    Ratio,
    Rows3,
    Shuffle,
    Trash2,
} from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import {
    useGalleryFullscreen,
    useGalleryPinAutoCrop,
    useGalleryPinAutoLayout,
    useGalleryPinGrid,
    useGalleryPinProportional,
    useGalleryPinResizeHandles,
    useGalleryPinSelectionCrop,
} from "@/lib/state/gallery"
import {
    clearUserDefaults,
    defaultableFlagLabels,
    saveUserDefaults,
} from "@/lib/pinboardDefaults"
import { usePinBoard } from "@/lib/state/pinboard"
import {
    usePinboardBoardApi,
    type PinboardBoardApi,
} from "@/lib/state/pinboardBoardApi"
import {
    ContextMenuCheckboxItem,
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuSeparator,
    ContextMenuShortcut,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
} from "../ui/context-menu"
import {
    DropdownMenuCheckboxItem,
    DropdownMenuItem,
    DropdownMenuLabel,
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
export interface MenuKit {
    Item: React.ComponentType<{
        children?: React.ReactNode
        className?: string
        inset?: boolean
        disabled?: boolean
        // Forwarded to the row element, same as CheckboxItem's below — and
        // with the same caveat: Radix puts pointer-events-none on a
        // DISABLED row, so a title there is never hoverable and the reason
        // has to go in the visible label instead.
        title?: string
        onClick?: () => void
    }>
    CheckboxItem: React.ComponentType<{
        children?: React.ReactNode
        checked?: boolean
        disabled?: boolean
        // Forwarded to the row element; Radix disables pointer events on a
        // disabled row, so a hover explanation there must go in the label
        title?: string
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
    // Radix's Label: a non-focusable, non-selectable row. Used only
    // through SectionLabel below, never directly.
    Label: React.ComponentType<{
        children?: React.ReactNode
        className?: string
    }>
}

// Destructive menu rows are styled like the destructive BUTTON — same
// fill, same foreground, focus standing in for hover (the convention set
// by the cancel-job menu in scan/JobQueue). Not red text: the dark theme's
// --destructive is a 30%-lightness button background that reads as
// disabled grey when used as a text color.
export const DESTRUCTIVE_MENU_ITEM =
    "cursor-pointer bg-destructive text-destructive-foreground"
    + " focus:bg-destructive/90 focus:text-destructive-foreground"

// Radix closes the menu when a row is SELECTED, which is right for a verb
// (it did its thing, the menu is done) and wrong for a checkbox: a toggle
// answers a question in place, the answer is visible on the row itself, and
// flipping two of them should not mean reopening the menu in between. Both
// kits wrap their checkbox row the same way, so no surface can disagree
// about it — Escape or a click outside still closes, as always.
function KeepOpenContextCheckboxItem(
    props: React.ComponentProps<typeof ContextMenuCheckboxItem>
) {
    return <ContextMenuCheckboxItem {...props} onSelect={(e) => e.preventDefault()} />
}

function KeepOpenDropdownCheckboxItem(
    props: React.ComponentProps<typeof DropdownMenuCheckboxItem>
) {
    return <DropdownMenuCheckboxItem {...props} onSelect={(e) => e.preventDefault()} />
}

export const contextMenuKit: MenuKit = {
    Item: ContextMenuItem,
    CheckboxItem: KeepOpenContextCheckboxItem,
    Separator: ContextMenuSeparator,
    Sub: ContextMenuSub,
    SubTrigger: ContextMenuSubTrigger,
    SubContent: ContextMenuSubContent,
    Shortcut: ContextMenuShortcut,
    Label: ContextMenuLabel,
}

export const dropdownMenuKit: MenuKit = {
    Item: DropdownMenuItem,
    CheckboxItem: KeepOpenDropdownCheckboxItem,
    Separator: DropdownMenuSeparator,
    Sub: DropdownMenuSub,
    SubTrigger: DropdownMenuSubTrigger,
    SubContent: DropdownMenuSubContent,
    Shortcut: DropdownMenuShortcut,
    Label: DropdownMenuLabel,
}

// The header over a run of toggle rows, marking where a menu stops
// offering VERBS (do a thing, close the menu) and starts offering
// SETTINGS (answer a question in place, menu stays open — see the
// KeepOpen wrappers above). Every menu that has such a run gets one, so
// the boundary reads the same everywhere.
//
// Styled deliberately UNLIKE a row: the kits' Label default is
// `text-sm font-semibold`, i.e. the size and weight of an enabled item,
// which is exactly the confusion to avoid. Small, uppercase and muted
// reads as a caption instead — and Radix's Label is neither focusable nor
// selectable, so it can't be arrowed onto or clicked either.
export function SectionLabel({ kit }: { kit: MenuKit }) {
    const { Label } = kit
    return (
        <Label className="px-2 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Options
        </Label>
    )
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

/**
 * Flip the Uniform Auto-Layout switch, and — when auto-layout is on —
 * immediately re-pack the board with the algorithm just chosen.
 *
 * Shared by every surface offering the switch (this menu's checkbox, the
 * fullscreen toolbar's button, the pinboard tab's button) so they cannot
 * disagree about what the toggle does. Without the re-fill, flipping it on
 * an auto-laid-out board changed nothing visible until the next pin was
 * added or removed — the mode says "the board re-packs itself", so the
 * board has to re-pack when the packer changes.
 *
 * The algorithm is passed EXPLICITLY rather than left to the board's own
 * routing: `uniform` reaches the layout hook as a render-time argument, so
 * in this handler it is still the pre-toggle value (see fillViewport in
 * hooks/pinboardLayout.ts).
 *
 * `api` comes from props where the caller has one (the context menu lives
 * inside the board) and from the registry otherwise.
 */
export function useToggleUniform(api?: PinboardBoardApi | null) {
    const { setUniform } = usePinBoard()
    const [autoLayout] = useGalleryPinAutoLayout()
    const registered = usePinboardBoardApi((s) => s.api)
    const runVerb = useRunVerb()
    const board = api ?? registered
    return (next: boolean) => {
        setUniform(next)
        if (autoLayout && board) {
            runVerb("Fill Viewport", board.fillViewport(
                false, false, undefined, next ? "uniform" : "mosaic"))
        }
    }
}

/**
 * The user layer of the creation-defaults system (see
 * lib/pinboardDefaults.ts): Save captures the current board's flags as what
 * NEW boards start with; Reset returns to the built-in defaults. Existing
 * boards — the current one included — are never touched, because defaults
 * only apply when a first pin creates a board.
 *
 * Its own component, reading every flag itself, so the rows can be rendered
 * both as a submenu of the board menus and at the top level of the
 * fullscreen toolbar's own dropdown (the same split MosaicMenuItems /
 * MosaicSubmenu makes). Duplicating them per surface is what this avoids:
 * `saveUserDefaults` takes the whole flag set, so a flag added to the
 * registry must reach every copy or one surface starts saving a subset.
 */
export function NewBoardDefaultsItems({ kit }: { kit: MenuKit }) {
    const [showGrid] = useGalleryPinGrid()
    const [autoLayout] = useGalleryPinAutoLayout()
    const [autoLayoutCrop] = useGalleryPinAutoCrop()
    const [selectionCrop] = useGalleryPinSelectionCrop()
    const [proportional] = useGalleryPinProportional()
    const [allHandles] = useGalleryPinResizeHandles()
    const { float, uniform } = usePinBoard()
    const { toast } = useToast()
    const { Item } = kit
    return (
        <>
            <Item
                title={"Capture this board's current settings as the ones NEW"
                    + " pinboards start with. Existing boards, including this"
                    + " one, are untouched"}
                onClick={() => {
                    saveUserDefaults({
                        pba: autoLayout,
                        pbc: autoLayoutCrop,
                        psc: selectionCrop,
                        pg: showGrid,
                        pbp: proportional,
                        prh: allHandles,
                        gravity: !float,
                        uniform,
                    })
                    toast({
                        title: "New-Board Defaults Saved",
                        // Named from the registry, so a flag added there
                        // can't quietly go unmentioned here. Gravity and
                        // Uniform Auto-Layout are spelled out because they
                        // are the creation defaults that aren't registry
                        // flags (they ride the layout token) — same
                        // on-screen names as their menu rows, like every
                        // registry label.
                        description: "New pinboards will start with this"
                            + ` board's current ${defaultableFlagLabels()
                                .join(", ")}, Gravity and Uniform`
                            + " Auto-Layout settings.",
                        duration: 4000,
                    })
                }}
            >
                Save Current Settings as Default
            </Item>
            <Item
                title={"Forget the saved defaults; new pinboards go back to"
                    + " the app's built-in settings"}
                onClick={() => {
                    clearUserDefaults()
                    toast({
                        title: "Built-in Defaults Restored",
                        description: "New pinboards will start with the app's"
                            + " built-in settings again.",
                        duration: 4000,
                    })
                }}
            >
                Reset to Built-in Defaults
            </Item>
        </>
    )
}

/** The same rows as a submenu, for the board menus. */
export function NewBoardDefaultsSubmenu({ kit }: { kit: MenuKit }) {
    const { Sub, SubTrigger, SubContent } = kit
    return (
        <Sub>
            <SubTrigger inset>New-Board Defaults</SubTrigger>
            <SubContent className="w-64">
                <NewBoardDefaultsItems kit={kit} />
            </SubContent>
        </Sub>
    )
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
    const [proportional] = useGalleryPinProportional()
    const [allHandles, setAllHandles] = useGalleryPinResizeHandles()
    // Gravity and uniform auto-layout ride in the layout token rather than
    // in board flags, so they come from the parsed board and are written
    // through the same path. With no records there is no token to carry
    // either switch — the setters no-op and the read would claim whatever
    // the user's creation default isn't — so both toggles are disabled
    // until a first pin.
    const { float, setFloat, uniform, setProportional, records } =
        usePinBoard()
    const hasPins = records.length > 0
    const runVerb = useRunVerb()
    const toggleUniform = useToggleUniform(api)
    const { Item, CheckboxItem, Separator, Sub, SubTrigger, SubContent, Shortcut } = kit
    return (
        <>
            <Separator />
            {/* Fullscreen-toolbar icons on the plain action items (see
                PinboardMenu for the shared convention); checkbox items and
                submenus stay icon-free */}
            <Item onClick={() => setFs(!fs)}>
                {fs
                    ? <Minimize2 className="mr-2 h-4 w-4" />
                    : <Maximize2 className="mr-2 h-4 w-4" />}
                {fs ? "Restore Pinboard Size" : maximizeLabel}
                <Shortcut>Ctrl+Shift+M</Shortcut>
            </Item>
            <Separator />
            <SectionLabel kit={kit} />
            <CheckboxItem
                checked={showGrid}
                title={"Draw the board's cell grid behind the pins, so"
                    + " sizes and gaps line up with what the packers use"}
                onCheckedChange={(checked) => setShowGrid(!!checked)}
            >
                Show Grid
            </CheckboxItem>
            {/* All eight react-resizable handles on every normal item
                instead of the bottom-right corner alone — the top-edge
                three only with gravity off, where compaction isn't
                re-gluing the top edge every event (see
                GRAVITY_RESIZE_HANDLES in GalleryPinBoard). A pure view
                preference (no token, no per-item state), so unlike gravity
                and Scale With Window it needs no board to exist. */}
            <CheckboxItem
                checked={allHandles}
                title={"Resize from every edge and corner, not just the"
                    + " bottom-right one (top-edge handles need Gravity off)"}
                onCheckedChange={(checked) => setAllHandles(!!checked)}
            >
                All Resize Handles
            </CheckboxItem>
            {/* Gravity is the board's own upward compaction, stored in the
                layout token (not a flag): turning it back on settles the
                whole board in one jump, and the browser Back button undoes
                that like any other layout write. */}
            <CheckboxItem
                checked={!float}
                disabled={!hasPins}
                onCheckedChange={(checked) => setFloat(!checked)}
            >
                {/* Radix's disabled row carries pointer-events-none, so a
                    title tooltip on it is never hoverable: the reason goes
                    in the visible label instead, like the toolbar's
                    "(requires Auto-Layout)". One string — the row is a flex
                    container, so a separate child would lose the space. */}
                {hasPins ? "Gravity" : "Gravity (pin something first)"}
            </CheckboxItem>
            {/* Freezes the current cell shape and scales the whole grid with
                the container, instead of letting a resize re-letterbox
                everything. The ON/OFF switch is a board flag, but both edges
                also write the layout token (the reference width, and the
                baked values on the way out), so like gravity it needs a
                board that exists — and the width only a mounted board
                knows. Inert in both directions by construction. */}
            <CheckboxItem
                checked={proportional}
                disabled={!hasPins}
                title={"Freeze the current cell shape; the board scales with"
                    + " the window instead of letterboxing"}
                onCheckedChange={(checked) =>
                    setProportional(!!checked, api.boardWidth)}
            >
                {hasPins
                    ? "Scale With Window"
                    : "Scale With Window (pin something first)"}
            </CheckboxItem>
            {/* When on, the board re-runs Fill Viewport (all items) whenever
                a pin is added, removed or duplicated, or the board viewport
                is explicitly grown (see PinBoard). Toggling it on IS a
                layout request, so it applies immediately. */}
            <CheckboxItem
                checked={autoLayout}
                title={"Re-pack the board to fill the viewport whenever pins"
                    + " are added or removed, instead of leaving them where"
                    + " you put them"}
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
                title={"Each auto relayout also fits every item to its cell,"
                    + " so no pin letterboxes inside its box"}
                onCheckedChange={(checked) => {
                    setAutoLayoutCrop(!!checked)
                    if (checked) void api.autoCropToCells(false)
                }}
            >
                {autoLayout
                    ? "Auto-Crop to Cells"
                    : "Auto-Crop to Cells (requires Auto-Layout)"}
            </CheckboxItem>
            {/* The auto-layout ALGORITHM: on, the fill verbs and the
                auto-layout trigger tile identical cells instead of
                composing a mosaic. Stored in the layout token like
                gravity, hence the same needs-a-board gate; flipping it
                moves nothing until the next fill, so no immediate verb
                fires here. */}
            <CheckboxItem
                checked={uniform}
                disabled={!hasPins}
                title={"Fill Viewport and auto-layout arrange items in"
                    + " identical cells instead of a mosaic. With Auto-Layout"
                    + " on, switching re-packs the board straight away"}
                onCheckedChange={(checked) => toggleUniform(!!checked)}
            >
                {hasPins
                    ? "Uniform Auto-Layout"
                    : "Uniform Auto-Layout (pin something first)"}
            </CheckboxItem>
            <Separator />
            {api.isV1 && <Item
                title={"Convert this board to the current grid resolution,"
                    + " which allows finer sizes and positions"}
                onClick={api.upgradeGrid}
            >
                <Grid2x2Plus className="mr-2 h-4 w-4" />
                Upgrade Board Grid
            </Item>}
            <NewBoardDefaultsSubmenu kit={kit} />
            <Separator />
            {/* Purges the staging band under the board's working area — where
                evictions and region sends park what didn't fit. Destructive,
                so it stays OUT of the Layout submenu and carries the live
                count instead of a vague label; 0 (or an unmeasurable board)
                disables it. Back-button undo, like the selection removals. */}
            {(() => {
                const below = api.belowViewportCount()
                return (
                    <Item
                        className={below ? DESTRUCTIVE_MENU_ITEM : undefined}
                        disabled={!below}
                        title={"Delete the pins parked in the staging band"
                            + " under the board — where evictions and region"
                            + " sends put whatever didn't fit"}
                        onClick={api.removeBelowViewport}
                    >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {/* One string: the row is a flex container, so a
                            separate `(N)` child would become its own flex
                            item and lose the space before it */}
                        {`Remove Items Below Viewport${below === null ? "" : ` (${below})`}`}
                    </Item>
                )
            })()}
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
            {/* Icons on the VERB rows only: the submenu triggers below keep
                their chevron as the affordance, the same rule the board menu
                follows for its checkbox rows. The "(Visible Only)" variants
                share one icon — the eye — so the pairs read as one verb with
                a scope, rather than as four unrelated commands. */}
            <Item
                title={"Re-pack every pin to fill the board, composing a"
                    + " mosaic (or identical cells with Uniform on)"}
                onClick={() => runVerb("Fill Viewport", api.fillViewport(false))}
            >
                <LayoutDashboard className="mr-2 h-4 w-4" />
                Fill Viewport
            </Item>
            <Item
                title={"Fill using only the pins currently above the fold,"
                    + " leaving everything below it where it is"}
                onClick={() => runVerb("Fill Viewport", api.fillViewport(true))}
            >
                <Eye className="mr-2 h-4 w-4" />
                Fill Viewport (Visible Only)
            </Item>
            {/* Fill Viewport with identical cells, whatever the board's
                algorithm flag says (the flag routes Fill Viewport itself) */}
            <Item
                title={"Fill with identical cells this once, whatever the"
                    + " board's Uniform Auto-Layout setting says"}
                onClick={() => runVerb("Uniform Layout", api.uniformLayout())}
            >
                <LayoutGrid className="mr-2 h-4 w-4" />
                Uniform Layout
            </Item>
            {/* Cycle through the packer's near-best alternative
                compositions; later auto-fills keep the chosen one */}
            <Item
                title={"Cycle to the next near-best composition of the same"
                    + " pins. Later auto-fills keep the one you land on"}
                onClick={() => runVerb("Reroll Layout", api.rerollLayout())}
            >
                <Shuffle className="mr-2 h-4 w-4" />
                Reroll Layout
            </Item>
            {/* Re-solve sizes only: the arrangement keeps its
                structure and grows to fill the viewport. With locks
                inside the target it degrades to a proportional
                reflow around them. */}
            <Item
                title={"Keep the arrangement you have and only grow the pins"
                    + " until they fill the board"}
                onClick={() => runVerb("Grow to Fill", api.growInPlace())}
            >
                <Expand className="mr-2 h-4 w-4" />
                Grow to Fill (In Place)
            </Item>
            {/* Reflow freely but keep each item's current share of
                the board area */}
            <Item
                title={"Rearrange freely, but aim every pin at the share of"
                    + " the board it already occupies — your sizing survives"}
                onClick={() => runVerb("Reflow", api.reflowKeepProportions())}
            >
                <Ratio className="mr-2 h-4 w-4" />
                Reflow (Keep Proportions)
            </Item>
            {/* Reset the layout-height ratchet to the current
                viewport (see pinboardGrid.ts) and fill it */}
            {api.highWater > 0 && (
                <Item
                    title={"This board grew taller than the window at some"
                        + " point. Drop it back to what fits now and fill that"}
                    onClick={() => runVerb("Refit", api.refitToView())}
                >
                    <Frame className="mr-2 h-4 w-4" />
                    Refit to Current View
                </Item>
            )}
            {/* Justify re-stacks rows from the top, which only an
                anchor breaks; size-locked members keep their size
                and their row justifies around them */}
            <Item
                disabled={api.hasAnchors}
                title={"Re-stack the rows you have from the top, closing"
                    + " vertical gaps without re-composing anything"}
                onClick={() => runVerb("Justify Rows", api.justifyCurrentRows())}
            >
                <AlignVerticalJustifyStart className="mr-2 h-4 w-4" />
                Justify Rows
            </Item>
            <Separator />
            <Item
                title={"Crop every pin to exactly fill its cell, removing the"
                    + " letterboxing left by aspect mismatches"}
                onClick={() => void api.autoCropToCells(false)}
            >
                <Crop className="mr-2 h-4 w-4" />
                Auto-Crop to Cells
            </Item>
            <Item
                title="Fit-to-cell crops for the pins above the fold only"
                onClick={() => void api.autoCropToCells(true)}
            >
                <Eye className="mr-2 h-4 w-4" />
                Auto-Crop to Cells (Visible Only)
            </Item>
            <Item
                title={"Drop every fit-to-cell crop. Crops you drew by hand"
                    + " are kept"}
                onClick={() => void api.clearAutoCrops()}
            >
                <Eraser className="mr-2 h-4 w-4" />
                Clear Auto-Crops
            </Item>
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
                    {[1, 2, 3, 4, 5, 6].map(n => (
                        <Item
                            key={n}
                            title={`Rebuild the board as rows of ${n}`}
                            onClick={() => void api.changeLayout(n)}
                        >
                            <Columns3 className="mr-2 h-4 w-4" />
                            {n === 1 ? "1 Item per Row" : `${n} Items per Row`}
                        </Item>
                    ))}
                </SubContent>
            </Sub>
            <Sub>
                <SubTrigger>Rows</SubTrigger>
                <SubContent className="w-48">
                    {[1, 2, 3, 4, 5, 6].map(n => (
                        <Item
                            key={n}
                            title={`Split the board's height evenly among ${n}`
                                + (n === 1 ? " row" : " rows")}
                            onClick={() => runVerb("Rows", api.fillViewportRows(n))}
                        >
                            <Rows3 className="mr-2 h-4 w-4" />
                            {n} {n === 1 ? "Row" : "Rows"}
                        </Item>
                    ))}
                </SubContent>
            </Sub>
            <Sub>
                <SubTrigger>Shift</SubTrigger>
                <SubContent className="w-48">
                    <Item
                        title="Push the whole arrangement against the left edge"
                        onClick={() => api.shiftLayout("left")}
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Shift Left
                    </Item>
                    <Item
                        disabled={api.hasAnchors}
                        title="Centre each row's pins horizontally"
                        onClick={() => api.shiftLayout("center")}
                    >
                        <AlignHorizontalJustifyCenter className="mr-2 h-4 w-4" />
                        Center
                    </Item>
                    <Item
                        title="Push the whole arrangement against the right edge"
                        onClick={() => api.shiftLayout("right")}
                    >
                        <ArrowRight className="mr-2 h-4 w-4" />
                        Shift Right
                    </Item>
                    <Separator />
                    <Item
                        disabled={api.hasAnchors}
                        title="Flip the arrangement left-to-right"
                        onClick={() => api.mirrorLayout("horizontal")}
                    >
                        <FlipHorizontal2 className="mr-2 h-4 w-4" />
                        Mirror Horizontally
                    </Item>
                    <Item
                        disabled={api.hasAnchors}
                        title="Flip the arrangement top-to-bottom"
                        onClick={() => api.mirrorLayout("vertical")}
                    >
                        <FlipVertical2 className="mr-2 h-4 w-4" />
                        Mirror Vertically
                    </Item>
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
