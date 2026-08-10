"use client"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { $api } from "@/lib/api"
import { useBookmarkNs, } from "@/lib/state/zust"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/components/ui/use-toast"
import { File, FolderOpen, BookmarkPlus, BookmarkX, Cable, ClipboardCopy, Download, LoaderCircle } from "lucide-react"
import { Button } from "./ui/button"
import { Toggle } from "./ui/toggle"
import { cn } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"
import { updateBookmarkStatusInSearchCache } from "@/lib/bookmarkSearchCache"
import { useAlwaysShowBookmarkBtn } from "@/lib/state/alwaysShowBookmarks"
import { FindButton } from "./gallery/FindButton"
import { FileBookmarksSetter } from "./sidebar/details/FileBookmarks"
import { ContextMenu, ContextMenuContent, ContextMenuLabel, ContextMenuRadioGroup, ContextMenuRadioItem, ContextMenuTrigger } from "./ui/context-menu"
import { useFileOpenActions } from "@/hooks/fileOpen"
import { useFileShare } from "@/hooks/fileShare"
import { useLastFileAction, type FileActionVerb } from "@/lib/state/fileActionDefault"

export function RelayTargetSelector({
    actions,
}: {
    actions: ReturnType<typeof useFileOpenActions>
}) {
    if (!actions.relayDetected || actions.relayPaired) return null
    const pairLabel = actions.relayPairing
        ? "Opening Relay pairing…"
        : actions.relayPairingPending ? "Review Relay pairing request" : "Pair local Relay"
    return <Button
        aria-label={pairLabel}
        title={pairLabel}
        variant="ghost"
        size="icon"
        className="invisible absolute -bottom-1 -right-1 z-10 h-4 w-4 rounded-full border border-border bg-background p-0 text-foreground opacity-0 shadow-xs transition-opacity group-hover/file-action:visible group-hover/file-action:opacity-100 group-focus-within/file-action:visible group-focus-within/file-action:opacity-100"
        disabled={actions.relayPairing}
        onClick={() => void actions.pairRelay()}
    >
        <Cable className="h-2.5 w-2.5" />
    </Button>
}

function FileActionTargetMenu({
    actions,
    existingLabel,
    children,
}: {
    actions: ReturnType<typeof useFileOpenActions>
    existingLabel: string
    children: (open: boolean) => ReactNode
}) {
    const [open, setOpen] = useState(false)
    const trigger = children(open)
    if (!actions.relayPaired) return trigger
    return <ContextMenu onOpenChange={setOpen}>
        <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
        <ContextMenuContent className="min-w-52">
            <ContextMenuLabel>File action destination</ContextMenuLabel>
            <ContextMenuRadioGroup value={actions.actionTarget} onValueChange={value => actions.setActionTarget(value as "relay" | "existing")}>
                <ContextMenuRadioItem value="relay">This computer</ContextMenuRadioItem>
                <ContextMenuRadioItem value="existing">{existingLabel}</ContextMenuRadioItem>
            </ContextMenuRadioGroup>
        </ContextMenuContent>
    </ContextMenu>
}

