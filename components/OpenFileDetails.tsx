"use client"
import { createContext, useCallback, useContext } from "react"
import { BookOpen, Book } from "lucide-react"
import { useQueryStates } from "nuqs"
import { toast } from "@/components/ui/use-toast"
import { Button } from './ui/button'
import { components } from "@/lib/panoptikon"
import { Toggle } from "./ui/toggle"
import { useItemSelection } from "@/lib/state/itemSelection"
import { sideBarOpenParser, sideBarTabParser } from "@/lib/state/sideBar"
import { gsbParser } from "@/lib/state/gallery"
import { useSearchOverlayReveal } from "@/lib/state/searchOverlayReveal"

export function itemEquals(a: SearchResult, b: SearchResult) {
    return a.file_id === b.file_id
}

/** The per-item Data View is tab 1 of whichever sidebar is mounted. */
const DATA_VIEW_TAB = 1

// The keyMap the routing hook below reads. Module-level so the object
// identity is stable across renders — nuqs memoises its resolved url keys on
// the key list, and a fresh literal per render would defeat that.
//
// THREE SHORT KEYS, and the count is the point. See usePaneRouting's
// per-row note: nothing that changes size with the board may be read from
// here.
const DATA_VIEW_KEY_MAP = {
    gsb: gsbParser,
    sb: sideBarOpenParser,
    sbt: sideBarTabParser,
}

/**
 * "Is the pinboard maximized right now", PUBLISHED ONCE by MultiSearchView
 * (app/search/SearchPage.tsx), which already computes it for its own render.
 *
 * The routing hook below needs the answer on every grid card and every pin,
 * and deriving it per row is what must not happen: the predicate reads
 * `pinboard`, the app's longest URL parameter (five entries per pin), and
 * nuqs rebuilds a sync key by string-joining `searchParams.getAll(urlKey)`
 * IN THE HOOK BODY on EVERY render of EVERY instance. Sixty grid cards or a
 * hundred pins × the whole layout string, per render pass, on a surface
 * already recorded as a grid performance bottleneck. Reading it from the one
 * component that has it costs nothing per row.
 *
 * CONTEXT rather than a store, and the reason is staleness. A store written
 * from an effect is one commit behind the URL, and a value that is briefly
 * wrong here routes a press to the pane that is NOT on screen — `sb=true`
 * written into a maximized workspace opens nothing and strands the page
 * sidebar for the restore. Context carries the value in the SAME render pass
 * that computed it, so there is no window at all: the value a click reads is
 * the value that was painted. It also propagates through memo boundaries,
 * which the per-row components sit behind.
 *
 * The default is `false` — the page's own <SideBar/>, the legacy behavior —
 * so a consumer mounted outside the maximized workspace's provider (there
 * are none today) degrades to what it did before any of this existed.
 */
const PinboardMaximizedContext = createContext(false)
export const PinboardMaximizedProvider = PinboardMaximizedContext.Provider

/**
 * THE one decision about which details pane exists right now, and how to
 * show and hide it. Two surfaces answer to "open the Data View" and they
 * are driven by different state, so every control that opens one — the
 * OpenDetailsButton below, the pinboard's corner SelectButton on a
 * re-click — goes through this hook rather than branching for itself.
 *
 *   - NOT MAXIMIZED: the page's own <SideBar/>, driven by `sb`. This is
 *     every grid card and the page gallery, and nothing about them changes:
 *     the hook's page branch writes exactly the `sb` + `sbt` pair those
 *     call sites always wrote.
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
 * WHAT THIS HOOK MAY READ, and it is a hard budget. Both consumers render
 * PER RESULT ROW — OpenDetailsButton on every grid card
 * (components/SearchResultImage.tsx), SelectButton on every pin
 * (components/gallery/GalleryPinBoard.tsx) — so a 60-card grid or a 100-pin
 * board multiplies whatever this hook costs by that.
 *
 * ONE `useQueryStates` over THREE SHORT KEYS (`gsb`, `sb`, `sbt`). Separate
 * `useQueryState`s would be one `useId`, one `useState`, one set of refs and
 * effects and one emitter subscription EACH; folding them into a single
 * keyMap over the same shared parser objects keeps the wire format identical
 * (each parser carries its own history and clearOnDefault, which
 * useQueryStates honours per key) at one subscription.
 *
 * The keys' LENGTH matters as much as their number, and that is the trap
 * this budget exists for. nuqs recomputes a `searchParamsSyncKey` in the
 * hook body on every render by string-joining
 * `searchParams.getAll(urlKey)` for every key in the map. A consolidated map
 * that included the five board-maximize keys therefore had every card and
 * every pin copy and compare `pinboard` — the app's longest parameter, a
 * multi-kilobyte comma-joined layout string — once per instance per render
 * pass. Consolidation had removed the per-hook overhead and left the
 * expensive read in place. `pinboard` is now never read from here at all:
 * the maximize decision arrives through PinboardMaximizedContext above,
 * computed once by the component that already had it.
 *
 * For the same reason the toast is the STANDALONE `toast()` export rather
 * than `useToast().toast`: the hook form registers a listener on the shared
 * toast store per mount, so it was 60+ extra listeners re-registering on
 * every toast. The standalone function drives the same store with no
 * subscription, and nothing here renders a toast.
 *
 * So: the whole routing decision lives HERE, in one nuqs subscription, and
 * the two exported hooks below are thin views over it. Neither may call the
 * other — a caller would then hold two `useQueryStates` instances and the
 * saving above would be undone.
 */
function usePaneRouting() {
    const [params, setParams] = useQueryStates(DATA_VIEW_KEY_MAP)
    const setOverlayOpen = useSearchOverlayReveal((s) => s.setSidebarRevealed)
    const setSelected = useItemSelection((state) => state.setItem)
    const maximized = useContext(PinboardMaximizedContext)
    const overlayPinned = params.gsb

    const setPaneOpen = useCallback((open: boolean) => {
        if (!maximized) {
            void setParams({ sb: open })
            return
        }
        setOverlayOpen(open)
        // Closing means GONE, so the pin goes with it (see above).
        if (!open && overlayPinned) void setParams({ gsb: false })
    }, [maximized, overlayPinned, setParams, setOverlayOpen])

    /**
     * Show the Data View. Passing an item selects it first (the pane paints
     * the CURRENT selection); omitting one — the re-clicked checkbox, whose
     * item is already the selection — leaves it alone.
     *
     * The selection write is unconditional: the selection store's own
     * setItem bails when the incoming item is itemEquals to the current one,
     * so the "is this already selected" guard that used to sit here (and
     * compared by reference, which is weaker) was doing nothing the store
     * does not.
     */
    const openDataView = useCallback((item?: SearchResult) => {
        if (item) setSelected(item)
        setPaneOpen(true)
        void setParams({ sbt: DATA_VIEW_TAB })
        toast({
            title: "Opening File Details",
            description: "You can find all data associated with the item here",
            duration: 3000
        })
    }, [setSelected, setPaneOpen, setParams])

    const closeDataView = useCallback(() => setPaneOpen(false), [setPaneOpen])

    return { params, maximized, openDataView, closeDataView }
}

export function useDataViewPane() {
    const { params, maximized, openDataView, closeDataView } = usePaneRouting()
    const overlayOpen = useSearchOverlayReveal((s) => s.sidebarRevealed)

    const paneOpen = maximized ? overlayOpen || params.gsb : params.sb

    return {
        /** Is a details pane on screen at all? */
        paneOpen,
        /** Is the pane on screen AND showing the per-item Data View? */
        dataViewOpen: paneOpen && params.sbt === DATA_VIEW_TAB,
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
