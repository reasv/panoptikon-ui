'use client'

import React, { useMemo, useState } from "react"
import { Trash2, X } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { $api, fetchClient } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import {
    useGalleryPinBoardId,
    useGalleryPinBoardLayout,
} from "@/lib/state/gallery"
import { dbQuery, layoutsEqual } from "@/lib/pinboardSave"
import { pinboardPreviewURL } from "@/lib/pinboardPreview"
import { clearStash, readStash, writeStash } from "@/lib/pinboardStash"
import { useToast } from "@/components/ui/use-toast"
import { useQueryClient } from "@tanstack/react-query"
import { getLocale, cn } from "@/lib/utils"
import { components } from "@/lib/panoptikon"

type PinboardVersion = components["schemas"]["PinboardVersionResponse"]

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
    const { toast } = useToast()
    const queryClient = useQueryClient()
    // Bumped after stash writes so the pinned entry re-reads
    const [stashEpoch, setStashEpoch] = useState(0)

    const { data } = $api.useQuery(
        "get",
        "/api/pinboards/{pinboard_id}/versions",
        {
            params: {
                path: { pinboard_id: pbid ?? -1 },
                query: { ...dbQuery(dbs) },
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
        setSavedLayout(layout, { history: "replace" })
    }

    const deleteVersion = async (version: PinboardVersion) => {
        const label = version.name_at_save || getLocale(new Date(version.time_added))
        if (!window.confirm(`Permanently delete the version saved ${getLocale(new Date(version.time_added))} (${label})?${versions.length === 1 ? "\nThis is the last version: the pinboard itself will be deleted." : ""}`)) {
            return
        }
        const { data: outcome } = await fetchClient.DELETE(
            "/api/pinboards/{pinboard_id}/versions/{version_id}",
            {
                params: {
                    path: { pinboard_id: pbid, version_id: version.id },
                    query: { ...dbQuery(dbs) },
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
        <div className="fixed right-6 top-24 z-50 w-80 max-h-[70vh] flex flex-col bg-background border rounded-md shadow-lg">
            <div className="flex items-center justify-between px-3 py-2 border-b">
                <span className="text-sm font-medium">Version history</span>
                <button onClick={onClose} title="Close" className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                </button>
            </div>
            <ScrollArea className="flex-1 min-h-0">
                <div className="p-2 space-y-1.5">
                    {stash && (
                        <VersionRow
                            label="Current — unsaved"
                            sublabel={getLocale(new Date(stash.time))}
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
                            sublabel={`${getLocale(new Date(version.time_added))} · ${version.item_count} ${version.item_count === 1 ? "item" : "items"}`}
                            previewSrc={pinboardPreviewURL(dbs, pbid, version.id, 160)}
                            selected={layoutsEqual(version.layout, savedLayout)}
                            onSelect={() => swapTo(version.layout)}
                            onDelete={() => deleteVersion(version)}
                        />
                    ))}
                    {versions.length === 0 && (
                        <p className="text-xs text-muted-foreground p-4 text-center">
                            No saved versions
                        </p>
                    )}
                </div>
            </ScrollArea>
        </div>
    )
}

function VersionRow({
    label,
    sublabel,
    previewSrc,
    selected,
    onSelect,
    onDelete,
}: {
    label: string
    sublabel: string
    previewSrc?: string
    selected: boolean
    onSelect: () => void
    onDelete?: () => void
}) {
    return (
        <div
            className={cn(
                "group/row flex items-center gap-2 rounded-md border p-1.5 cursor-pointer hover:bg-muted/50",
                selected && "border-primary bg-muted/40"
            )}
            onClick={onSelect}
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
                <p className="text-[11px] text-muted-foreground truncate">{sublabel}</p>
            </div>
            {onDelete && (
                <button
                    title="Delete this version"
                    onClick={(e) => { e.stopPropagation(); onDelete() }}
                    className="hidden group-hover/row:block text-muted-foreground hover:text-destructive shrink-0"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    )
}