export const BookmarkBtn = (
    {
        sha256,
        buttonVariant,
        bookmarked
    }: {
        sha256: string
        buttonVariant?: boolean
        // Status from the enriched search response the card was rendered
        // from (result.bookmarked). Undefined/null = surface without
        // enrichment; only then does the per-item GET below run.
        bookmarked?: boolean | null
    }
) => {
    const query = useSelectedDBs()[0]
    const namespace = useBookmarkNs((state) => state.namespace)
    const params = {
        path: { namespace, sha256 },
        query
    }
    const bookmarkPath = "/api/bookmarks/ns/{namespace}/{sha256}"
    // The prop gates the query at render time, so a fresh page of enriched
    // results can never fire a per-card volley (an effect-seeded store
    // cannot make that guarantee — children render before parent effects).
    const { data } = $api.useQuery(
        "get",
        bookmarkPath,
        {
            params,
        },
        {
            enabled: bookmarked == null,
        },
    )

    const addBookmark = $api.useMutation(
        "put",
        bookmarkPath,
    )

    const removeBookmark = $api.useMutation(
        "delete",
        bookmarkPath,
    )

    const queryClient = useQueryClient()
    const { toast } = useToast()

    const isBookmarked = bookmarked ?? (data?.exists || false)

    const handleBookmarkClick = () => {
        const onSuccess = (deleted: boolean) => {
            // The mutation result is authoritative — patch every cached
            // search response so this card (and any other card showing the
            // same item) flips instantly without a refetch.
            updateBookmarkStatusInSearchCache(
                queryClient,
                query.user_data_db,
                sha256,
                namespace,
                !deleted
            )
            queryClient.invalidateQueries({
                queryKey: [
                    "get",
                    bookmarkPath,
                    { params },
                ]
            })
            const multiQueryKey = ["get", "/api/bookmarks/item/{sha256}", {
                params: {
                    path: {
                        sha256,
                    },
                    query
                }
            }]
            queryClient.invalidateQueries({
                queryKey: multiQueryKey
            })
            toast({
                title: `Bookmark ${deleted ? "removed" : "added"}`,
                description: `File has been ${deleted ? "removed from" : "added to"} the ${namespace} group`,
                duration: 2000,
            })
        }
        const onError = (error: any) => {
            toast({
                title: "Failed to update bookmark",
                description: error.message,
                variant: "destructive",
                duration: 2000,
            })
        }
        if (isBookmarked) {
            removeBookmark.mutate({ params }, {
                onSuccess: () => onSuccess(true), onError(error, variables, context) {
                    onError(error)
                },
            })
        }
        else
            addBookmark.mutate({ params }, { onSuccess: () => onSuccess(false), onError: onError })
    }
    const alwaysShow = useAlwaysShowBookmarkBtn()[0]
    return (
        <ContextMenu>
            <ContextMenuTrigger>
                <BookmarksButtonElement
                    namespace={namespace}
                    isBookmarked={isBookmarked}
                    handleBookmarkClick={handleBookmarkClick}
                    alwaysShow={alwaysShow}
                    buttonVariant={buttonVariant}
                />
            </ContextMenuTrigger>
            <ContextMenuContent className="z-50 border rounded-lg">
                <FileBookmarksSetter
                    sha256={sha256}
                    onlySelectors
                />
            </ContextMenuContent>
        </ContextMenu>

    )
}

function BookmarksButtonElement({
    namespace,
    isBookmarked,
    handleBookmarkClick,
    alwaysShow,
    buttonVariant
}: {
    namespace: string
    isBookmarked: boolean
    handleBookmarkClick: () => void
    alwaysShow: boolean
    buttonVariant?: boolean
}) {
    return buttonVariant ?
        <Toggle
            title={
                isBookmarked ?
                    `Remove from current bookmark group (${namespace})`
                    : `Add to current bookmark group (${namespace})`
            }
            onClick={handleBookmarkClick}
            pressed={isBookmarked}
        >
            {isBookmarked ? <BookmarkX className="w-4 h-4" /> : <BookmarkPlus className="w-4 h-4" />}
        </Toggle>
        : <button
            title={
                isBookmarked ?
                    `Remove from current bookmark group (${namespace})`
                    : `Add to current bookmark group (${namespace})`
            }
            className={cn("hover:scale-105 absolute top-2 right-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300",
                (alwaysShow && isBookmarked) ? 'opacity-100' : 'opacity-0'
            )}
            onClick={handleBookmarkClick}
        >
            {isBookmarked ? (
                // Filled bookmark icon (when bookmarked)
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    className="w-6 h-6 text-gray-800"
                >
                    <path d="M5 3v18l7-5 7 5V3H5z" />
                </svg>
            ) : (
                // Outlined bookmark icon (when not bookmarked)
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    className="w-6 h-6 text-gray-800"
                >
                    <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
                </svg>
            )}
        </button>
}

