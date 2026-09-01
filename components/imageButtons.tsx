"use client"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { $api } from "@/lib/api"
import { File, FolderOpen, BookmarkPlus, BookmarkX, Cable, ClipboardCopy, Download, LoaderCircle } from "lucide-react"
import { Button } from "./ui/button"
import { Toggle } from "./ui/toggle"
import { cn } from "@/lib/utils"
import { toast } from "@/components/ui/use-toast"
import { FindButton } from "./gallery/FindButton"
import { FileBookmarksSetter } from "./sidebar/details/FileBookmarks"
import { ContextMenu, ContextMenuContent, ContextMenuLabel, ContextMenuRadioGroup, ContextMenuRadioItem, ContextMenuTrigger } from "./ui/context-menu"
import { useFileShare } from "@/hooks/fileShare"
import { useLastFileAction, type FileActionVerb } from "@/lib/state/fileActionDefault"
import { useCellCallbacks, useCellFlags } from "@/lib/state/cellActions"

// EVERY component in this file is mounted PER ROW — per grid cell, per pin,
// per filmstrip card — so none of them may own a URL-state hook, a toast
// listener or a query/mutation observer of its own. They read the page's one
// CellActionsHost instead (lib/state/cellActions.ts): `useCellCallbacks` for
// the verbs (a value whose identity never changes, so reading it re-renders
// nothing) and `useCellFlags` for the handful of values they actually paint.
//
// The overlay pills below are SIZED BY THE CARD THEY SIT ON, through the
// `--cell-chrome-*` ramp in app/globals.css (D11): `p-2` became
// `p-(--cell-chrome-pad)`, `w-6 h-6` became `--cell-chrome-glyph`, and the
// corner offsets became `--cell-chrome-inset`. At the ramp's top — which is
// every surface that publishes no `--cell-px`, i.e. everything but the result
// grid — those resolve to exactly the numbers they replaced, so the filmstrip
// and the pinboard are untouched. Only the button GEOMETRY rides the ramp; the
// hover fades, the focus behaviour and the slot order are unchanged.

export function RelayTargetSelector() {
    const { relayDetected, relayPaired, relayPairing, relayPairingPending } = useCellFlags()
    const { pairRelay } = useCellCallbacks()
    if (!relayDetected || relayPaired) return null
    const pairLabel = relayPairing
        ? "Opening Relay pairing…"
        : relayPairingPending ? "Review Relay pairing request" : "Pair local Relay"
    return <Button
        aria-label={pairLabel}
        title={pairLabel}
        variant="ghost"
        size="icon"
        className="invisible absolute -bottom-1 -right-1 z-10 h-4 w-4 rounded-full border border-border bg-background p-0 text-foreground opacity-0 shadow-xs transition-opacity group-hover/file-action:visible group-hover/file-action:opacity-100 group-focus-within/file-action:visible group-focus-within/file-action:opacity-100"
        disabled={relayPairing}
        onClick={() => void pairRelay()}
    >
        <Cable className="h-2.5 w-2.5" />
    </Button>
}

