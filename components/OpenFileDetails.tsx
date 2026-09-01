"use client"
import { BookOpen, Book } from "lucide-react"
import { Button } from './ui/button'
import { Toggle } from "./ui/toggle"
import { useItemSelection } from "@/lib/state/itemSelection"
import { useCellCallbacks, useCellFlags } from "@/lib/state/cellActions"

export function itemEquals(a: SearchResult, b: SearchResult) {
    return a.file_id === b.file_id
}

/**
 * THE one decision about which details pane exists right now, and how to
 * show and hide it. Two surfaces answer to "open the Data View" and they
 * are driven by different state, so every control that opens one — the
 * OpenDetailsButton below, the pinboard's corner SelectButton on a
 * re-click — goes through this hook rather than branching for itself.
 *
 *   - NOT MAXIMIZED: the page's own <SideBar/>, driven by `sb`. This is
 *     every grid card and the page gallery.
 *   - MAXIMIZED: the page sidebar is NOT mounted (SearchPageContent gates
 *     it on `!pinboardMaximized`) and the left-edge SidebarOverlay shows
 *     the tabs instead. Writing `sb` from inside a maximized workspace
 *     opens nothing, flips the button to "Close Data View" on the second
 *     press, and strands `sb=true` so the page sidebar pops open on
 *     restore. The tab param (`sbt`) is shared by both mounts, so only the
 *     open flag needs redirecting.
 *
 * The maximized branch drives that dock's SHOWN state, which is
 * `open || pinned` — ephemeral open in the client store, `gsb` the pin
 * (docs/maximized-pinboard-search-overlay-design.md §9). Two consequences
 * are deliberate and were both bugs when this pointed at the pin alone:
 *
 *   - opening sets the EPHEMERAL flag, so a Data View opened for one look
 *     dismisses like any other open dock (Esc, a click outside) instead of
 *     writing a URL flag that outlives the glance;
 *   - closing clears the ephemeral flag AND unpins. Otherwise "Close Data
 *     View" over a pinned sidebar is a dead button — the panel stays up,
 *     because `pinned` alone still satisfies `shown`.
 *
 * `open` is therefore the SHOWN state, not the pin, which is what makes the
 * button's own open/close labelling truthful.
 *
 * WHERE THE STATE LIVES, and it is a hard budget. Both consumers render PER
 * RESULT ROW — OpenDetailsButton on every grid card
 * (components/SearchResultImage.tsx), SelectButton on every pin
 * (components/gallery/GalleryPinBoard.tsx) — so a 60-card grid or a 100-pin
 * board multiplies whatever this hook costs by that. It therefore owns NO
 * hooks of its own: `sb`/`sbt`/`gsb`, the ephemeral open flags, the
 * maximize decision and the selection write are all held by the page's one
 * CellActionsHost, and this is a view over what it publishes
 * (lib/state/cellActions.ts). Reading the callbacks costs nothing at all —
 * that context's value never changes identity — while the two booleans below
 * are exactly the render inputs these buttons always had.
 *
 * The maximize decision in particular must never be derived per row: the
 * predicate reads `pinboard`, the app's longest URL parameter (five entries
 * per pin), and nuqs rebuilds a sync key by string-joining
 * `searchParams.getAll(urlKey)` in the hook body on EVERY render of EVERY
 * instance.
 */
export function useDataViewPane() {
    const { paneOpen, dataViewOpen } = useCellFlags()
    const { openDataView, closeDataView } = useCellCallbacks()
    return {
        /** Is a details pane on screen at all? */
        paneOpen,
        /** Is the pane on screen AND showing the per-item Data View? */
        dataViewOpen,
        /**
         * Show the Data View. Passing an item selects it first (the pane
         * paints the CURRENT selection); omitting one — the re-clicked
         * checkbox, whose item is already the selection — leaves it alone.
         */
        openDataView,
        /** Hide the pane entirely. */
        closeDataView,
    }
}

export function OpenDetailsButton({
    item,
    variantButton,
    className,
}: {
    item?: SearchResult,
    variantButton?: boolean
    /**
     * Extra classes for the TOGGLE form only — the button form already paints
     * itself a white pill for a hover overlay. It exists for the maximized
     * board's viewer header, which is chrome laid over arbitrary picture
     * content and therefore has to recolour its controls the way
     * VideoPlayerSurface does (white over a scrim). Every other mount passes
     * nothing and is untouched.
     */
    className?: string
}) {
    // Which pane this opens is not this component's business — see the hook.
    // It used to be a `target` prop the maximized viewer header passed down,
    // which meant the ONE call site that knew about the override was the only
    // one that got it; the corner SelectButton needed the same knowledge and
    // could not be handed a prop from where it lives.
    const { dataViewOpen, openDataView, closeDataView } = useDataViewPane()
    const selectedItem = useItemSelection((state) => state.getSelected())

    const itemDetailsOpen =
        !!item && !!selectedItem && itemEquals(selectedItem, item) && dataViewOpen

    const onClick = () => {
        if (itemDetailsOpen) {
            closeDataView()
        } else {
            openDataView(item)
        }
    }
    return (
        variantButton ? (
            <Button
                onClick={() => onClick()}
                title={!itemDetailsOpen ? "Open in Data View" : "Close Data View"}
                aria-label={!itemDetailsOpen ? "Open in Data View" : "Close Data View"}
                className="hover:scale-105 absolute bottom-2 right-2 bg-white rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.35)] p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                size="icon"
            >
                {itemDetailsOpen ? <Book className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}
            </Button>
        ) : (
            <Toggle
                pressed={itemDetailsOpen}
                onClick={() => onClick()}
                title={!itemDetailsOpen ? "Open Data View" : "Close Data View"}
                aria-label={!itemDetailsOpen ? "Open Data View" : "Close Data View"}
                className={className}
            >
                <BookOpen className="h-4 w-4" />
            </Toggle>
        )

    )
}
