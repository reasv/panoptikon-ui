'use client'

import { useEffect, useState } from "react"
import {
    ChevronDown,
    Crop,
    Grid2x2Plus,
    Grid3x3,
    History,
    LibraryBig,
    Minimize2,
    PenLine,
    Save,
    SaveAll,
    Trash2,
    WandSparkles,
} from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { usePinboardActions } from "@/lib/pinboardSave"
import { usePinBoard } from "@/lib/state/pinboard"
import { useSelectedDBs } from "@/lib/state/database"
import { $api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useToast } from "@/components/ui/use-toast"
import {
    useGalleryFullscreen,
    useGalleryPinAutoCrop,
    useGalleryPinAutoLayout,
    useGalleryPinBoardId,
    useGalleryPinGrid,
} from "@/lib/state/gallery"
import { usePinboardBoardApi } from "@/lib/state/pinboardBoardApi"
import { PinboardLibraryDialog } from "./PinboardLibrary"
import { PinboardHistoryPanel } from "./PinboardHistory"
import { BoardGlobalMenuItems, LayoutMenuItems, dropdownMenuKit } from "./PinboardGlobalMenu"

// The library actions and their dialogs, shared by the two surfaces that
// offer them: the tab chevron's dropdown and the fullscreen toolbar. Save
// is one click and never asks anything: with a pbid it appends a version
// to that board (no-op when unchanged), without one it creates a board.
// "Save as new copy" is the first-class fork — it snapshots the CURRENT
// state (including unsaved modifications) as a new board and leaves the
// original untouched.
function usePinboardDialogs() {
    const { save, rename, pbid } = usePinboardActions()
    const { updateRecords } = usePinBoard()
    const setPbid = useGalleryPinBoardId()[1]
    const { toast } = useToast()
    const dbs = useSelectedDBs()[0]
    const [libraryOpen, setLibraryOpen] = useState(false)
    const [historyOpen, setHistoryOpen] = useState(false)
    const [renameOpen, setRenameOpen] = useState(false)
    const [renameValue, setRenameValue] = useState("")
    const [clearOpen, setClearOpen] = useState(false)

    const { data: board } = $api.useQuery(
        "get",
        "/api/pinboards/{pinboard_id}",
        {
            params: {
                path: { pinboard_id: pbid ?? -1 },
                query: { ...dbs },
            },
        },
        { enabled: pbid != null }
    )

    const openRename = () => {
        setRenameValue(board?.name ?? "")
        setRenameOpen(true)
    }
    const submitRename = async () => {
        setRenameOpen(false)
        const trimmed = renameValue.trim()
        await rename(trimmed === "" ? null : trimmed)
    }

    // Clear wipes the LIVE board only — a saved board's versions stay on
    // the server, reloadable from the Library. Emptying the records rides
    // the board-destruction path in usePinBoard (gpb/ghp and the
    // defaultable flags reset with it), and pbid drops in the same tick so
    // the next first pin creates a fresh board instead of saving over this
    // one. nuqs merges the same-tick writes into ONE history entry: the
    // browser Back button restores the board whole, which is why a toast
    // saying so replaces any heavier undo mechanism.
    const submitClear = () => {
        setClearOpen(false)
        updateRecords(() => [])
        void setPbid(null)
        toast({
            title: "Pinboard cleared",
            description: "Press the browser Back button to restore it.",
            duration: 4000,
        })
    }

    const dialogs = (
        <>
            <PinboardLibraryDialog open={libraryOpen} onOpenChange={setLibraryOpen} />
            <PinboardHistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
            <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Rename pinboard</DialogTitle>
                    </DialogHeader>
                    <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        placeholder="Untitled"
                        onKeyDown={(e) => {
                            if (e.key === "Enter") submitRename()
                        }}
                        autoFocus
                    />
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setRenameOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={submitRename}>Rename</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <ConfirmDialog
                open={clearOpen}
                title="Clear pinboard?"
                description={
                    "Every pin will be removed from the board."
                    + (pbid != null
                        ? ` Saved versions of “${board?.name || `board ${pbid}`}”`
                            + " stay in the Library."
                        : " This board was never saved, so this discards it.")
                }
                confirmLabel="Clear"
                onConfirm={submitClear}
                onCancel={() => setClearOpen(false)}
            />
        </>
    )
    return {
        save,
        pbid,
        board,
        openLibrary: () => setLibraryOpen(true),
        openHistory: () => setHistoryOpen(true),
        openRename,
        openClear: () => setClearOpen(true),
        dialogs,
    }
}