export const OpenFile = (
    { sha256, path, buttonVariant, overlayClassName, onUsed }: {
        sha256: string
        path?: string
        buttonVariant?: boolean
        // Cluster-controlled slot position + visibility, replacing the default
        // overlay anchor when this button rides in a FileActionCluster.
        overlayClassName?: string
        onUsed?: () => void
    }
) => {
    const actions = useFileOpenActions({ sha256, path })
    const { openFile, disableBackendOpen } = actions
    const handleClick = openFile
    const buttonTitle = actions.relayPaired && actions.actionTarget === "relay"
        ? "Open file on this computer using Relay"
        : disableBackendOpen ? "Open file in new tab" : "Open file on the Panoptikon server host"
    return <FileActionTargetMenu
        actions={actions}
        existingLabel={disableBackendOpen ? "Browser" : "Panoptikon server host"}
    >{menuOpen => <span
        onClickCapture={onUsed}
        className={cn(
            "relative inline-flex group/file-action",
            !buttonVariant && (overlayClassName ?? "absolute bottom-3 left-1 opacity-0 transition-opacity duration-300 group-hover:opacity-100"),
            // pointer-events-auto so an open target menu keeps its (possibly
            // collapsed-away) trigger interactive until it closes.
            !buttonVariant && menuOpen && "opacity-100 pointer-events-auto",
        )}>
            {buttonVariant ?
                <Button
                    title={buttonTitle}
                    onClick={() => handleClick()}
                    variant="ghost"
                    size="icon"
                >
                    <File
                        className="w-4 h-4"
                    />
                </Button>
                :
                <button
                    onClick={() => handleClick()}
                    title={buttonTitle}
                    className="rounded-full bg-white p-2 hover:scale-105"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                        className="w-6 h-6 text-gray-800"
                    >
                        <path d="M14 2H6C4.9 2 4 2.9 4 4v16c0 1.1 0.9 2 2 2h12c1.1 0 2-0.9 2-2V8l-6-6zm1 7V3.5L18.5 9H15z" />
                    </svg>
                </button>}
            <RelayTargetSelector actions={actions} />
        </span>}
    </FileActionTargetMenu>
}
export const OpenFolder = (
    {
        sha256,
        path,
        buttonVariant,
        overlayClassName,
        onUsed
    }: {
        sha256: string
        path?: string
        buttonVariant?: boolean
        overlayClassName?: string
        onUsed?: () => void
    }
) => {
    const actions = useFileOpenActions({ sha256, path })
    const { showInFolder, disableBackendOpen } = actions
    const handleClick = showInFolder
    if (disableBackendOpen && !(actions.relayPaired && actions.actionTarget === "relay")) {
        return <FileActionTargetMenu actions={actions} existingLabel="Panoptikon search">
            {menuOpen => <span
            onClickCapture={onUsed}
            className={cn(
            "relative inline-flex group/file-action",
            !buttonVariant && (overlayClassName ?? "absolute bottom-3 left-12 opacity-0 transition-opacity duration-300 group-hover:opacity-100"),
            !buttonVariant && menuOpen && "opacity-100 pointer-events-auto",
        )}>
            <FindButton
                id={sha256}
                id_type="sha256"
                path={path || ""}
                buttonVariant={buttonVariant}
                buttonClassName={!buttonVariant ? "static opacity-100" : undefined}
            />
            <RelayTargetSelector actions={actions} />
        </span>}
        </FileActionTargetMenu>
    }
    return <FileActionTargetMenu actions={actions} existingLabel="Panoptikon server host">
        {menuOpen => <span
        onClickCapture={onUsed}
        className={cn(
        "relative inline-flex group/file-action",
        !buttonVariant && (overlayClassName ?? "absolute bottom-3 left-12 opacity-0 transition-opacity duration-300 group-hover:opacity-100"),
        !buttonVariant && menuOpen && "opacity-100 pointer-events-auto",
    )}>
        {buttonVariant ?
            <Button
                title={actions.relayPaired && actions.actionTarget === "relay" ? "Show file on this computer using Relay" : "Show file on the Panoptikon server host"}
                onClick={() => handleClick()}
                variant="ghost"
                size="icon"
            >
                <FolderOpen
                    className="w-4 h-4"
                />
            </Button>
            :
            <button
                title="Show file in folder"
                onClick={() => handleClick()}
                className="rounded-full bg-white p-2 hover:scale-105"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    className="w-6 h-6 text-gray-800"
                >
                    <path d="M10 4H4c-1.1 0-2 0.9-2 2v12c0 1.1 0.9 2 2 2h16c1.1 0 2-0.9 2-2V8c0-1.1-0.9-2-2-2h-8l-2-2z" />
                </svg>
            </button>}
        <RelayTargetSelector actions={actions} />
    </span>}
    </FileActionTargetMenu>
}

