'use client'

import React, { useMemo, useRef, useState } from "react"
import { Pencil, Trash2 } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { $api, fetchClient } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { usePinboardActions } from "@/lib/pinboardSave"
import { pinboardPreviewURL } from "@/lib/pinboardPreview"
import { useToast } from "@/components/ui/use-toast"
import { useQueryClient } from "@tanstack/react-query"
import { getLocale } from "@/lib/utils"
import { components } from "@/lib/panoptikon"

type PinboardSummary = components["schemas"]["PinboardSummaryResponse"]

const CARD_PREVIEW_WIDTH = 320
const POPOVER_PREVIEW_WIDTH = 1024

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
    const [nameQuery, setNameQuery] = useState("")
    const [hovered, setHovered] = useState<PinboardSummary | null>(null)

    const { data } = $api.useQuery(
        "get",
        "/api/pinboards",
        {
            params: {
                query: { ...dbs, q: nameQuery.trim() === "" ? undefined : nameQuery },
            },
        },
        { enabled: open }
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
        const label = board.name || `saved ${getLocale(new Date(board.time_updated))}`
        if (!window.confirm(`Delete pinboard "${label}" and its entire history?`)) {
            return
        }
        await fetchClient.DELETE("/api/pinboards/{pinboard_id}", {
            params: { path: { pinboard_id: board.id }, query: { ...dbs } },
        })
        invalidate()
        toast({ title: "Deleted pinboard", duration: 2000 })
    }

    const renameBoard = async (board: PinboardSummary) => {
        const name = window.prompt("Pinboard name", board.name ?? "")
        if (name === null) return
        await fetchClient.PATCH("/api/pinboards/{pinboard_id}", {
            params: { path: { pinboard_id: board.id }, query: { ...dbs } },
            body: { name: name.trim() === "" ? null : name.trim(), relabel_head: false },
        })
        invalidate()
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Saved pinboards</DialogTitle>
                    <DialogDescription>
                        Click a board to open it. Previews show each board's latest save.
                    </DialogDescription>
                </DialogHeader>
                <Input
                    value={nameQuery}
                    onChange={(e) => setNameQuery(e.target.value)}
                    placeholder="Search by name"
                    className="max-w-xs"
                />
                <ScrollArea className="max-h-[65vh]">
                    {boards.length === 0 ? (
                        <p className="text-sm text-muted-foreground p-8 text-center">
                            {nameQuery ? "No pinboards match" : "No saved pinboards yet — Save a board from the Pinboard tab menu"}
                        </p>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-1">
                            {boards.map((board) => (
                                <PinboardCard
                                    key={board.id}
                                    board={board}
                                    dbs={dbs}
                                    onOpen={() => openBoard(board)}
                                    onDelete={() => deleteBoard(board)}
                                    onRename={() => renameBoard(board)}
                                    onHover={setHovered}
                                />
                            ))}
                        </div>
                    )}
                </ScrollArea>
                {hovered && hovered.head_version_id != null && (
                    <HoverPreview board={hovered} dbs={dbs} />
                )}
            </DialogContent>
        </Dialog>
    )
}

// A library card: uniform-height, cropped to the board's first save-time
// screenful. Taller previews pan on wheel, with a fade and a slim scrollbar
// signalling there's more below the crop line.
export function PinboardCard({
    board,
    dbs,
    onOpen,
    onDelete,
    onRename,
    onHover,
}: {
    board: PinboardSummary
    dbs: { index_db: string | null; user_data_db: string | null }
    onOpen: () => void
    onDelete: () => void
    onRename: () => void
    onHover: (board: PinboardSummary | null) => void
}) {
    const [pan, setPan] = useState(0)
    const viewportRef = useRef<HTMLDivElement>(null)

    // The card viewport shows preview pixels [pan, pan + screenful_h); the
    // preview image extends to preview_h. Everything is scaled by the
    // rendered card width / preview_w.
    const previewW = board.preview_w ?? 1
    const previewH = board.preview_h ?? 1
    const screenfulH = board.screenful_h ?? previewH
    const overflowH = Math.max(0, previewH - screenfulH)
    const maxPan = overflowH
    const canPan = overflowH > 0

    const onWheel = (e: React.WheelEvent) => {
        if (!canPan) return
        e.preventDefault()
        e.stopPropagation()
        // Wheel deltas are viewport px; convert to preview px via the scale
        const width = viewportRef.current?.clientWidth || CARD_PREVIEW_WIDTH
        const scale = previewW / width
        setPan((prev) => Math.min(maxPan, Math.max(0, prev + e.deltaY * scale)))
    }

    const aspect = previewW / Math.max(1, screenfulH)
    const label = board.name || getLocale(new Date(board.time_updated))
    const versionId = board.head_version_id

    return (
        <div
            className="group/card border rounded-md overflow-hidden bg-muted/30 cursor-pointer"
            onMouseEnter={() => onHover(board)}
            onMouseLeave={() => onHover(null)}
        >
            <div
                ref={viewportRef}
                className="relative w-full overflow-hidden"
                style={{ aspectRatio: `${aspect}` }}
                onClick={onOpen}
                onWheel={onWheel}
                title={label}
            >
                {versionId != null ? (
                    <img
                        src={pinboardPreviewURL(dbs, board.id, versionId, CARD_PREVIEW_WIDTH)}
                        alt={label}
                        className="absolute left-0 w-full"
                        style={{ top: `${(-pan / previewW) * 100}%` }}
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
                                height: `${(screenfulH / previewH) * 100}%`,
                                top: `${(pan / previewH) * 100}%`,
                            }}
                        />
                    </div>
                )}
            </div>
            <div className="flex items-center justify-between px-2 py-1 text-xs text-muted-foreground">
                <span className="truncate" title={label}>
                    {label} · {board.item_count} {board.item_count === 1 ? "item" : "items"}
                </span>
                <span className="hidden group-hover/card:flex items-center gap-1 shrink-0">
                    <button
                        title="Rename"
                        onClick={(e) => { e.stopPropagation(); onRename() }}
                        className="hover:text-foreground"
                    >
                        <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                        title="Delete"
                        onClick={(e) => { e.stopPropagation(); onDelete() }}
                        className="hover:text-destructive"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                </span>
            </div>
        </div>
    )
}

// Large floating preview while hovering a card: the stored image at full
// resolution (immutable, so the browser caches each size once).
function HoverPreview({
    board,
    dbs,
}: {
    board: PinboardSummary
    dbs: { index_db: string | null; user_data_db: string | null }
}) {
    const src = useMemo(
        () =>
            board.head_version_id != null
                ? pinboardPreviewURL(dbs, board.id, board.head_version_id, POPOVER_PREVIEW_WIDTH)
                : null,
        [board, dbs]
    )
    if (!src) return null
    return (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center p-8">
            <img
                src={src}
                alt=""
                className="max-w-[70vw] max-h-[80vh] rounded-md border shadow-lg object-contain bg-background"
            />
        </div>
    )
}