// All board-level verbs live in this one chevron, so the tab header costs
// ~24px regardless of viewport width. The chevron renders as a right
// segment of the Pinboard tab's split button: the wrapper in PinboardTabs
// carries the active-tab background, so this button only draws its own
// hover state and stretches to the wrapper's height.
// Below the library items sits the board-global section shared with the
// per-pin right-click menu — the discoverable path to the same verbs.
// The chevron stays clickable even while another tab is active and the
// board unmounted: the library verbs and Clear operate on the URL state,
// not the mounted board, so a board can be saved or erased without
// loading it. Only the board-global section needs the mounted board's
// verb registry, and it simply doesn't render while that's empty.
export function PinboardMenu() {
    const { save, pbid, board, openLibrary, openHistory, openRename, openClear, dialogs } =
        usePinboardDialogs()
    const boardApi = usePinboardBoardApi(s => s.api)

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        title="Pinboard actions"
                        aria-label="Pinboard actions"
                        className="inline-flex shrink-0 items-center justify-center rounded-sm rounded-l-none px-1 transition-colors hover:bg-foreground/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                        <ChevronDown className="h-4 w-4" />
                    </button>
                </DropdownMenuTrigger>
                {/* Left-align the menu with the whole split button: offset by
                    the width of the toggle + label segments left of this
                    chevron. */}
                <DropdownMenuContent align="start" alignOffset={-104} className="w-56">
                    {/* Same icons as the fullscreen toolbar's buttons, so
                        the two surfaces for these verbs read as one set.
                        mr-2 + h-4 lands the labels on the pl-8 indent the
                        checkbox items below use. Checkbox items and the
                        submenus stay icon-free: their check/chevron marks
                        are the affordance. */}
                    <DropdownMenuItem onClick={() => save(false)}>
                        <Save className="mr-2 h-4 w-4" />
                        Save
                        {pbid != null && (
                            <span className="ml-auto text-xs text-muted-foreground truncate max-w-32">
                                {board?.name || `board ${pbid}`}
                            </span>
                        )}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => save(true)}>
                        <SaveAll className="mr-2 h-4 w-4" />
                        Save as new copy
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={openLibrary}>
                        <LibraryBig className="mr-2 h-4 w-4" />
                        Library
                    </DropdownMenuItem>
                    {/* History and Rename need a saved board. Not
                        Radix-disabled: that would put pointer-events-none on
                        the rows and swallow the explanatory tooltip (same
                        trade the selection toolbar's menu makes) — they just
                        look disabled and ignore selects instead. */}
                    <DropdownMenuItem
                        title={pbid == null
                            ? "Save this pinboard in order to access save history"
                            : undefined}
                        className={cn(pbid == null && "opacity-50")}
                        onSelect={(e) => {
                            if (pbid == null) { e.preventDefault(); return }
                            openHistory()
                        }}
                    >
                        <History className="mr-2 h-4 w-4" />
                        History
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        title={pbid == null
                            ? "Save this pinboard in order to name it"
                            : undefined}
                        className={cn(pbid == null && "opacity-50")}
                        onSelect={(e) => {
                            if (pbid == null) { e.preventDefault(); return }
                            openRename()
                        }}
                    >
                        <PenLine className="mr-2 h-4 w-4" />
                        Rename
                    </DropdownMenuItem>
                    {boardApi && (
                        <BoardGlobalMenuItems
                            kit={dropdownMenuKit}
                            api={boardApi}
                            maximizeLabel="Maximize"
                        />
                    )}
                    <DropdownMenuSeparator />
                    {/* The destructive verb sits last, below everything.
                        It confirms first (see usePinboardDialogs), so a
                        stray click can't wipe the board. Explicit red text
                        tones, NOT text-destructive: the dark theme's
                        --destructive is a 30%-lightness button background
                        that reads as disabled grey when used as text. */}
                    <DropdownMenuItem
                        className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                        onClick={openClear}
                    >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Clear Board
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            {dialogs}
        </>
    )
}

