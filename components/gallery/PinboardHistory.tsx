'use client'

import React, { useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import {
    ArrowDownLeft,
    ArrowDownRight,
    ArrowUpLeft,
    ArrowUpRight,
    LucideIcon,
    Trash2,
    X,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { $api, fetchClient } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import {
    useGalleryPinBoardId,
    useGalleryPinBoardLayout,
} from "@/lib/state/gallery"
import { layoutsEqual } from "@/lib/pinboardSave"
import { pinboardPreviewURL } from "@/lib/pinboardPreview"
import { clearStash, readStash, writeStash } from "@/lib/pinboardStash"
import { markPinboardNavigation } from "@/lib/pinboardNavigation"
import { useToast } from "@/components/ui/use-toast"
import { useQueryClient } from "@tanstack/react-query"
import { pinboardOpenHref } from "@/lib/pinboardLinks"
import { getLocale, cn, compactDate, dateTitle } from "@/lib/utils"
import { components } from "@/lib/panoptikon"
import {
    horizontalPopoverBox,
    PreviewPopover,
    PREVIEW_POPOVER_WIDTH,
    useDelayedHover,
} from "./PinboardPreviewPopover"

type PinboardVersion = components["schemas"]["PinboardVersionResponse"]

type Corner = "tl" | "tr" | "bl" | "br"

const CORNERS: { key: Corner; Icon: LucideIcon; label: string }[] = [
    { key: "tl", Icon: ArrowUpLeft, label: "Dock to top left" },
    { key: "tr", Icon: ArrowUpRight, label: "Dock to top right" },
    { key: "bl", Icon: ArrowDownLeft, label: "Dock to bottom left" },
    { key: "br", Icon: ArrowDownRight, label: "Dock to bottom right" },
]

const PANEL_INSET = 8

// The rect the panel docks into: the pinboard's own scroll container
// (tagged data-pinboard-area in GalleryPinBoard), so the panel sits inside
// the board exactly, never over the tab header above it. Falls back to the
// viewport if the board is hidden (e.g. the user tabs to the file view
// while the panel is open).
function usePinboardAreaRect(open: boolean) {
    const [rect, setRect] = useState<DOMRect | null>(null)
    useEffect(() => {
        if (!open) return
        const el = document.querySelector("[data-pinboard-area]")
        const measure = () =>
            setRect(el ? el.getBoundingClientRect() : null)
        measure()
        window.addEventListener("resize", measure)
        let ro: ResizeObserver | undefined
        if (el) {
            ro = new ResizeObserver(measure)
            ro.observe(el)
        }
        return () => {
            window.removeEventListener("resize", measure)
            ro?.disconnect()
        }
    }, [open])
    return rect
}

function panelStyle(corner: Corner, area: DOMRect | null): React.CSSProperties {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const rect = area ?? new DOMRect(16, 96, vw - 32, vh - 112)
    return {
        top: corner[0] === "t" ? rect.top + PANEL_INSET : undefined,
        bottom: corner[0] === "b" ? vh - rect.bottom + PANEL_INSET : undefined,
        left: corner[1] === "l" ? rect.left + PANEL_INSET : undefined,
        right: corner[1] === "r" ? vw - rect.right + PANEL_INSET : undefined,
        maxHeight: Math.max(160, rect.height - 2 * PANEL_INSET),
    }
}

// Version browser: a non-modal floating panel over the live board. The
// board itself is the preview surface — selecting an entry writes that
// version's layout into the URL (history: replace, so cycling through ten
// versions costs one history entry, keeping back-as-undo intact) and the
// real board renders it full size behind the panel. Nothing is tracked:
// the highlighted row is derived by layout equality with the URL state.
//
// Safety net: swapping away from a layout that matches no saved version
// stashes it first (single slot per board, sessionStorage), shown pinned
// on top as "Current — unsaved" until a save clears it.
export function PinboardHistoryPanel({
    open,
    onClose,
}: {
    open: boolean
    onClose: () => void
}) {
    const dbs = useSelectedDBs()[0]
    const [savedLayout, setSavedLayout] = useGalleryPinBoardLayout()
    const [pbid, setPbid] = useGalleryPinBoardId()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const { toast } = useToast()
    const queryClient = useQueryClient()
    // Bumped after stash writes so the pinned entry re-reads
    const [stashEpoch, setStashEpoch] = useState(0)
    const [corner, setCorner] = useState<Corner>("tr")
    const areaRect = usePinboardAreaRect(open)
    const panelRef = useRef<HTMLDivElement>(null)
    // Hovered version row + its rect; scrolling the list clears it because
    // the captured rect goes stale.
    const [hoveredRow, setHoveredRow] = useDelayedHover<{
        version: PinboardVersion
        anchor: DOMRect
    }>()
    // Version awaiting delete confirmation in the ConfirmDialog
    const [confirmDelete, setConfirmDelete] = useState<PinboardVersion | null>(null)

    const { data } = $api.useQuery(
        "get",
        "/api/pinboards/{pinboard_id}/versions",
        {
            params: {
                path: { pinboard_id: pbid ?? -1 },
                query: { ...dbs },
            },
        },
        { enabled: open && pbid != null }
    )
    const versions = data?.versions ?? []

    const stash = useMemo(
        () => (pbid != null ? readStash(pbid) : null),
        [pbid, stashEpoch, open]
    )

    if (!open || pbid == null) return null

    const isDirty =
        savedLayout.length > 0 &&
        !versions.some((v) => layoutsEqual(v.layout, savedLayout)) &&
        !(stash && layoutsEqual(stash.layout, savedLayout))

    const swapTo = (layout: string[]) => {
        if (layoutsEqual(layout, savedLayout)) return
        if (isDirty) {
            writeStash(pbid, savedLayout)
            setStashEpoch((epoch) => epoch + 1)
        }
        // Preview swaps replace history: the whole browsing session is one
        // history entry, and back still undoes real actions.
        markPinboardNavigation()
        setSavedLayout(layout, { history: "replace" })
    }

    const deleteVersion = async (version: PinboardVersion) => {
        const { data: outcome } = await fetchClient.DELETE(
            "/api/pinboards/{pinboard_id}/versions/{version_id}",
            {
                params: {
                    path: { pinboard_id: pbid, version_id: version.id },
                    query: { ...dbs },
                },
            }
        )
        queryClient.invalidateQueries({ queryKey: ["get", "/api/pinboards"] })
        queryClient.invalidateQueries({
            queryKey: ["get", "/api/pinboards/{pinboard_id}/versions"],
        })
        if (outcome?.deleted_board) {
            clearStash(pbid)
            // The board is gone; the layout on screen simply becomes an
            // unsaved board again.
            setPbid(null)
            onClose()
            toast({ title: "Deleted pinboard", duration: 2000 })
        } else {
            toast({ title: "Deleted version", duration: 2000 })
        }
    }

    return (
        <div
            ref={panelRef}
            data-pinboard-history
            className="fixed z-50 w-80 flex flex-col bg-background border rounded-md shadow-lg"
            style={panelStyle(corner, areaRect)}
        >
            <div className="flex items-center justify-between px-3 py-2 border-b">
                <span className="text-sm font-medium">Version history</span>
                <span className="flex items-center gap-1.5">
                    {CORNERS.filter((c) => c.key !== corner).map(({ key, Icon, label }) => (
                        <button
                            key={key}
                            onClick={() => {
                                setCorner(key)
                                setHoveredRow(null)
                            }}
                            title={label}
                            className="text-muted-foreground/60 hover:text-foreground"
                        >
                            <Icon className="h-3.5 w-3.5" />
                        </button>
                    ))}
                    <button
                        onClick={onClose}
                        title="Close"
                        className="ml-1 text-muted-foreground hover:text-foreground"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </span>
            </div>
            <ScrollArea
                className="flex-1 min-h-0"
                onScrollCapture={() => setHoveredRow(null)}
            >
                <div className="p-2 space-y-1.5">
                    {stash && (
                        <VersionRow
                            label="Current — unsaved"
                            sublabel={compactDate(new Date(stash.time))}
                            sublabelTitle={dateTitle(new Date(stash.time))}
                            selected={layoutsEqual(stash.layout, savedLayout)}
                            onSelect={() => swapTo(stash.layout)}
                        />
                    )}
                    {isDirty && !stash && (
                        <VersionRow
                            label="Current — unsaved"
                            sublabel="on the board now"
                            selected
                            onSelect={() => { }}
                        />
                    )}
                    {versions.map((version) => (
                        <VersionRow
                            key={version.id}
                            label={version.name_at_save || "Untitled"}
                            sublabel={`${compactDate(new Date(version.time_added))} · ${version.item_count} ${version.item_count === 1 ? "item" : "items"}`}
                            sublabelTitle={dateTitle(new Date(version.time_added))}
                            href={pinboardOpenHref(pathname, searchParams, pbid, version.id)}
                            previewSrc={pinboardPreviewURL(dbs, pbid, version.id, 160)}
                            selected={layoutsEqual(version.layout, savedLayout)}
                            onSelect={() => swapTo(version.layout)}
                            onDelete={() => setConfirmDelete(version)}
                            onHover={(anchor) =>
                                setHoveredRow(anchor ? { version, anchor } : null)
                            }
                        />
                    ))}
                    {versions.length === 0 && (
                        <p className="text-xs text-muted-foreground p-4 text-center">
                            No saved versions
                        </p>
                    )}
                </div>
            </ScrollArea>
            {hoveredRow && panelRef.current && (
                <PreviewPopover
                    src={pinboardPreviewURL(
                        dbs,
                        pbid,
                        hoveredRow.version.id,
                        PREVIEW_POPOVER_WIDTH
                    )}
                    box={horizontalPopoverBox(
                        panelRef.current.getBoundingClientRect(),
                        hoveredRow.anchor,
                        hoveredRow.version.preview_w ?? 1,
                        hoveredRow.version.preview_h ?? 1
                    )}
                />
            )}
            <ConfirmDialog
                open={confirmDelete != null}
                title="Delete version?"
                description={
                    confirmDelete
                        ? `Permanently delete the version saved ${getLocale(new Date(confirmDelete.time_added))}` +
                        `${confirmDelete.name_at_save ? ` (${confirmDelete.name_at_save})` : ""}.` +
                        `${versions.length === 1 ? "\nThis is the last version: the pinboard itself will be deleted." : ""}`
                        : undefined
                }
                confirmLabel="Delete"
                onConfirm={() => {
                    if (confirmDelete) void deleteVersion(confirmDelete)
                    setConfirmDelete(null)
                }}
                onCancel={() => setConfirmDelete(null)}
            />
        </div>
    )
}

// Saved rows are real links (middle/ctrl-click opens the version in a new
// tab via the pbl deferred-load param); a plain click keeps the in-place
// swap semantics. The stash row has no version id, so it stays a div.
function VersionRow({
    label,
    sublabel,
    sublabelTitle,
    href,
    previewSrc,
    selected,
    onSelect,
    onDelete,
    onHover,
}: {
    label: string
    sublabel: string
    sublabelTitle?: string
    href?: string
    previewSrc?: string
    selected: boolean
    onSelect: () => void
    onDelete?: () => void
    onHover?: (anchor: DOMRect | null) => void
}) {
    const Root = href ? "a" : "div"
    return (
        <Root
            href={href}
            draggable={false}
            className={cn(
                "group/row flex items-center gap-2 rounded-md border p-1.5 cursor-pointer hover:bg-muted/50",
                selected && "border-primary bg-muted/40"
            )}
            onClick={(e) => {
                // Modified clicks keep the browser's link behavior (new tab)
                if (href && (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)) return
                e.preventDefault()
                onSelect()
            }}
            onMouseEnter={(e) =>
                onHover?.(e.currentTarget.getBoundingClientRect())
            }
            onMouseLeave={() => onHover?.(null)}
        >
            <div className="w-16 h-10 shrink-0 rounded bg-muted overflow-hidden flex items-center justify-center">
                {previewSrc ? (
                    <img src={previewSrc} alt="" className="w-full h-full object-cover object-top" draggable={false} />
                ) : (
                    <span className="text-[10px] text-muted-foreground">unsaved</span>
                )}
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{label}</p>
                <p className="text-[11px] text-muted-foreground truncate" title={sublabelTitle}>{sublabel}</p>
            </div>
            {onDelete && (
                <button
                    title="Delete this version"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete() }}
                    className="hidden group-hover/row:block text-muted-foreground hover:text-destructive shrink-0"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            )}
        </Root>
    )
}