// The adaptive share button for header surfaces (docs/file-sharing-design.md).
// Click is Copy where a native path exists, Download otherwise — the icon and
// tooltip track the active verb. The grid overlay's equivalent is
// FileActionCluster, where Copy and Download are separate buttons; this one
// deliberately has no context menu (the old right-click Download alternate
// left the trigger focused on close, holding the overlay visible — and the
// header already shows a dedicated Download control).
export const ShareButton = (
    { sha256, path, shortcut }: {
        sha256: string
        path?: string
        // Keyboard accelerator to name in the tooltip, where one exists for
        // this surface (the gallery's Ctrl+C — otherwise undiscoverable).
        shortcut?: string
    }
) => {
    const share = useFileShare({ sha256, path })
    const isCopy = share.primaryVerb === "copy"
    const verb = isCopy ? "Copy file to clipboard" : "Download file"
    // A copy can spend minutes materializing a multi-GB file; the button says
    // so and refuses a second click, which would start a whole second transfer.
    const title = share.busy
        ? (isCopy ? "Copying…" : "Downloading…")
        : shortcut && isCopy ? `${verb} (${shortcut})` : verb
    const Icon = share.busy ? LoaderCircle : isCopy ? ClipboardCopy : Download
    return <Button
        title={title}
        aria-label={title}
        aria-busy={share.busy}
        disabled={share.busy}
        onClick={() => void share.execute()}
        variant="ghost"
        size="icon"
    >
        <Icon className={cn("w-4 h-4", share.busy && "animate-spin")} />
    </Button>
}

// Slot geometry of the 2x2 file action corner, in order [corner, above,
// beside, diagonal]. Buttons are 2.5rem circles and every gap is 0.25rem;
// each anchor matches the button inset convention of the surface it serves
// (the search grid's bottom-left, the gallery filmstrip's bottom-right).
const CLUSTER_SLOTS = {
    "bottom-left": [
        "absolute bottom-3 left-1",
        "absolute bottom-14 left-1",
        "absolute bottom-3 left-12",
        "absolute bottom-14 left-12",
    ],
    "bottom-right": [
        "absolute bottom-2 right-2",
        "absolute bottom-13 right-2",
        "absolute bottom-2 right-13",
        "absolute bottom-13 right-13",
    ],
} as const