// Auto-layout is the one board mode that changes what every future
// add/remove does, so its state is surfaced permanently on the Pinboard
// tab (and the fullscreen toolbar) instead of hiding inside menus: lit
// when on, muted when off, and itself the toggle. `disabled` comes from
// the HOST rendering the wand — each tab strip's pinboard tab knows its
// own active flag (ghp for the gallery, gpb for the grid), and reading
// either one here directly gates the wrong host's wand. Toggling on is a
// layout request needing the mounted board's API, so hosts disable the
// wand whenever their board isn't showing; the fullscreen toolbar never
// does, since the board is visible there by construction.
export function AutoLayoutToggle({
    className,
    iconClassName = "h-4 w-4",
    disabled = false,
}: {
    className?: string
    iconClassName?: string
    disabled?: boolean
}) {
    const [autoLayout, setAutoLayout] = useGalleryPinAutoLayout()
    const boardApi = usePinboardBoardApi(s => s.api)
    const { toast } = useToast()
    const toggle = () => {
        const next = !autoLayout
        setAutoLayout(next)
        // Toggling it on IS a layout request, same as the menu checkbox
        if (next && boardApi) {
            void Promise.resolve(boardApi.fillViewport(false)).then(err => {
                if (err) toast({ title: "Fill Viewport", description: err, duration: 4000 })
            })
        }
    }
    return (
        <button
            onClick={toggle}
            disabled={disabled}
            aria-pressed={autoLayout}
            aria-label="Toggle auto-layout"
            title={autoLayout
                ? "Auto-Layout is ON: the board re-packs pins to fill the viewport whenever pins are added or removed. Click to turn off."
                : "Auto-Layout is off: pins stay where you put them. Click to turn on and fill the viewport."}
            className={cn(
                "inline-flex shrink-0 items-center justify-center px-1.5 transition-colors hover:bg-foreground/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                autoLayout && TOGGLE_ON,
                className,
            )}
        >
            <WandSparkles className={iconClassName} />
        </button>
    )
}

// Toggled-on state for toolbar/tab toggles: the app's blue "active" chip
// (see the selection toolbar), in theme-aware form. A filled state is what
// separates an off toggle from a disabled button — off toggles keep the
// normal button look, disabled ones fade.
const TOGGLE_ON =
    "bg-blue-500/15 text-blue-600 hover:bg-blue-500/25 dark:text-blue-400"

// Icon button in the fullscreen toolbar's segment style. `active` renders
// the lit/muted state pair used by toggles; leave it undefined for plain
// action buttons.
function ToolbarButton({
    title,
    onClick,
    active,
    disabled,
    className,
    children,
}: {
    title: string
    onClick: () => void
    active?: boolean
    disabled?: boolean
    className?: string
    children: React.ReactNode
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            title={title}
            aria-label={title}
            aria-pressed={active}
            className={cn(
                "inline-flex shrink-0 items-center justify-center px-2.5 transition-colors hover:bg-foreground/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                active && TOGGLE_ON,
                className,
            )}
        >
            {children}
        </button>
    )
}

function ToolbarDivider() {
    return <div className="my-2 w-px self-stretch bg-border" />
}

