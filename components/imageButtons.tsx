"use client"
import { useState, type ReactNode } from "react"
import { $api } from "@/lib/api"
import { useBookmarkNs, } from "@/lib/state/zust"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/components/ui/use-toast"
import { File, FolderOpen, BookmarkPlus, BookmarkX, Cable } from "lucide-react"
import { Button } from "./ui/button"
import { Toggle } from "./ui/toggle"
import { cn } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"
import { useAlwaysShowBookmarkBtn } from "@/lib/state/alwaysShowBookmarks"
import { FindButton } from "./gallery/FindButton"
import { FileBookmarksSetter } from "./sidebar/details/FileBookmarks"
import { ContextMenu, ContextMenuContent, ContextMenuLabel, ContextMenuRadioGroup, ContextMenuRadioItem, ContextMenuTrigger } from "./ui/context-menu"
import { useFileOpenActions } from "@/hooks/fileOpen"

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
        buttonVariant
    }: {
        sha256: string
        buttonVariant?: boolean
    }
) => {
    const query = useSelectedDBs()[0]
    const namespace = useBookmarkNs((state) => state.namespace)
    const params = {
        path: { namespace, sha256 },
        query
    }
    const bookmarkPath = "/api/bookmarks/ns/{namespace}/{sha256}"
    const { data, error, isLoading, isError, status } = $api.useQuery(
        "get",
        bookmarkPath,
        {
            params,
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

    const isBookmarked = data?.exists || false

    const handleBookmarkClick = () => {
        const onSuccess = (deleted: boolean) => {
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
    { sha256, path, buttonVariant }: {
        sha256: string
        path?: string
        buttonVariant?: boolean
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
    >{menuOpen => <span className={cn(
            "relative inline-flex group/file-action",
            !buttonVariant && "absolute bottom-3 left-1 opacity-0 transition-opacity duration-300 group-hover:opacity-100",
            !buttonVariant && menuOpen && "opacity-100",
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
        buttonVariant
    }: {
        sha256: string
        path?: string
        buttonVariant?: boolean
    }
) => {
    const actions = useFileOpenActions({ sha256, path })
    const { showInFolder, disableBackendOpen } = actions
    const handleClick = showInFolder
    if (disableBackendOpen && !(actions.relayPaired && actions.actionTarget === "relay")) {
        return <FileActionTargetMenu actions={actions} existingLabel="Panoptikon search">
            {menuOpen => <span className={cn(
            "relative inline-flex group/file-action",
            !buttonVariant && "absolute bottom-3 left-12 opacity-0 transition-opacity duration-300 group-hover:opacity-100",
            !buttonVariant && menuOpen && "opacity-100",
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
        {menuOpen => <span className={cn(
        "relative inline-flex group/file-action",
        !buttonVariant && "absolute bottom-3 left-12 opacity-0 transition-opacity duration-300 group-hover:opacity-100",
        !buttonVariant && menuOpen && "opacity-100",
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
