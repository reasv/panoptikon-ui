"use client"
import { $api } from "@/lib/api"
import { useBookmarkNs, } from "@/lib/state/zust"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/components/ui/use-toast"
import { File, FolderOpen, BookmarkPlus, BookmarkX, ChevronDown } from "lucide-react"
import { Button } from "./ui/button"
import { Toggle } from "./ui/toggle"
import { cn } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"
import { useAlwaysShowBookmarkBtn } from "@/lib/state/alwaysShowBookmarks"
import { FindButton } from "./gallery/FindButton"
import { FileBookmarksSetter } from "./sidebar/details/FileBookmarks"
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "./ui/context-menu"
import { useFileOpenActions } from "@/hooks/fileOpen"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "./ui/dropdown-menu"

function RelayTargetSelector({ actions, floatingClass }: { actions: ReturnType<typeof useFileOpenActions>, floatingClass?: string }) {
    if (!actions.relayDetected) return null
    return <DropdownMenu>
        <DropdownMenuTrigger asChild>
            <Button aria-label="Choose where file actions run" title="Choose where file actions run" variant="ghost" size="icon" className={cn("h-6 w-6", floatingClass)}>
                <ChevronDown className="h-3 w-3" />
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
            {actions.relayPaired ? <DropdownMenuRadioGroup value={actions.actionTarget} onValueChange={value => actions.setActionTarget(value as "relay" | "host")}>
                <DropdownMenuRadioItem value="relay">This computer (Relay)</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="host">{actions.disableBackendOpen ? "Browser" : "Panoptikon server host"}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup> : <>
                <DropdownMenuItem disabled>{actions.disableBackendOpen ? "Browser" : "Panoptikon server host"}</DropdownMenuItem>
                <DropdownMenuItem onSelect={actions.pairRelay}>Pair local Relay…</DropdownMenuItem>
            </>}
        </DropdownMenuContent>
    </DropdownMenu>
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
    const buttonTitle = disableBackendOpen ? "Open file in new tab" : "Open file with your system's default application"
    return (
        <>
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
                    className="hover:scale-105 absolute bottom-3 left-1 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
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
            <RelayTargetSelector actions={actions} floatingClass={buttonVariant ? undefined : "absolute bottom-10 left-7 bg-white opacity-0 group-hover:opacity-100"} />
        </>
    )
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
        return (
            <><FindButton id={sha256} id_type="sha256" path={path || ""} buttonVariant={buttonVariant} buttonClassName={!buttonVariant ? "bottom-3 left-12" : undefined} />
            <RelayTargetSelector actions={actions} floatingClass={buttonVariant ? undefined : "absolute bottom-10 left-16 bg-white opacity-0 group-hover:opacity-100"} /></>
        )
    }
    return (<>
        buttonVariant ?
            <Button
                title="Show file in folder"
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
                className="hover:scale-105 absolute bottom-3 left-12 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    className="w-6 h-6 text-gray-800"
                >
                    <path d="M10 4H4c-1.1 0-2 0.9-2 2v12c0 1.1 0.9 2 2 2h16c1.1 0 2-0.9 2-2V8c0-1.1-0.9-2-2-2h-8l-2-2z" />
                </svg>
            </button>
        <RelayTargetSelector actions={actions} floatingClass={buttonVariant ? undefined : "absolute bottom-10 left-16 bg-white opacity-0 group-hover:opacity-100"} />
    </>)
}

export const FilePathComponent = ({ path }: { path: string }) => {
    const { toast } = useToast()
    const handleCopyToClipboard = (text: string) => {
        // This is necessary to prevent the browser from adding file:// to the path
        const blob = new Blob([text], { type: 'text/plain' })
        const data = [new ClipboardItem({ 'text/plain': blob })]
        navigator.clipboard.write(data).then(() => {
            toast({
                title: "Path copied to clipboard",
                description: text,
                duration: 2000,
            })
        }).catch((err) => {
            console.error('Failed to copy text: ', err)
            toast({
                title: "Failed to copy path to clipboard",
                description: err.message,
                variant: "destructive",
                duration: 2000,
            })
        })
    }
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