// Maximized mode hides the whole gallery header, historically leaving
// right-click as the only way out and no way to save without leaving.
// This toolbar is the escape hatch: hovering anywhere on the board's top
// padding band (a thin full-width strip — present precisely because the
// grid's containerPadding keeps the first pin row below it) reveals a
// floating bar with every board-level action laid out flat — library
// verbs as icon buttons (their dialogs portal to the body and the
// history panel docks to the board area, so both work fine over a
// maximized board), the board toggles, the Layout verbs as the only
// dropdown, and an explicit restore button. A small always-visible
// handle at the top center advertises that something is up there, and
// the bar shows itself briefly when entering fullscreen.
export function PinboardFullscreenBar() {
    const setFs = useGalleryFullscreen()[1]
    const [showGrid, setShowGrid] = useGalleryPinGrid()
    const [autoLayout] = useGalleryPinAutoLayout()
    const [autoLayoutCrop, setAutoLayoutCrop] = useGalleryPinAutoCrop()
    const boardApi = usePinboardBoardApi(s => s.api)
    const { save, pbid, board, openLibrary, openHistory, openRename, dialogs } =
        usePinboardDialogs()
    const [hover, setHover] = useState(false)
    const [menuOpen, setMenuOpen] = useState(false)
    const [peek, setPeek] = useState(true)
    useEffect(() => {
        const t = setTimeout(() => setPeek(false), 2500)
        return () => clearTimeout(t)
    }, [])
    const show = hover || menuOpen || peek
    return (
        <>
            {/* The hot band: full width but only as tall as the board's own
                top padding, so it sits above the first pin row instead of
                over it */}
            <div
                className="fixed inset-x-0 top-0 z-50 h-4"
                onMouseEnter={() => setHover(true)}
                onMouseLeave={() => setHover(false)}
            />
            {/* The handle: a permanent hint that the toolbar lives up here,
                fading out while the bar itself is shown */}
            <div className="fixed top-0 left-1/2 z-50 -translate-x-1/2 pointer-events-none">
                <div
                    className={cn(
                        "flex h-4 w-28 items-center justify-center rounded-b-md border border-t-0 bg-muted text-muted-foreground shadow-sm transition-opacity duration-150",
                        show ? "opacity-0" : "opacity-100",
                    )}
                >
                    <ChevronDown className="h-3 w-3" />
                </div>
            </div>
            <div className="fixed top-1 left-1/2 z-50 -translate-x-1/2 pointer-events-none">
                <div
                    onMouseEnter={() => setHover(true)}
                    onMouseLeave={() => setHover(false)}
                    className={cn(
                        "flex h-11 items-stretch rounded-md border bg-background/95 shadow-md transition-all duration-150",
                        show ? "pointer-events-auto opacity-100 translate-y-0"
                            : "opacity-0 -translate-y-2",
                    )}
                >
                    <ToolbarButton
                        title={pbid != null
                            ? `Save — ${board?.name || `board ${pbid}`}`
                            : "Save as new pinboard"}
                        onClick={() => save(false)}
                        className="rounded-l-md"
                    >
                        <Save className="h-5 w-5" />
                    </ToolbarButton>
                    <ToolbarButton title="Save as new copy" onClick={() => save(true)}>
                        <SaveAll className="h-5 w-5" />
                    </ToolbarButton>
                    <ToolbarButton title="Library" onClick={openLibrary}>
                        <LibraryBig className="h-5 w-5" />
                    </ToolbarButton>
                    {/* History and Rename need a saved board; they stay put
                        (a stable bar beats appearing buttons) and the
                        disabled tooltip says what would enable them */}
                    <ToolbarButton
                        title={pbid != null
                            ? "History"
                            : "Save this pinboard in order to access save history"}
                        disabled={pbid == null}
                        onClick={openHistory}
                    >
                        <History className="h-5 w-5" />
                    </ToolbarButton>
                    <ToolbarButton
                        title={pbid != null
                            ? "Rename"
                            : "Save this pinboard in order to name it"}
                        disabled={pbid == null}
                        onClick={openRename}
                    >
                        <PenLine className="h-5 w-5" />
                    </ToolbarButton>
                    <ToolbarDivider />
                    {/* The mode toggles together: auto-layout, its dependent
                        auto-crop, then the grid overlay */}
                    <AutoLayoutToggle className="px-2.5" iconClassName="h-5 w-5" />
                    <ToolbarButton
                        title={autoLayout
                            ? "Auto-Crop to Cells: each auto relayout also fits every item to its cell"
                            : "Auto-Crop to Cells (requires Auto-Layout)"}
                        active={autoLayoutCrop}
                        disabled={!autoLayout}
                        onClick={() => {
                            const next = !autoLayoutCrop
                            setAutoLayoutCrop(next)
                            // Same as the menu checkbox: enabling applies
                            // crops-only immediately
                            if (next && boardApi) void boardApi.autoCropToCells(false)
                        }}
                    >
                        <Crop className="h-5 w-5" />
                    </ToolbarButton>
                    <ToolbarButton
                        title={showGrid ? "Hide Grid" : "Show Grid"}
                        active={showGrid}
                        onClick={() => setShowGrid(!showGrid)}
                    >
                        <Grid3x3 className="h-5 w-5" />
                    </ToolbarButton>
                    {boardApi?.isV1 && (
                        <ToolbarButton title="Upgrade Board Grid" onClick={() => boardApi.upgradeGrid()}>
                            <Grid2x2Plus className="h-5 w-5" />
                        </ToolbarButton>
                    )}
                    {boardApi && (
                        <DropdownMenu onOpenChange={setMenuOpen}>
                            {/* Lit while its menu is open (Radix stamps
                                data-state on the trigger), like the
                                selection toolbar's menus */}
                            <DropdownMenuTrigger asChild>
                                <button
                                    className={cn(
                                        "inline-flex shrink-0 items-center gap-1 px-2.5 text-sm transition-colors hover:bg-foreground/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                                        "data-[state=open]:bg-blue-500/15 data-[state=open]:text-blue-600 dark:data-[state=open]:text-blue-400",
                                    )}
                                >
                                    Layout
                                    <ChevronDown className="h-4 w-4" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-56">
                                <LayoutMenuItems kit={dropdownMenuKit} api={boardApi} />
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                    <ToolbarDivider />
                    <ToolbarButton
                        title="Restore pinboard size (Ctrl+Shift+M)"
                        onClick={() => setFs(false)}
                        className="rounded-r-md"
                    >
                        <Minimize2 className="h-5 w-5" />
                    </ToolbarButton>
                </div>
            </div>
            {dialogs}
        </>
    )
}
