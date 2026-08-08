'use client'

import React, { useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import {
    Database,
    Expand,
    ExternalLink,
    LibraryBig,
    Pencil,
    Pin,
    Trash2,
    X,
} from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { $api, fetchClient } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { usePinboardActions } from "@/lib/pinboardSave"
import { pinboardPreviewURL } from "@/lib/pinboardPreview"
import { useToast } from "@/components/ui/use-toast"
import { keepPreviousData, useQueryClient } from "@tanstack/react-query"
import {
    owningDatabase,
    pinboardOpenHref,
    useIndexDatabaseNames,
} from "@/lib/pinboardLinks"
import {
    PinboardLibraryOrder,
    usePinboardAssociatedOnly,
    usePinboardCleanLinks,
    usePinboardLibraryOrder,
} from "@/lib/state/pinboardLibraryPrefs"
import { PinboardDatabasesDialog } from "./PinboardDatabasesDialog"
import { DESTRUCTIVE_MENU_ITEM } from "./PinboardGlobalMenu"
import { cn, compactDate, dateTitle, getLocale } from "@/lib/utils"
import {
    PreviewPopover,
    useDelayedHover,
    verticalPopoverBox,
} from "./PinboardPreviewPopover"
import { components } from "@/lib/panoptikon"

type PinboardSummary = components["schemas"]["PinboardSummaryResponse"]

// The default card preview request width — right for the in-modal library
// grid, where cards are small. Hosts whose cards render much larger (the
// grid view's Library tab, full width across the whole panel) pass their
// own via PinboardCard's `previewWidth`, since stretching a 320px JPEG is
// what made those look soft.
const CARD_PREVIEW_WIDTH = 320
// All cards share one aspect ratio so the grid stays aligned regardless of
// each board's save-time window shape; previews crop/pan inside it.
const CARD_ASPECT = 4 / 3

export function PinboardLibraryDialog({
    open,
    onOpenChange,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const dbs = useSelectedDBs()[0]
    const { loadBoard } = usePinboardActions()
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const [nameQuery, setNameQuery] = useState("")
    const [order, setOrder] = usePinboardLibraryOrder()
    const [cleanLinks, setCleanLinks] = usePinboardCleanLinks()
    const [associatedOnly, setAssociatedOnly] = usePinboardAssociatedOnly()
    // Gated on `open` like the board list: this dialog stays mounted.
    const { localNames, currentName } = useIndexDatabaseNames(open)
    const searchInputRef = useRef<HTMLInputElement>(null)
    // Hovered card + its rect, captured when the pointer enters the card's
    // preview icon (a short delay so grazing it doesn't flash the popover).
    // The rect goes stale if the grid scrolls under the pointer, so
    // scrolling clears the hover.
    const [hovered, setHovered] = useDelayedHover<{
        board: PinboardSummary
        anchor: DOMRect
    }>(100)
    // Board awaiting delete confirmation / being renamed (dialog state)
    const [confirmDelete, setConfirmDelete] = useState<PinboardSummary | null>(null)
    const [renameTarget, setRenameTarget] = useState<PinboardSummary | null>(null)
    const [renameValue, setRenameValue] = useState("")
    // Board whose full-size preview is open in the stacked preview modal
    const [previewBoard, setPreviewBoard] = useState<PinboardSummary | null>(null)
    // Board whose database associations are being edited
    const [dbBoard, setDbBoard] = useState<PinboardSummary | null>(null)

    const { data } = $api.useQuery(
        "get",
        "/api/pinboards",
        {
            params: {
                query: {
                    ...dbs,
                    q: nameQuery.trim() === "" ? undefined : nameQuery,
                    order,
                    // Part of the query key, so flipping the checkbox refetches
                    // rather than re-rendering a list the server already
                    // filtered under the other setting.
                    associated_only: associatedOnly,
                },
            },
        },
        // keepPreviousData: while a keystroke's refetch is in flight, keep
        // showing the previous results instead of flashing the empty state
        { enabled: open, placeholderData: keepPreviousData }
    )
    const boards = data?.pinboards ?? []
    // True first-run state: the query resolved and the user has no boards
    // at all (as opposed to a name search matching none). Gated on `data`
    // so the initial fetch shows neither state instead of flashing the
    // onboarding panel at users whose boards are still loading.
    const emptyLibrary =
        data != null && boards.length === 0 && nameQuery.trim() === ""
    // …except that with the association filter on, "no boards" may equally
    // mean "boards, but all of them belong to other databases". The two are
    // indistinguishable from this response, so the empty panel says both and
    // the controls row stays mounted — otherwise the checkbox that would
    // reveal them disappears along with the cards.
    const filteredEmpty = emptyLibrary && associatedOnly

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ["get", "/api/pinboards"] })
        // The grid's Library tab searches the same boards; a rename or delete
        // here must reach it too.
        queryClient.invalidateQueries({
            queryKey: ["post", "/api/pinboards/search"],
        })
    }

    const openBoard = async (board: PinboardSummary) => {
        const { data: detail } = await fetchClient.GET(
            "/api/pinboards/{pinboard_id}",
            { params: { path: { pinboard_id: board.id }, query: { ...dbs } } }
        )
        if (!detail?.head) {
            toast({ title: "Error", description: "Board has no saved version" })
            return
        }
        loadBoard(board.id, detail.head.layout, detail.flags)
        onOpenChange(false)
    }

    const deleteBoard = async (board: PinboardSummary) => {
        await fetchClient.DELETE("/api/pinboards/{pinboard_id}", {
            params: { path: { pinboard_id: board.id }, query: { ...dbs } },
        })
        invalidate()
        toast({ title: "Deleted pinboard", duration: 2000 })
    }

    const openRename = (board: PinboardSummary) => {
        setRenameValue(board.name ?? "")
        setRenameTarget(board)
    }
    const submitRename = async () => {
        const board = renameTarget
        setRenameTarget(null)
        if (!board) return
        const trimmed = renameValue.trim()
        await fetchClient.PATCH("/api/pinboards/{pinboard_id}", {
            params: { path: { pinboard_id: board.id }, query: { ...dbs } },
            body: { name: trimmed === "" ? null : trimmed, relabel_head: false },
        })
        invalidate()
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Saved pinboards</DialogTitle>
                    <DialogDescription>
                        Click a board to open it — or middle-click to open it in a new
                        tab. Hover a card&apos;s corner icon to preview its latest save.
                    </DialogDescription>
                </DialogHeader>
                {/* A search box over an empty library reads as a broken
                    results page, so the first-run state hides it and takes
                    over the whole body below */}
                {!emptyLibrary && (
                    <div className="flex items-center justify-between gap-3">
                        <div className="relative w-full max-w-xs">
                            <Input
                                ref={searchInputRef}
                                value={nameQuery}
                                onChange={(e) => setNameQuery(e.target.value)}
                                placeholder="Search by name"
                                className="pr-8"
                            />
                            {nameQuery !== "" && (
                                <button
                                    type="button"
                                    title="Clear search"
                                    onClick={() => {
                                        setNameQuery("")
                                        searchInputRef.current?.focus()
                                    }}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            )}
                        </div>
                        <SortToggle order={order} onChange={setOrder} />
                    </div>
                )}
                {/* Fixed height: result-count changes while searching must
                    not resize the dialog. Empty states render outside the
                    ScrollArea (Radix's table-display viewport defeats h-full
                    centering) in a same-height plain div. */}
                {boards.length > 0 ? (
                    <ScrollArea
                        className="h-[65vh]"
                        onScrollCapture={() => setHovered(null)}
                    >
                        <div className="grid grid-cols-2 md:grid-cols-3 items-start gap-3 p-1">
                            {boards.map((board) => {
                                const owner = owningDatabase(
                                    board,
                                    localNames,
                                    currentName
                                )
                                return (
                                <PinboardCard
                                    key={board.id}
                                    board={board}
                                    dbs={dbs}
                                    owningDb={owner}
                                    href={pinboardOpenHref(
                                        pathname,
                                        searchParams,
                                        board.id,
                                        "head",
                                        cleanLinks ? "clean" : "carry",
                                        owner
                                    )}
                                    onOpen={() => openBoard(board)}
                                    onDelete={() => setConfirmDelete(board)}
                                    onRename={() => openRename(board)}
                                    onEditDatabases={() => setDbBoard(board)}
                                    onPreview={() => {
                                        setHovered(null)
                                        setPreviewBoard(board)
                                    }}
                                    onHover={(b, anchor) =>
                                        setHovered(b && anchor ? { board: b, anchor } : null)
                                    }
                                />
                                )
                            })}
                        </div>
                    </ScrollArea>
                ) : (
                    <div className="flex h-[65vh] items-center justify-center p-8">
                        {filteredEmpty ? (
                            <div className="flex max-w-sm flex-col items-center gap-3 text-center">
                                <Pin className="h-10 w-10 text-muted-foreground/60" />
                                <p className="font-medium">
                                    No pinboards from this database
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    Boards belonging to other databases are hidden —
                                    uncheck &ldquo;Only boards from this
                                    database&rdquo; below to see them. If you have no
                                    boards at all yet, pin items from your search
                                    results and save the board from the Pinboard
                                    tab&apos;s menu.
                                </p>
                            </div>
                        ) : emptyLibrary ? (
                            // First run: this dialog is reachable before any
                            // board exists (the grid header's library button),
                            // so it explains the creation path instead of
                            // showing a search UI with nothing to search
                            <div className="flex max-w-sm flex-col items-center gap-3 text-center">
                                <Pin className="h-10 w-10 text-muted-foreground/60" />
                                <p className="font-medium">No saved pinboards yet</p>
                                <p className="text-sm text-muted-foreground">
                                    Pin items from your search results to start a
                                    board — a Pinboard tab will appear next to the
                                    results. Save the board from that tab&apos;s menu
                                    and it will show up here.
                                </p>
                            </div>
                        ) : data != null ? (
                            <p className="text-sm text-muted-foreground">
                                No pinboards match
                            </p>
                        ) : null}
                    </div>
                )}
                {(!emptyLibrary || filteredEmpty) && (
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="pinboard-associated-only"
                                checked={associatedOnly}
                                onCheckedChange={(next) =>
                                    setAssociatedOnly(next === true)
                                }
                            />
                            <label
                                htmlFor="pinboard-associated-only"
                                title="Hide boards that belong to a different index database — the ones whose images this database doesn't have, which would otherwise open as a wall of broken pictures. The same setting applies to the grid's Library tab and the sidebar's pinboard picker."
                                className="cursor-pointer select-none text-xs text-muted-foreground"
                            >
                                Only boards from this database
                            </label>
                        </div>
                        {!emptyLibrary && (
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="pinboard-clean-links"
                                    checked={cleanLinks}
                                    onCheckedChange={(next) => setCleanLinks(next === true)}
                                />
                                <label
                                    htmlFor="pinboard-clean-links"
                                    title="Boards opened in a new tab (middle-click, Ctrl-click) start maximized with nothing else open. When off, new tabs inherit your current view settings instead (never the sidebar or search)."
                                    className="cursor-pointer select-none text-xs text-muted-foreground"
                                >
                                    Open maximized in new tabs
                                </label>
                            </div>
                        )}
                    </div>
                )}
                {hovered && hovered.board.head_version_id != null && (
                    <PreviewPopover
                        src={pinboardPreviewURL(
                            dbs,
                            hovered.board.id,
                            hovered.board.head_version_id
                        )}
                        box={verticalPopoverBox(
                            hovered.anchor,
                            hovered.board.preview_w ?? 1,
                            hovered.board.preview_h ?? 1
                        )}
                    />
                )}
                <ConfirmDialog
                    open={confirmDelete != null}
                    title="Delete pinboard?"
                    description={
                        confirmDelete
                            ? `Delete pinboard "${confirmDelete.name || `saved ${getLocale(new Date(confirmDelete.time_updated))}`}" and its entire history.`
                            : undefined
                    }
                    confirmLabel="Delete"
                    onConfirm={() => {
                        if (confirmDelete) void deleteBoard(confirmDelete)
                        setConfirmDelete(null)
                    }}
                    onCancel={() => setConfirmDelete(null)}
                />
                <PinboardPreviewDialog
                    board={previewBoard}
                    dbs={dbs}
                    onClose={() => setPreviewBoard(null)}
                />
                {/* Stacked over the library like the preview and rename
                    dialogs. Its save can move a board out of (or into) the
                    filtered list, so it invalidates rather than patches. */}
                <PinboardDatabasesDialog
                    board={dbBoard}
                    dbs={dbs}
                    onClose={() => setDbBoard(null)}
                    onSaved={invalidate}
                />
                <Dialog
                    open={renameTarget != null}
                    onOpenChange={(next) => {
                        if (!next) setRenameTarget(null)
                    }}
                >
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
                            <Button variant="ghost" onClick={() => setRenameTarget(null)}>
                                Cancel
                            </Button>
                            <Button onClick={submitRename}>Rename</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </DialogContent>
        </Dialog>
    )
}