function FileActionTargetMenu({
    existingLabel,
    children,
}: {
    existingLabel: string
    children: (open: boolean) => ReactNode
}) {
    const { relayPaired, actionTarget } = useCellFlags()
    const { setActionTarget } = useCellCallbacks()
    const [open, setOpen] = useState(false)
    const trigger = children(open)
    if (!relayPaired) return trigger
    return <ContextMenu onOpenChange={setOpen}>
        <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
        <ContextMenuContent className="min-w-52">
            <ContextMenuLabel>File action destination</ContextMenuLabel>
            <ContextMenuRadioGroup value={actionTarget} onValueChange={value => setActionTarget(value as "relay" | "existing")}>
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
    const { dbs: query, bookmarkNamespace: namespace, alwaysShowBookmark: alwaysShow } = useCellFlags()
    const { toggleBookmark } = useCellCallbacks()
    // The prop gates the query at render time, so a fresh page of enriched
    // results can never fire a per-card volley (an effect-seeded store
    // cannot make that guarantee — children render before parent effects).
    const { data } = $api.useQuery(
        "get",
        "/api/bookmarks/ns/{namespace}/{sha256}",
        {
            params: { path: { namespace, sha256 }, query },
        },
        {
            enabled: bookmarked == null,
        },
    )

    const isBookmarked = bookmarked ?? (data?.exists || false)
    // The mutations, the cache patch and the toast all live in the host: a
    // card that has never been clicked has no business holding two mutation
    // observers and a toast listener.
    const handleBookmarkClick = () => toggleBookmark(sha256, isBookmarked)
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
            className={cn("hover:scale-105 absolute top-(--cell-chrome-inset) right-(--cell-chrome-inset) bg-white rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.35)] p-(--cell-chrome-pad) opacity-0 group-hover:opacity-100 transition-opacity duration-300",
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
                    className="w-(--cell-chrome-glyph) h-(--cell-chrome-glyph) text-gray-800"
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
                    className="w-(--cell-chrome-glyph) h-(--cell-chrome-glyph) text-gray-800"
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
    const { disableBackendOpen, relayPaired, actionTarget } = useCellFlags()
    const { openFile } = useCellCallbacks()
    const handleClick = () => openFile({ sha256, path })
    const buttonTitle = relayPaired && actionTarget === "relay"
        ? "Open file on this computer using Relay"
        : disableBackendOpen ? "Open file in new tab" : "Open file on the Panoptikon server host"
    return <FileActionTargetMenu
        existingLabel={disableBackendOpen ? "Browser" : "Panoptikon server host"}
    >{menuOpen => <span
        onClickCapture={onUsed}
        className={cn(
            "relative inline-flex group/file-action",
            !buttonVariant && (overlayClassName ?? "absolute bottom-(--cell-chrome-fan) left-(--cell-chrome-fan-x) opacity-0 transition-opacity duration-300 group-hover:opacity-100"),
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
                    className="rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.35)] p-(--cell-chrome-pad) hover:scale-105"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                        className="w-(--cell-chrome-glyph) h-(--cell-chrome-glyph) text-gray-800"
                    >
                        <path d="M14 2H6C4.9 2 4 2.9 4 4v16c0 1.1 0.9 2 2 2h12c1.1 0 2-0.9 2-2V8l-6-6zm1 7V3.5L18.5 9H15z" />
                    </svg>
                </button>}
            <RelayTargetSelector />
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
    const { disableBackendOpen, relayPaired, actionTarget } = useCellFlags()
    const { showInFolder } = useCellCallbacks()
    const handleClick = () => showInFolder({ sha256, path })
    if (disableBackendOpen && !(relayPaired && actionTarget === "relay")) {
        return <FileActionTargetMenu existingLabel="Panoptikon search">
            {menuOpen => <span
            onClickCapture={onUsed}
            className={cn(
            "relative inline-flex group/file-action",
            !buttonVariant && (overlayClassName ?? "absolute bottom-(--cell-chrome-fan) left-[calc(var(--cell-chrome-fan-x)+var(--cell-chrome-step))] opacity-0 transition-opacity duration-300 group-hover:opacity-100"),
            !buttonVariant && menuOpen && "opacity-100 pointer-events-auto",
        )}>
            <FindButton
                id={sha256}
                id_type="sha256"
                path={path || ""}
                buttonVariant={buttonVariant}
                buttonClassName={!buttonVariant ? "static opacity-100" : undefined}
            />
            <RelayTargetSelector />
        </span>}
        </FileActionTargetMenu>
    }
    return <FileActionTargetMenu existingLabel="Panoptikon server host">
        {menuOpen => <span
        onClickCapture={onUsed}
        className={cn(
        "relative inline-flex group/file-action",
        !buttonVariant && (overlayClassName ?? "absolute bottom-(--cell-chrome-fan) left-[calc(var(--cell-chrome-fan-x)+var(--cell-chrome-step))] opacity-0 transition-opacity duration-300 group-hover:opacity-100"),
        !buttonVariant && menuOpen && "opacity-100 pointer-events-auto",
    )}>
        {buttonVariant ?
            <Button
                title={relayPaired && actionTarget === "relay" ? "Show file on this computer using Relay" : "Show file on the Panoptikon server host"}
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
                className="rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.35)] p-(--cell-chrome-pad) hover:scale-105"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    className="w-(--cell-chrome-glyph) h-(--cell-chrome-glyph) text-gray-800"
                >
                    <path d="M10 4H4c-1.1 0-2 0.9-2 2v12c0 1.1 0.9 2 2 2h16c1.1 0 2-0.9 2-2V8c0-1.1-0.9-2-2-2h-8l-2-2z" />
                </svg>
            </button>}
        <RelayTargetSelector />
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
// beside, diagonal]. Buttons are 2.5rem circles and every gap is 0.25rem —
// which is the 2.75rem `--cell-chrome-step` the offsets below are built from —
// and each anchor matches the button inset convention of the surface it serves
// (the search grid's bottom-left, the gallery filmstrip's bottom-right).
//
// EVERY OFFSET RIDES THE RAMP (D11), because the fanout is the piece of chrome
// that fails LOUDLY at small cells: it opens two buttons up and two across, so
// on a 140px card an unscaled square reaches the opposite corners and covers
// the buttons already sitting in them. Scaling the step with the button is
// what keeps the square a square, which is why each offset is computed from
// the step rather than restated as a number.
const CLUSTER_SLOTS = {
    "bottom-left": [
        "absolute bottom-(--cell-chrome-fan) left-(--cell-chrome-fan-x)",
        "absolute bottom-[calc(var(--cell-chrome-fan)+var(--cell-chrome-step))] left-(--cell-chrome-fan-x)",
        "absolute bottom-(--cell-chrome-fan) left-[calc(var(--cell-chrome-fan-x)+var(--cell-chrome-step))]",
        "absolute bottom-[calc(var(--cell-chrome-fan)+var(--cell-chrome-step))] left-[calc(var(--cell-chrome-fan-x)+var(--cell-chrome-step))]",
    ],
    "bottom-right": [
        "absolute bottom-(--cell-chrome-inset) right-(--cell-chrome-inset)",
        "absolute bottom-[calc(var(--cell-chrome-inset)+var(--cell-chrome-step))] right-(--cell-chrome-inset)",
        "absolute bottom-(--cell-chrome-inset) right-[calc(var(--cell-chrome-inset)+var(--cell-chrome-step))]",
        "absolute bottom-[calc(var(--cell-chrome-inset)+var(--cell-chrome-step))] right-[calc(var(--cell-chrome-inset)+var(--cell-chrome-step))]",
    ],
} as const

// The grid card's file actions, collapsed to ONE button: the last-used verb
// (persisted). Hovering it — or tabbing into the cluster — expands the other
// verbs into the 2x2 corner square, alternates above/beside and the last one
// diagonal. Copy participates only where the host resolves a native copy path
// (`canCopy`); without one the set is three and the diagonal slot stays empty
// (a remembered Copy corner degrades to Download, like the old adaptive
// button).
export const FileActionCluster = ({ sha256, path, anchor = "bottom-left" }: {
    sha256: string
    path?: string
    anchor?: keyof typeof CLUSTER_SLOTS
}) => {
    const { canCopy } = useCellFlags()
    const { shareFile, downloadFile } = useCellCallbacks()
    const lastVerb = useLastFileAction((state) => state.verb)
    const setLastVerb = useLastFileAction((state) => state.setVerb)
    const [expanded, setExpanded] = useState(false)
    // Which share verb is mid-flight: only that button spins, and it stays
    // pinned visible for a copy that spends minutes materializing.
    const [busyVerb, setBusyVerb] = useState<"copy" | "download" | null>(null)
    const inFlight = useRef(false)
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

    // `busyVerb` is also the in-flight guard, which is why the buttons below
    // disable on it: a relay copy of a multi-GB file spends minutes
    // materializing, and a second click would start a whole second transfer.
    // Per cluster rather than per page — one card's copy must not disable
    // every other card's buttons — which is why the host's share verbs carry
    // no guard of their own (hooks/fileShare.ts).
    const runShare = async (verb: "copy" | "download") => {
        // The ref is the real guard (synchronous, so two clicks in the same
        // tick cannot both pass); `busyVerb` is what the buttons render.
        if (inFlight.current) return
        inFlight.current = true
        setLastVerb(verb)
        setBusyVerb(verb)
        try {
            if (verb === "copy") await shareFile({ sha256, path })
            else await downloadFile({ sha256, path })
        } finally {
            inFlight.current = false
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
            disabled={busyVerb !== null}
            className={cn(
                "rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.35)] p-(--cell-chrome-pad) hover:scale-105",
                position(verb),
                busy && "opacity-100 pointer-events-auto cursor-progress",
            )}
        >
            <Icon className={cn("w-(--cell-chrome-glyph) h-(--cell-chrome-glyph) text-gray-800", busy && "animate-spin")} />
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
//
// A module-level function, and the standalone `toast()`: FilePathComponent
// below is mounted per grid card, and `useToast()` registers a listener on the
// shared toast store per mount — re-registering it on every toast, its effect
// being keyed on the toast state. Nothing here renders a toast.
export const copyPathToClipboard = (text: string) => {
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

/** Hook-shaped view of the above, for the call sites that read like one. */
export const useCopyPath = () => copyPathToClipboard

export const FilePathComponent = ({ path }: { path: string }) => {
    const handleCopyToClipboard = copyPathToClipboard
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
