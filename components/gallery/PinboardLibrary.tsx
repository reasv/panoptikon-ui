'use client'

import React, { useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Expand, Pencil, Trash2, X } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { $api, fetchClient } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { usePinboardActions } from "@/lib/pinboardSave"
import { pinboardPreviewURL } from "@/lib/pinboardPreview"
import { useToast } from "@/components/ui/use-toast"
import { keepPreviousData, useQueryClient } from "@tanstack/react-query"
import { pinboardOpenHref } from "@/lib/pinboardLinks"
import { cn, compactDate, dateTitle, getLocale } from "@/lib/utils"
import {
    PreviewPopover,
    PREVIEW_POPOVER_WIDTH,
    useDelayedHover,
    verticalPopoverBox,
} from "./PinboardPreviewPopover"
import { components } from "@/lib/panoptikon"

type PinboardSummary = components["schemas"]["PinboardSummaryResponse"]

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

    const { data } = $api.useQuery(
        "get",
        "/api/pinboards",
        {
            params: {
                query: { ...dbs, q: nameQuery.trim() === "" ? undefined : nameQuery },
            },
        },
        // keepPreviousData: while a keystroke's refetch is in flight, keep
        // showing the previous results instead of flashing the empty state
        { enabled: open, placeholderData: keepPreviousData }
    )
    const boards = data?.pinboards ?? []

    const invalidate = () =>
        queryClient.invalidateQueries({ queryKey: ["get", "/api/pinboards"] })

    const openBoard = async (board: PinboardSummary) => {
        const { data: detail } = await fetchClient.GET(
            "/api/pinboards/{pinboard_id}",
            { params: { path: { pinboard_id: board.id }, query: { ...dbs } } }
        )
        if (!detail?.head) {
            toast({ title: "Error", description: "Board has no saved version" })
            return
        }
        loadBoard(board.id, detail.head.layout)
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
                <div className="relative max-w-xs">
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
                {/* Fixed height: result-count changes while searching must
                    not resize the dialog */}
                <ScrollArea
                    className="h-[65vh]"
                    onScrollCapture={() => setHovered(null)}
                >
                    {boards.length === 0 ? (
                        <p className="text-sm text-muted-foreground p-8 text-center">
                            {nameQuery ? "No pinboards match" : "No saved pinboards yet — Save a board from the Pinboard tab menu"}
                        </p>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 items-start gap-3 p-1">
                            {boards.map((board) => (
                                <PinboardCard
                                    key={board.id}
                                    board={board}
                                    dbs={dbs}
                                    href={pinboardOpenHref(pathname, searchParams, board.id, "head")}
                                    onOpen={() => openBoard(board)}
                                    onDelete={() => setConfirmDelete(board)}
                                    onRename={() => openRename(board)}
                                    onPreview={() => {
                                        setHovered(null)
                                        setPreviewBoard(board)
                                    }}
                                    onHover={(b, anchor) =>
                                        setHovered(b && anchor ? { board: b, anchor } : null)
                                    }
                                />
                            ))}
                        </div>
                    )}
                </ScrollArea>
                {hovered && hovered.board.head_version_id != null && (
                    <PreviewPopover
                        src={pinboardPreviewURL(
                            dbs,
                            hovered.board.id,
                            hovered.board.head_version_id,
                            PREVIEW_POPOVER_WIDTH
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
                <Dialog
                    open={previewBoard != null}
                    onOpenChange={(next) => {
                        if (!next) setPreviewBoard(null)
                    }}
                >
                    <DialogContent className="w-fit max-w-[92vw] p-3 gap-2">
                        <DialogTitle className="pr-8 text-sm font-medium leading-normal truncate">
                            {previewBoard?.name || (
                                <span className="italic text-muted-foreground">Untitled</span>
                            )}
                            {previewBoard && (
                                <span className="ml-2 font-normal text-xs text-muted-foreground">
                                    {previewBoard.item_count}{" "}
                                    {previewBoard.item_count === 1 ? "item" : "items"} ·{" "}
                                    {getLocale(new Date(previewBoard.time_updated))}
                                </span>
                            )}
                        </DialogTitle>
                        {previewBoard?.head_version_id != null && (
                            <img
                                src={pinboardPreviewURL(
                                    dbs,
                                    previewBoard.id,
                                    previewBoard.head_version_id,
                                    PREVIEW_POPOVER_WIDTH
                                )}
                                alt={previewBoard.name || "Pinboard preview"}
                                className="max-h-[80vh] max-w-full w-auto h-auto rounded border"
                                draggable={false}
                            />
                        )}
                    </DialogContent>
                </Dialog>
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
    onOpen,
    onDelete,
    onRename,
    onPreview,
    onHover,
}: {
    board: PinboardSummary
    dbs: { index_db: string | null; user_data_db: string | null }
    href: string
    onOpen: () => void
    onDelete: () => void
    onRename: () => void
    onPreview: () => void
    onHover: (board: PinboardSummary | null, anchor?: DOMRect) => void
}) {
    const [pan, setPan] = useState(0)
    const viewportRef = useRef<HTMLDivElement>(null)
    const cardRef = useRef<HTMLAnchorElement>(null)

    // All geometry in preview-image pixels: the image is previewW wide and
    // the viewport is a CARD_ASPECT window onto it, panned by `pan`.
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

    return (
        <a
            ref={cardRef}
            href={href}
            draggable={false}
            className="group/card flex flex-col border rounded-md overflow-hidden bg-muted/30 cursor-pointer"
            onClick={(e) => {
                // Modified clicks keep the browser's link behavior (new tab)
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
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
                        src={pinboardPreviewURL(dbs, board.id, versionId, CARD_PREVIEW_WIDTH)}
                        alt={name}
                        className="absolute left-0 w-full"
                        style={{ top: `${((restTop - pan) / viewportH) * 100}%` }}
                        draggable={false}
                    />
                ) : (
                    <div className="absolute inset-0 bg-muted" />
                )}
                {canPan && pan < maxPan && (
                    <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background/80 to-transparent pointer-events-none" />
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
                    <span title={dateTitle(updated)}>
                        {board.item_count} {board.item_count === 1 ? "item" : "items"} ·{" "}
                        {compactDate(updated)}
                    </span>
                    <span className="hidden group-hover/card:flex items-center gap-1">
                        <button
                            title="Rename"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRename() }}
                            className="hover:text-foreground"
                        >
                            <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                            title="Delete"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete() }}
                            className="hover:text-destructive"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </span>
                </span>
            </div>
        </a>
    )
}