// The stacked full-size preview modal a card's corner icon opens. Shared by
// every host that renders PinboardCard (the library dialog, the grid's
// Library tab) — `board` null means closed.
export function PinboardPreviewDialog({
    board,
    dbs,
    onClose,
}: {
    board: PinboardSummary | null
    dbs: { index_db: string | null; user_data_db: string | null }
    onClose: () => void
}) {
    return (
        <Dialog
            open={board != null}
            onOpenChange={(next) => {
                if (!next) onClose()
            }}
        >
            <DialogContent className="w-fit max-w-[92vw] p-3 gap-2">
                <DialogTitle className="pr-8 text-sm font-medium leading-normal truncate">
                    {board?.name || (
                        <span className="italic text-muted-foreground">Untitled</span>
                    )}
                    {board && (
                        <span className="ml-2 font-normal text-xs text-muted-foreground">
                            {board.item_count}{" "}
                            {board.item_count === 1 ? "item" : "items"} ·{" "}
                            {getLocale(new Date(board.time_updated))}
                        </span>
                    )}
                </DialogTitle>
                {board?.head_version_id != null && (
                    <img
                        src={pinboardPreviewURL(
                            dbs,
                            board.id,
                            board.head_version_id
                        )}
                        alt={board.name || "Pinboard preview"}
                        className="max-h-[80vh] max-w-full w-auto h-auto rounded border"
                        draggable={false}
                    />
                )}
            </DialogContent>
        </Dialog>
    )
}