// The grid card's file actions, collapsed to ONE button: the last-used verb
// (persisted). Hovering it — or tabbing into the cluster — expands the other
// verbs into the 2x2 corner square, alternates above/beside and the last one
// diagonal. Copy participates only where useFileShare resolves a native copy
// path; without one the set is three and the diagonal slot stays empty (a
// remembered Copy corner degrades to Download, like the old adaptive button).
export const FileActionCluster = ({ sha256, path, anchor = "bottom-left" }: {
    sha256: string
    path?: string
    anchor?: keyof typeof CLUSTER_SLOTS
}) => {
    const share = useFileShare({ sha256, path })
    const lastVerb = useLastFileAction((state) => state.verb)
    const setLastVerb = useLastFileAction((state) => state.setVerb)
    const [expanded, setExpanded] = useState(false)
    // Which share verb is mid-flight: only that button spins, and it stays
    // pinned visible for a copy that spends minutes materializing.
    const [busyVerb, setBusyVerb] = useState<"copy" | "download" | null>(null)
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])
    const open = () => {
        if (closeTimer.current) clearTimeout(closeTimer.current)
        setExpanded(true)
    }
    // The grace period is what makes hover-on-hover workable: crossing the
    // 0.25rem gap between buttons fires a mouseout that must not collapse the
    // square mid-crossing.
    const scheduleClose = () => {
        if (closeTimer.current) clearTimeout(closeTimer.current)
        closeTimer.current = setTimeout(() => setExpanded(false), 150)
    }

    const slots = CLUSTER_SLOTS[anchor]
    const canCopy = share.primaryVerb === "copy"
    const verbs: FileActionVerb[] = canCopy ? ["copy", "open", "folder", "download"] : ["open", "folder", "download"]
    const corner: FileActionVerb = verbs.includes(lastVerb) ? lastVerb : "download"
    const slotOf: Partial<Record<FileActionVerb, string>> = { [corner]: slots[0] }
    verbs.filter((verb) => verb !== corner).forEach((verb, i) => { slotOf[verb] = slots[i + 1] })

    // The corner keeps the classic card-hover fade; the expansion slots are
    // hidden AND click-transparent until the cluster opens, so an invisible
    // button can never intercept a click meant for the image under it.
    const position = (verb: FileActionVerb) =>
        verb === corner
            ? cn(slotOf[verb], "opacity-0 transition-opacity duration-300 group-hover:opacity-100", expanded && "opacity-100")
            : cn(slotOf[verb], "transition-opacity duration-300", expanded ? "opacity-100" : "opacity-0 pointer-events-none")

    const runShare = async (verb: "copy" | "download") => {
        setLastVerb(verb)
        setBusyVerb(verb)
        try {
            if (verb === "copy") await share.execute()
            else await share.download()
        } finally {
            setBusyVerb(null)
        }
    }
    const shareSlot = (verb: "copy" | "download") => {
        const busy = busyVerb === verb
        const title = busy
            ? (verb === "copy" ? "Copying…" : "Downloading…")
            : verb === "copy" ? "Copy file to clipboard" : "Download file"
        const Icon = busy ? LoaderCircle : verb === "copy" ? ClipboardCopy : Download
        return <button
            onClick={() => void runShare(verb)}
            title={title}
            aria-label={title}
            aria-busy={busy}
            disabled={share.busy}
            className={cn(
                "rounded-full bg-white p-2 hover:scale-105",
                position(verb),
                busy && "opacity-100 pointer-events-auto cursor-progress",
            )}
        >
            <Icon className={cn("w-6 h-6 text-gray-800", busy && "animate-spin")} />
        </button>
    }

    return <div
        className="contents"
        onMouseOver={open}
        onMouseOut={scheduleClose}
        // Keyboard-only expansion, gated on :focus-visible. Radix returns
        // focus to a trigger when its context menu closes, but mouse-made
        // focus is not :focus-visible — so the cluster cannot get stuck open
        // the way the old group-focus-within share button did.
        onFocus={(event) => { if ((event.target as HTMLElement).matches?.(":focus-visible")) open() }}
        onBlur={(event) => { if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) scheduleClose() }}
    >
        {canCopy && shareSlot("copy")}
        {shareSlot("download")}
        <OpenFile sha256={sha256} path={path} overlayClassName={position("open")} onUsed={() => setLastVerb("open")} />
        <OpenFolder sha256={sha256} path={path} overlayClassName={position("folder")} onUsed={() => setLastVerb("folder")} />
    </div>
}

// Copy a path (or any text) to the clipboard with a confirmation toast.
// Shared by the plain file-path header and the pinboard tab header's
// right-click menu.
export const useCopyPath = () => {
    const { toast } = useToast()
    return (text: string) => {
        const ok = () => toast({
            title: "Copied to clipboard",
            description: text,
            duration: 2000,
        })
        const fail = (err?: Error) => {
            console.error('Failed to copy text: ', err)
            toast({
                title: "Failed to copy to clipboard",
                description: err?.message,
                variant: "destructive",
                duration: 2000,
            })
        }
        try {
            // Copied as an explicit text/plain item — this is necessary to
            // prevent the browser from adding file:// to the path
            const blob = new Blob([text], { type: 'text/plain' })
            const data = [new ClipboardItem({ 'text/plain': blob })]
            navigator.clipboard.write(data).then(ok).catch(fail)
        } catch {
            // Insecure origins (plain-http on a LAN) have no clipboard API;
            // the legacy execCommand path still works there
            const ta = document.createElement("textarea")
            ta.value = text
            document.body.appendChild(ta)
            ta.select()
            const copied = document.execCommand("copy")
            ta.remove()
            if (copied) ok()
            else fail()
        }
    }
}

export const FilePathComponent = ({ path }: { path: string }) => {
    const handleCopyToClipboard = useCopyPath()
    // Remove leading / if it exists
    const displayPath = path[0] === '/' ? path.slice(1) : path
    return (
        <p
            title={path}
            className="text-sm truncate cursor-pointer"
            style={{ direction: 'rtl', textAlign: 'left' }}
            onClick={() => handleCopyToClipboard(path)}
        >
            {displayPath}
        </p>
    )
}
