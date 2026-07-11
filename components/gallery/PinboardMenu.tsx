'use client'

import { useState } from "react"
import { ChevronDown } from "lucide-react"
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
import { usePinboardActions } from "@/lib/pinboardSave"
import { useSelectedDBs } from "@/lib/state/database"
import { $api } from "@/lib/api"
import { PinboardLibraryDialog } from "./PinboardLibrary"
import { PinboardHistoryPanel } from "./PinboardHistory"

// All board-level verbs live in this one chevron, so the tab header costs
// ~24px regardless of viewport width. The chevron renders as the right
// segment of the Pinboard tab's split button: the wrapper in PinboardTabs
// carries the active-tab background, so this button only draws its own
// hover state and stretches to the wrapper's height. Save is one click and never asks
// anything: with a pbid it appends a version to that board (no-op when
// unchanged), without one it creates a board. "Save as new copy" is the
// first-class fork — it snapshots the CURRENT state (including unsaved
// modifications) as a new board and leaves the original untouched.
export function PinboardMenu() {
    const { save, rename, pbid } = usePinboardActions()
    const dbs = useSelectedDBs()[0]
    const [libraryOpen, setLibraryOpen] = useState(false)
    const [historyOpen, setHistoryOpen] = useState(false)
    const [renameOpen, setRenameOpen] = useState(false)
    const [renameValue, setRenameValue] = useState("")

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

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        title="Pinboard actions"
                        aria-label="Pinboard actions"
                        className="inline-flex shrink-0 items-center justify-center rounded-sm rounded-l-none px-1 transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <ChevronDown className="h-4 w-4" />
                    </button>
                </DropdownMenuTrigger>
                {/* Left-align the menu with the whole split button: offset by the
                    width of the Pinboard TabsTrigger sitting left of this chevron. */}
                <DropdownMenuContent align="start" alignOffset={-80} className="w-56">
                    <DropdownMenuItem onClick={() => save(false)}>
                        Save
                        {pbid != null && (
                            <span className="ml-auto text-xs text-muted-foreground truncate max-w-[8rem]">
                                {board?.name || `board ${pbid}`}
                            </span>
                        )}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => save(true)}>
                        Save as new copy
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {pbid != null && (
                        <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
                            History
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => setLibraryOpen(true)}>
                        Library
                    </DropdownMenuItem>
                    {pbid != null && (
                        <DropdownMenuItem onClick={openRename}>
                            Rename
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
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
        </>
    )
}