// A two-option segmented control rather than a Select: with two choices the
// unselected one is its own label for what the other ordering is.
function SortToggle({
    order,
    onChange,
}: {
    order: PinboardLibraryOrder
    onChange: (order: PinboardLibraryOrder) => void
}) {
    const option = (value: PinboardLibraryOrder, label: string, title: string) => (
        <button
            type="button"
            title={title}
            onClick={() => onChange(value)}
            className={cn(
                "rounded-sm px-2 py-1 text-xs",
                order === value
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
            )}
        >
            {label}
        </button>
    )
    return (
        <div className="flex shrink-0 items-center gap-0.5 rounded-md border bg-muted/50 p-0.5">
            {option(
                "activity",
                "Activity",
                "Boards you keep coming back to first — opening a board counts, not just saving it"
            )}
            {option("updated", "Last saved", "Most recently saved first")}
        </div>
    )
}

// The grid header's always-visible library entry point: the one path to
// saved boards that doesn't require a board to already be open (every
// other trigger lives on the Pinboard tab or the fullscreen bar, which
// only exist once something is pinned). Always visible rather than
// hidden-while-a-board-is-open: a stable anchor teaches where boards
// live, and with a board open it doubles as the board switcher.
export function PinboardLibraryButton() {
    const [open, setOpen] = useState(false)
    return (
        <>
            <Button
                variant="ghost"
                size="icon"
                title="Pinboard library"
                aria-label="Pinboard library"
                onClick={() => setOpen(true)}
            >
                <LibraryBig className="h-5 w-5" />
            </Button>
            <PinboardLibraryDialog open={open} onOpenChange={setOpen} />
        </>
    )
}

