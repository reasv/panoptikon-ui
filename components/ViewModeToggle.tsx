"use client"

import { ChevronDown, Files, Infinity as InfiniteScroll } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToast } from "@/components/ui/use-toast"
import { useViewMode } from "@/lib/state/gallery"
import { useCommitViewMode } from "@/lib/searchHooks"
import { usePageSize } from "@/lib/state/searchQuery/clientHooks"
import {
    clearUserDefaults,
    saveUserDefaults,
    searchDefaultableLabels,
} from "@/lib/searchDefaults"

/**
 * The paged/scroll switch, and the menu that saves the current presentation
 * as what NEW searches start with.
 *
 * Lives in the results header's right-hand cell beside the pinboard-library
 * button rather than in the pagination footer (design §5, delta 5): the
 * header renders whenever the grid does, so a short result set — which has
 * no pagination bar at all — can still switch modes, and the footer keeps
 * its symmetry and its full width on narrow viewports.
 */
export function ViewModeToggle() {
    const [viewMode] = useViewMode()
    // Not a plain `vm` write: the switch carries the user's position across
    // the two coordinate systems and prefetches the page it lands on when
    // entering pages mode (see useCommitViewMode). It also holds its own
    // supersession token, so a second click during the first one's prefetch
    // is already handled — nothing to guard here.
    const commitViewMode = useCommitViewMode()
    const pageSize = usePageSize()
    const { toast } = useToast()
    const scrollMode = viewMode === "scroll"
    return (
        <>
            {/* The icon shows the mode you are IN; the tooltip says what a
                click does. Files (offset sheets) for pages, an infinity sign
                for the continuous set — two silhouettes with nothing in
                common, and neither of them another book to confuse with the
                LibraryBig beside it. */}
            <Button
                variant="ghost"
                size="icon"
                title={scrollMode
                    ? "Switch to paged browsing"
                    : "Switch to scroll browsing"}
                aria-label={scrollMode
                    ? "Switch to paged browsing"
                    : "Switch to scroll browsing"}
                onClick={() => void commitViewMode(scrollMode ? "pages" : "scroll")}
            >
                {scrollMode
                    ? <InfiniteScroll className="h-5 w-5" />
                    : <Files className="h-5 w-5" />}
            </Button>
            <DropdownMenu>
                {/* A narrow caret rather than a second icon button: it is an
                    appendage of the toggle, not a peer of it, and the width
                    of a full icon button here would push the header's right
                    cluster around. Same chevron affordance as the pinboard
                    tab's menu. */}
                <DropdownMenuTrigger asChild>
                    <button
                        title="Browsing defaults"
                        aria-label="Browsing defaults"
                        // h-10 matches the ghost icon button beside it, so the
                        // caret is a full-height click target rather than the
                        // 16px its glyph would give it in a centered row
                        className="inline-flex h-10 shrink-0 items-center justify-center rounded-sm px-1 transition-colors hover:bg-foreground/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <ChevronDown className="h-4 w-4" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                    {/* User layer of the creation-defaults system (see
                        lib/searchDefaults.ts): Save captures the current
                        presentation as what a NEW search session starts
                        with. ONE action for both parameters — the gesture is
                        "start my searches looking like this", and a mode
                        saved without the page size it was chosen at is half
                        an answer. This search — and every URL that already
                        exists — is never touched: defaults apply only when a
                        load with no presentation parameters creates a
                        session. */}
                    <DropdownMenuItem
                        onClick={() => {
                            saveUserDefaults({ vm: viewMode, page_size: pageSize })
                            toast({
                                // Named from the registry, so a parameter
                                // added there can't quietly go unmentioned
                                // here.
                                description: "New searches will start with this"
                                    + ` view's current ${searchDefaultableLabels()
                                        .join(" and ")} settings.`,
                                title: "Search Defaults Saved",
                                duration: 4000,
                            })
                        }}
                    >
                        Save current view as default
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {/* Not styled with DESTRUCTIVE_MENU_ITEM, deliberately:
                        this drops a preference that one click of the row
                        above restores, which is the same weight as the
                        pinboard's "Reset to Built-in Defaults". The
                        destructive fill is reserved for rows that lose
                        content (removing pins, deleting a board). */}
                    <DropdownMenuItem
                        onClick={() => {
                            clearUserDefaults()
                            toast({
                                title: "Built-in Defaults Restored",
                                description: "New searches will start with the"
                                    + " app's built-in settings again.",
                                duration: 4000,
                            })
                        }}
                    >
                        Clear saved defaults
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    )
}