// A library card: a fixed-aspect viewport onto the board preview so every
// card in the grid is the same size. Previews taller than the viewport are
// top-aligned and pan on wheel (fade + slim scrollbar signal the overflow);
// shorter ones are centered. The card is a real link — plain click loads
// the board in place, middle/ctrl-click opens it in a new tab — and the
// full-size hover popover is triggered from the corner icon only.
export function PinboardCard({
    board,
    dbs,
    href,
    owningDb,
    matchCount,
    previewWidth = CARD_PREVIEW_WIDTH,
    onOpen,
    onDelete,
    onRename,
    onEditDatabases,
    onPreview,
    onHover,
}: {
    board: PinboardSummary
    dbs: { index_db: string | null; user_data_db: string | null }
    href: string
    /**
     * The other local index database this board belongs to (see
     * `owningDatabase`), or null when it belongs here. Only labels the card —
     * the switch itself is in `href`, so it survives middle-click.
     */
    owningDb?: string | null
    /** How many of the board's items a search matched; absent = no badge. */
    matchCount?: number
    /**
     * Pixel width to request the preview at (the endpoint's `maxw`). Purely
     * a resolution knob — the card's rendered size is the grid's business —
     * so hosts with bigger cards raise it rather than upscaling the default.
     */
    previewWidth?: number
    onOpen: () => void
    /** Omitted where the host offers no rename/delete (the Library tab). */
    onDelete?: () => void
    onRename?: () => void
    /** Opens the association editor; omitted where the host offers none. */
    onEditDatabases?: () => void
    onPreview: () => void
    onHover: (board: PinboardSummary | null, anchor?: DOMRect) => void
}) {
    const [pan, setPan] = useState(0)
    const viewportRef = useRef<HTMLDivElement>(null)
    const cardRef = useRef<HTMLAnchorElement>(null)

    // All geometry in preview-image pixels: the image is previewW wide and
    // the viewport is a CARD_ASPECT window onto it, panned by `pan`.
    //
    // These numbers come from the board summary, the <img> from the browser
    // cache, and version previews are served immutable — so right after a
    // "Refresh Preview" that changed the recorded dimensions (a different
    // board width, a new master resolution), an already-cached image is
    // framed by the NEW pair: not merely stale, visibly misframed, until a
    // hard refresh evicts it. The refresh toast says so; deliberately no
    // cache-busting machinery for a one-time local operation.
    const previewW = board.preview_w ?? 1
    const previewH = board.preview_h ?? 1
    const viewportH = previewW / CARD_ASPECT
    const maxPan = Math.max(0, previewH - viewportH)
    const canPan = maxPan > 0
    // Previews shorter than the viewport sit vertically centered
    const restTop = canPan ? 0 : (viewportH - previewH) / 2

    const onWheel = (e: React.WheelEvent) => {
        if (!canPan) return
        e.preventDefault()
        e.stopPropagation()
        // Wheel deltas are viewport px; convert to preview px via the scale
        const width = viewportRef.current?.clientWidth || CARD_PREVIEW_WIDTH
        const scale = previewW / width
        setPan((prev) => Math.min(maxPan, Math.max(0, prev + e.deltaY * scale)))
    }

    const name = board.name || "Untitled"
    const updated = new Date(board.time_updated)
    const versionId = board.head_version_id
    // Rot: items this board pins that the selected database doesn't have.
    // Only worth saying for a board that belongs here — on a foreign board a
    // low count is the whole point, and the owner badge already says so.
    const rot = board.associated && board.present_count < board.item_count

    const card = (
        <a
            ref={cardRef}
            href={href}
            draggable={false}
            className="group/card flex flex-col border rounded-md overflow-hidden bg-muted/30 cursor-pointer"
            onClick={(e) => {
                // Modified clicks keep the browser's link behavior (new tab)
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
                // A board belonging to another database is opened by FOLLOWING
                // the link, which carries the index_db switch: loading it in
                // place would keep the current database selected and render
                // the board as a wall of broken images — the exact failure
                // this feature exists to stop. The switch stays explicit in
                // the URL, so Back undoes it.
                if (owningDb) return
                e.preventDefault()
                onOpen()
            }}
        >
            <div
                ref={viewportRef}
                className="relative w-full overflow-hidden"
                style={{ aspectRatio: `${CARD_ASPECT}` }}
                onWheel={onWheel}
            >
                {versionId != null ? (
                    <img
                        src={pinboardPreviewURL(dbs, board.id, versionId, previewWidth)}
                        alt={name}
                        className="absolute left-0 w-full"
                        style={{ top: `${((restTop - pan) / viewportH) * 100}%` }}
                        draggable={false}
                    />
                ) : (
                    <div className="absolute inset-0 bg-muted" />
                )}
                {canPan && pan < maxPan && (
                    <div className="absolute bottom-0 left-0 right-0 h-8 bg-linear-to-t from-background/80 to-transparent pointer-events-none" />
                )}
                {canPan && (
                    <div className="absolute right-0.5 top-1 bottom-1 w-1 rounded bg-foreground/10">
                        <div
                            className="absolute w-1 rounded bg-foreground/40"
                            style={{
                                height: `${Math.min(100, (viewportH / previewH) * 100)}%`,
                                top: `${(pan / previewH) * 100}%`,
                            }}
                        />
                    </div>
                )}
                {/* Match badge: how much of the board the search hit. Sits on
                    the preview rather than in the footer so the card's own
                    metadata line is untouched (and identical in the library
                    dialog, which passes no matchCount). */}
                {matchCount !== undefined && (
                    <span
                        title={`${matchCount} of ${board.item_count} items match`}
                        className="absolute left-2 top-1.5 rounded border bg-background/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums"
                    >
                        {matchCount === board.item_count
                            ? matchCount
                            : `${matchCount} / ${board.item_count}`}
                    </span>
                )}
                {/* Owner badge: this board belongs to another database, and
                    its link switches to it. Bottom-left so it never collides
                    with the match badge above, and muted — it is a label for
                    a board you are still allowed to open, not a warning. */}
                {owningDb && (
                    <span
                        title={`This pinboard belongs to the “${owningDb}” database. Opening it switches to that database.`}
                        className="absolute bottom-1.5 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded border bg-background/80 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                    >
                        <Database className="h-3 w-3 shrink-0" />
                        <span className="truncate">{owningDb}</span>
                    </span>
                )}
                {versionId != null && (
                    <button
                        type="button"
                        title="Preview full size"
                        className="absolute right-2.5 top-1.5 hidden group-hover/card:flex items-center justify-center h-6 w-6 rounded border bg-background/80 text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            // The hover popover would z-stack above the modal
                            onHover(null)
                            onPreview()
                        }}
                        onMouseEnter={() => {
                            const anchor = cardRef.current?.getBoundingClientRect()
                            if (anchor) onHover(board, anchor)
                        }}
                        onMouseLeave={() => onHover(null)}
                    >
                        <Expand className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                <span
                    className={cn(
                        "truncate",
                        board.name
                            ? "font-medium"
                            : // pr keeps the last italic glyph's overhang inside
                              // the truncate clip box
                              "italic text-muted-foreground pr-0.5"
                    )}
                    title={name}
                >
                    {name}
                </span>
                <span className="flex items-center gap-1.5 shrink-0 text-muted-foreground">
                    {/* "38/40 here" replaces the plain item count when some
                        of the board's items are missing from this database —
                        files move, die or get re-encoded, and a board that
                        has rotted looks broken without a word for it. */}
                    <span
                        title={rot
                            ? `${board.present_count} of this board's ${board.item_count} items are in this database; the rest are missing. Saved ${dateTitle(updated)}`
                            : dateTitle(updated)}
                    >
                        {rot ? (
                            <span className="tabular-nums">
                                {board.present_count}/{board.item_count} here
                            </span>
                        ) : (
                            <>
                                {board.item_count}{" "}
                                {board.item_count === 1 ? "item" : "items"}
                            </>
                        )}
                        {" · "}
                        {compactDate(updated)}
                    </span>
                    {(onRename || onDelete) && (
                        <span className="hidden group-hover/card:flex items-center gap-1">
                            {onRename && (
                                <button
                                    title="Rename"
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRename() }}
                                    className="hover:text-foreground"
                                >
                                    <Pencil className="h-3.5 w-3.5" />
                                </button>
                            )}
                            {onDelete && (
                                <button
                                    title="Delete"
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete() }}
                                    className="hover:text-destructive"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </span>
                    )}
                </span>
            </div>
        </a>
    )

    // Right-click is the browser's own "open in new tab" menu, and this card
    // is a real link precisely so that works — so it is only taken over where
    // there is something to put there, and the item it displaced comes back as
    // the first entry. Hosts offering no card verbs (the grid's Library tab)
    // keep the native menu untouched.
    if (!onRename && !onDelete && !onEditDatabases) return card
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
            <ContextMenuContent className="w-52">
                <ContextMenuItem
                    onClick={() => window.open(href, "_blank", "noopener")}
                >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open in New Tab
                </ContextMenuItem>
                {onEditDatabases && (
                    <ContextMenuItem onClick={onEditDatabases}>
                        <Database className="mr-2 h-4 w-4" />
                        Databases…
                    </ContextMenuItem>
                )}
                {(onRename || onDelete) && <ContextMenuSeparator />}
                {onRename && (
                    <ContextMenuItem onClick={onRename}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Rename
                    </ContextMenuItem>
                )}
                {onDelete && (
                    <ContextMenuItem
                        className={DESTRUCTIVE_MENU_ITEM}
                        onClick={onDelete}
                    >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                    </ContextMenuItem>
                )}
            </ContextMenuContent>
        </ContextMenu>
    )
}

