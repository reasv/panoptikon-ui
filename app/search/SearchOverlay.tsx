"use client"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ChevronUp, Pin, Search, X } from "lucide-react"
import type { ReadonlyURLSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { Toggle } from "@/components/ui/toggle"
import { Button } from "@/components/ui/button"
import { PageSelect, type PageIndicator } from "@/components/pageselect"
import { ViewModeToggle } from "@/components/ViewModeToggle"
import { VirtualGalleryHorizontalScroll } from "@/components/gallery/VirtualizedHorizontalScroll"
import { useDelayedHover } from "@/components/gallery/PinboardPreviewPopover"
import { PreviewSurface, useViewerItem, viewerPosition } from "./PreviewSurface"
import { SearchBarRow } from "./SearchBarRow"
import { DockHandle, isPanelBackground, useDockDismiss } from "./dockChrome"
import {
    useGalleryIndex,
    useGalleryNavigate,
    useSearchOverlayOpen,
    useSearchViewerOpen,
    useSidebarOverlayOpen,
} from "@/lib/state/gallery"
import { useSearchOverlayReveal } from "@/lib/state/searchOverlayReveal"
import type { ResultsSource } from "@/lib/searchHooks"
import { components } from "@/lib/panoptikon"

// The maximized board's bottom search overlay
// (docs/maximized-pinboard-search-overlay-design.md §5.1). Search chrome,
// not board chrome: it is mounted by MultiSearchView, where every value it
// needs is already in scope, never inside PinBoard — and it mounts for the
// WHOLE maximized session. Visibility is the dock's own affair:
// `shown = open || pinned`, where `open` is ephemeral client state
// (lib/state/searchOverlayReveal.ts) and `pinned` is `gso` in the URL.
//
// CLICK-TO-OPEN, not hover. The dock is opened by clicking one of THREE
// always-visible edge handles — bottom-center, left-center, right-center —
// and nothing else on the screen edge is hot. Three because one is not
// enough: an auto-hide taskbar pops over the browser at the bottom edge and
// steals the gesture there, and side handles are out of its reach. On a
// board with everything closed these are the ONLY edge controls, and all
// three open THIS dock (§5.1): the sidebar is not an entry point from a
// cold board, so its handle appears only once this panel is shown (§9). The
// handles
// highlight on hover but never open on it (see DockHandle in dockChrome.tsx
// for why that signalling matters, and for the hot bands this replaced).
//
// Dismissal of an open, UNPINNED panel: Esc, a click outside it, or the
// panel's own X (the handles are covered by the open panel, so the panel
// must carry its own close affordance). Rules in useDockDismiss — including
// why the outside dismissal listens for `click` and not `pointerdown`, and
// how Esc peels the sidebar first and this dock second.
//
// Pinning, and ONLY these: the pin toggle, Ctrl+Shift+F (registered by
// MultiSearchView), and a double-click on genuine panel background. Single
// background clicks are INERT. There is no auto-pin from pointer or
// keyboard: the old pointerdown auto-pin silently upgraded the panel to a
// state that looked identical and only behaved differently several clicks
// later, so the panel was pinned the moment you used it — which defeated
// the transient reveal it was supposed to protect.
//
// Visibility depends on neither pointer nor focus, which is what deleted
// the hoverBand/hoverPanel/focusWithin machinery AND the problem it was
// patching: a Radix dropdown portaling focus out of the panel used to fade
// the panel out from under its own open menu, and the keyboard/pointer
// auto-pins existed largely to prevent that. Nothing replaced them.
//
// Hiding is CSS-only (translate/opacity + pointer-events-none + `inert`):
// the panel and its contents stay MOUNTED for the whole maximized session.
// This is load-bearing, not a styling choice — a strip card serving as the
// HTML5 drag source must survive its own panel hiding mid-drag by whatever
// path remains (Esc, an outside click). Never convert the hide to a
// conditional unmount (design §5.1). `inert` is compatible with that rule
// and necessary alongside it: it removes the hidden panel from the TAB ORDER
// and from hit-testing, which the three CSS properties do not, without
// unmounting anything or cancelling a drag already in flight.
// Drags themselves need no special case any more:
// nothing hides on pointer exit, so dragging out of an OPEN unpinned panel
// leaves it open and multi-item drag sessions work unpinned.
//
// Pointer-events follow the toolbar's SHOW pattern only: the hidden panel
// is pointer-events-none (an invisible fixed panel must not eat board
// clicks near the bottom edge) and becomes interactive when shown. What is
// NOT replicated is the toolbar's always-auto piercing of modal-locked
// bodies and the exclusive-menu-slot machinery it necessitates: an open
// panel no longer depends on focus or pointer to stay up, so Radix modal
// layers may disable it along with the rest of the body while a menu is
// open — correct dismiss behavior. Menus inside the overlay work exactly as
// they do on the normal page (§5.1).
export function SearchOverlay({
    onRefresh,
    isFetching,
    nResults,
    resultMetrics,
    countMetrics,
    source,
    count,
    countSettled,
    resultsAreStale,
    scrollMode,
    fallbackAnchor,
    onDerivedPageChange,
    pageSize,
    totalPages,
    currentPage,
    setPage,
    getPageURL,
    largeImageHosted,
}: {
    onRefresh: () => void
    isFetching: boolean
    nResults: number
    resultMetrics?: components["schemas"]["SearchMetrics"]
    countMetrics?: components["schemas"]["SearchMetrics"]
    /** The same rows grid and gallery read — see ResultsSource. */
    source: ResultsSource
    /** The navigable extent — MultiSearchView's itemCount. */
    count: number
    /**
     * The same two the gallery takes, for the same two reasons, forwarded to
     * the viewer: an unsettled count means `count` is the loaded extent and
     * not the set, and stale results mean the rows do not answer the URL yet.
     * The dock's own surfaces (strip, pagination) are unaffected by either.
     */
    countSettled: boolean
    resultsAreStale: boolean
    /** `vm === "scroll"` — gates the anchor half of useGalleryNavigate. */
    scrollMode: boolean
    /**
     * Scroll mode: the grid scroll anchor, so a scrubber click with `gi`
     * null still moves the strip (design §5.3 — `setVirtualPage` keeps `gi`
     * null while the gallery is closed, so `top` is the only position the
     * click writes). Null in pages mode, where `top` is a within-page index
     * the grid owns and means nothing to the strip.
     */
    fallbackAnchor: number | null
    /**
     * Scroll mode: the host's derived-page write, stable by construction
     * (a box member minted once per mount, lib/state/derivedPage.ts) — the
     * strip's scroll listener depends on it (§6).
     */
    onDerivedPageChange?: (page: number) => void
    /** k, the virtual-page size, for the strip's derived page number. */
    pageSize: number
    // The pagination row: the exact four-prop switch MultiSearchView already
    // computes for the page-level bar (design §5.4) —
    // totalPages/currentPage/setPage/getPageURL in pages mode,
    // scrollTotalPages/derivedPage/setVirtualPage/getVirtualPageURL in
    // scroll mode. Only one PageSelect is ever on screen: the page-level bar
    // is gated `!fs`, and this overlay only mounts while maximized.
    totalPages: number
    /**
     * A page number in pages mode, and in scroll mode the derived-page BOX
     * itself (components/pageselect.tsx's PageIndicator) — forwarded either
     * way, so a virtual-page crossing re-renders the bar inside this dock and
     * not the dock.
     */
    currentPage: PageIndicator
    setPage: (page: number) => void
    getPageURL: (base: ReadonlyURLSearchParams | URLSearchParams, newPage: number) => string
    /**
     * Is the gallery host rendering GalleryImageLarge right now? §8.3 rests
     * the viewer on "no double mount" — PinBoard and GalleryImageLarge are
     * the two arms of one ternary in ImageGallery, so while the board shows,
     * that component is mounted nowhere else. That holds for every path the
     * UI can reach EXCEPT one: `gpb` is the GRID host's board tab and `ghp`
     * the GALLERY host's, and isPinboardMaximized ORs them without knowing
     * which host is live — so maximizing from the gallery's IMAGE tab with a
     * stale `gpb=true` reports a maximized board while the large image is
     * what is actually on screen. The dock already mounts in that state; a
     * SECOND GalleryImageLarge would duplicate its window keydown scope and
     * put two <video> elements in play. The flag says when that is happening
     * so the viewer can stay out of it.
     */
    largeImageHosted: boolean
}) {
    const [pinned, setPinned] = useSearchOverlayOpen()
    // The strip's card clicks perform the GALLERY's position write — `gi`
    // plus, in scroll mode, the anchor ("the anchor follows the position") —
    // through the same shared hook the gallery uses, so the two mounts
    // cannot drift (design §5.3). Writing `gi` is safe mid-maximize: the
    // host choice is latched while maximized (see galleryHost in
    // MultiSearchView), so the selection cannot flip hosts under the board.
    const navigate = useGalleryNavigate(scrollMode)
    // The pinned viewer (design §8.3). `gsv` is open/closed and nothing more:
    // WHICH item it shows is `gi`, by §8's identity rule — "selected" and
    // "the item in the viewer" are the same thing, so the viewer follows
    // every card click, arrow key and scrubber jump for free. The effective
    // flag stands the surface down where a second GalleryImageLarge would
    // collide with the gallery's own (see largeImageHosted); using it
    // everywhere — including the strip's button glyph — keeps the button
    // honest about what a click will do in that state.
    const [viewerPinned, setViewerOpen] = useSearchViewerOpen()
    const viewerOpen = viewerPinned && !largeImageHosted
    // The strip's preview button gets a viewer toggle only where there IS a
    // viewer to toggle. Standing the SURFACE down without standing the CONTROL
    // down left the button promising to open something and writing `gsv=true`
    // when `gsv` was ALREADY true — nuqs 2.9.0 has no same-value short-circuit
    // and the flag is history:"push", so every click buried the back button
    // under one more dead entry and nothing appeared. Withheld rather than
    // cleared: `gsv` is one of the terms that ENABLES the suppressed search
    // (see useSearchSuppressed), the stand-down is a transient host conflict,
    // and the flag surviving it is the same treatment `sb` gets across a
    // maximize. The button keeps its other half — it still selects and still
    // drives the hover peek — and says so (see PreviewButton's label).
    const viewerToggle = largeImageHosted ? undefined : setViewerOpen
    const [qIndex] = useGalleryIndex()
    // The position the viewer actually shows, CLAMPED — the gallery clamps
    // (`urlIndex`) and the strip clamps (`clampToCount`), and this is what
    // makes the third surface agree with them by construction rather than by
    // coincidence. TRAP: pass `qIndex` raw and `source.get` answers undefined
    // for an out-of-range index, at which point useViewerItem's held-item
    // fallback — written for a chunk that is still coming — holds the last
    // item forever. Every consumer below takes the clamped pair: the item, the
    // peek suppression that compares against it, and the surface itself.
    // Once settled it also lines the STRIP's preview-button glyph up with
    // reality, since both then clamp `gi` against the same number.
    const { extent: viewerExtent, index: viewerIndex } =
        viewerPosition(count, countSettled, qIndex)
    const viewerItem = useViewerItem(source, viewerIndex, resultsAreStale)
    // Stable, because the viewer's Esc listener depends on it.
    const closeViewer = useCallback(() => {
        void setViewerOpen(false)
    }, [setViewerOpen])
    // Seed the position for a viewer opened without one. `gsv` says a viewer
    // is up and §8's identity rule says its item IS the selection, so
    // `gsv=true` with no `gi` is half a sentence. Reachable two ways: a
    // shared or hand-written URL, and the gallery's own close button, which
    // writes `gi=null` (ImageGallery's closeGallery) while `gsv` — deliberately
    // NOT cleared when the viewer stands down for a hosted large image — rides
    // along into the next maximize. Back can land on either. Left alone it opened
    // a permanent skeleton: no row, so no GalleryImageLarge, so none of the
    // key scope the viewer's arrows and player chords live in, and only the X
    // and Esc to get out of it. Making the URL honest means giving the flag
    // the item it claims to be showing rather than quietly ignoring it, so:
    // row 0, the first thing any surface here would select.
    //
    // "replace" — this repairs the entry the user is standing on, it is not a
    // step to bury Back under. Gated on rows actually existing (the RAW
    // count: a set with no rows has no row 0 to seed, and the viewer's
    // loading frame is then the honest answer) and self-terminating, since
    // the write is what makes the guard above it false.
    useEffect(() => {
        if (!viewerOpen || qIndex !== null || count <= 0) return
        navigate(0, { history: "replace" })
    }, [viewerOpen, qIndex, count, navigate])
    // The ephemeral OPEN half of the show state. It lives in a store rather
    // than in local state because Ctrl+Shift+F (SearchPage) writes it too,
    // and because useSearchSuppressed reads it: an open dock is a search
    // consumer on screen and enables the query exactly like a pinned one
    // (design §2/§4). Cleared on unmount, so restoring the board and
    // re-maximizing starts closed unless pinned.
    const open = useSearchOverlayReveal((s) => s.revealed)
    const setOpen = useSearchOverlayReveal((s) => s.setRevealed)
    const panelRef = useRef<HTMLDivElement>(null)
    const shown = open || pinned
    // Whether the SIDEBAR dock is on screen — the one thing this dock needs
    // to know about the other one. Its panel covers this dock's LEFT handle,
    // and an invisible click target under a panel is a bug, so that handle
    // stands down while the sidebar shows (§9).
    const sidebarPinned = useSidebarOverlayOpen()[0]
    const sidebarOpen = useSearchOverlayReveal((s) => s.sidebarRevealed)
    const sidebarShown = sidebarOpen || sidebarPinned
    const dismiss = useCallback(() => setOpen(false), [setOpen])
    // Esc peels one layer at a time (§7): this dock stands its Esc down
    // while the sidebar is shown AND unpinned — precisely when the sidebar's
    // own handler is going to consume the press — so one Esc closes the
    // sidebar and the next closes this dock. A PINNED sidebar ignores Esc,
    // so yielding to it would make the key dead for both, which is why the
    // pin is in the test. An outside click still dismisses both, by design.
    //
    // `viewerOpen`, the EFFECTIVE flag, not `gsv`: the hook stands Esc down
    // for the viewer, and in the stood-down state (`largeImageHosted`) there
    // is no PreviewSurface mounted to consume the key — see the hook's own
    // note. Passing the raw flag made one Esc press close nothing at all.
    useDockDismiss(shown, pinned, dismiss, viewerOpen, {
        escYield: sidebarShown && !sidebarPinned,
    })

    // The hover preview's subject (design §8): the strip card under the
    // pointer, debounced 200ms on open so a sweep across cards doesn't
    // flash a preview per card, cleared instantly on leave — the same
    // useDelayedHover the pinboard preview popovers use. The strip's
    // onItemHover contract also feeds null on a card's own dragstart (the
    // z-70 preview would occlude the drag toward the board). Passing the
    // setter directly is deliberate: it is stable (useCallback inside the
    // hook) and its (item | null) shape is assignable to the strip's
    // (item | null, index) callback.
    const [hoverItem, setHoverItem] = useDelayedHover<SearchResult>(200)
    // Panel hide clears the preview too (§8 "cleared on overlay close").
    // Leaving a card fires its own mouseleave before the panel's on any
    // pointer path, so this is the net for hide paths where no card
    // mouseleave is delivered — the dock now hides only by Esc, an outside
    // click or the close button, none of which involve the pointer leaving
    // the card it is resting on. A hidden panel with a live full-viewport
    // preview stranded over the board is never acceptable, so the clear
    // keys on the show-state itself.
    useEffect(() => {
        if (!shown) setHoverItem(null)
    }, [shown, setHoverItem])
    // And the viewer's open state voids it too, both ways. Belt and braces
    // for a hazard the strip's handlers alone cannot cover: the ONLY other
    // clear is the one above, which never fires while the dock is pinned, and
    // both peek triggers live on a card the pointer may simply be resting on
    // when `gsv` flips. Closing the viewer collapses the suppression below in
    // the same commit, so a subject held from before the close would surface
    // as a full-size peek nobody asked for — and pressing the strip's own
    // "close viewer" button would replace the viewer with a pixel-identical
    // peek of the same item, minus the header, which reads as the close having
    // eaten the chrome and done nothing else. A peek that is still legitimate
    // is one pointer move away from coming back; a stranded one has no way out
    // at all.
    //
    // TRAP — this WAS a passive effect, and a passive effect only cleans up
    // after the thing it looks like it prevents. `useEffect(…, [viewerOpen])`
    // runs one commit LATE: render N already has `viewerOpen=false` and the
    // held subject as a peek, so the player is torn down (it is gated on
    // `viewerOpen`) AND a peek mounts and fires a thumbnail request plus, for
    // a still, a full-file one — render N+1 is where the effect's clear
    // unmounts it again. Pressing Shrink with the pointer on the fixed item's
    // own card did exactly that. So the void is DERIVED during render instead,
    // the "adjust state when a value changes" pattern this codebase already
    // uses for GalleryImageLarge's per-item videoSlot and ImageGallery's
    // heldIndex: React re-runs this component immediately, WITHOUT committing,
    // so the peek never reaches the DOM at all.
    //
    // Voided by IDENTITY rather than by clearing `hoverItem`, because the
    // clear is not ours to make during render — `setHoverItem` also cancels
    // the hook's dwell timer, and a ref write while rendering is what the
    // React Compiler forbids. The effect below still makes the clear, which is
    // what cancels a dwell already in flight (it would otherwise land a peek
    // after the fact) and what lets the void release itself.
    //
    // §8's trigger is `viewerPinned` (`gsv`), NOT the effective `viewerOpen`:
    // the latter also carries `largeImageHosted`, which follows the board's
    // CONTENTS (`pinboardLayout.length === 0`), so pinning the first item onto
    // an empty board would void a live peek under a pointer that never moved.
    const [heldViewerPinned, setHeldViewerPinned] = useState(viewerPinned)
    const [voidedPeek, setVoidedPeek] = useState<SearchResult | null>(null)
    if (heldViewerPinned !== viewerPinned) {
        setHeldViewerPinned(viewerPinned)
        // Whatever is held at the flip is void; null (the common case, no
        // hover) voids nothing and the branch below never has to fire.
        setVoidedPeek(hoverItem)
    } else if (voidedPeek !== null && voidedPeek !== hoverItem) {
        // The hook produced a different subject — a genuinely new hover, or
        // the effect's own clear — so the void has done its job.
        setVoidedPeek(null)
    }
    const heldPeek = hoverItem !== voidedPeek ? hoverItem : null
    useEffect(() => {
        setHoverItem(null)
    }, [viewerPinned, setHoverItem])
    // The peek the SURFACE is given, which is the hover subject minus the one
    // case that is pure loss: the item already fixed in the viewer. Peeking it
    // would lay a static thumbnail over the live picture inside the same box
    // — a playing video would read as having frozen — and the peek can teach
    // nothing there, since both subjects are the same file at the same size.
    // Withheld here rather than inside the surface because this is where the
    // two are compared anyway (`viewerItem` is resolved here for the strip's
    // button glyph), and because the surface's own rule is simpler for it:
    // whatever it is handed, it displays.
    //
    // Compared by SHA, not by itemEquals: Panoptikon indexes per FILE, so a
    // copy or a hardlink of the viewer's item is an ordinary second row with
    // its own file_id and the same bytes. On file_id the suppression missed
    // it, and hovering the duplicate laid a static thumbnail over the very
    // video playing underneath — precisely the "reads as the video froze"
    // failure this exists to prevent. Identity for SELECTION stays file_id
    // (itemEquals, and `gi` addresses rows); identity for "would this peek
    // paint the same picture" is the content hash.
    const peekItem =
        heldPeek && !(viewerOpen && viewerItem && viewerItem.sha256 === heldPeek.sha256)
            ? heldPeek
            : null

    // The open flag outlives no dock: clear it when this one unmounts (the
    // board being restored) so a later re-maximize starts closed unless
    // `gso` says otherwise. Mount-scoped deliberately — keying it on the
    // flag's own value would make it fight every legitimate write.
    useEffect(() => {
        return () => setOpen(false)
    }, [setOpen])

    // The dock's height, published in TWO custom properties with deliberately
    // different lifetimes. Measured with a ResizeObserver rather than a
    // one-shot because the panel grows: search bar row, strip, pagination.
    // Hiding the panel is CSS-only (opacity + translate, §5.1), so its
    // offsetHeight is the same shown or hidden and one observer covers both.
    //
    // --pinboard-dock-height: the band the dock OWNS, for as long as it is
    // mounted — the whole maximized session. For consumers that must not move
    // when the dock merely reveals or hides, which today means the two
    // preview surfaces (previewBox.ts): the pinned viewer can hold a playing
    // <video>, and re-laying out its frame when the dock hid was P6's worst
    // regression. Read that file's TRAP note before changing which var it
    // subtracts.
    //
    // --pinboard-bottom-inset: the band the dock is COVERING right now, so the
    // bottom-band occupants that would otherwise sit under it (PinboardHistory's
    // bottom docking, the hole-mode hint toast, the sidebar overlay's bottom
    // edge) can add it to their offsets (design §7). Those SHOULD reclaim the
    // band the moment the dock hides, so this one stays shown-scoped: absence
    // of the var IS "no overlay shown", with consumers falling back to 0px.
    //
    // BOTH vars are written synchronously inside the same publish(), and the
    // shown-scoped one reads its gate from a ref rather than from a state
    // value. TRAP: routing the inset through a state update instead makes it
    // land a frame late whenever the dock RESIZES while shown — the pagination
    // row appearing as a search crosses one page, the bar rewrapping, the
    // strip mounting — because a ResizeObserver callback is outside React's
    // event and effect systems, so its setState is not batched into the
    // commit that is about to paint. The consumers above would then paint one
    // frame at the old inset. State is used only for what genuinely IS state:
    // re-syncing on the shown transition, below.
    const dockHeightRef = useRef(0)
    const shownRef = useRef(shown)
    useLayoutEffect(() => {
        const el = panelRef.current
        if (!el) return
        const publish = () => {
            const height = el.offsetHeight
            dockHeightRef.current = height
            document.documentElement.style.setProperty(
                "--pinboard-dock-height",
                `${height}px`
            )
            if (shownRef.current) {
                document.documentElement.style.setProperty(
                    "--pinboard-bottom-inset",
                    `${height}px`
                )
            }
        }
        publish()
        const observer = new ResizeObserver(publish)
        observer.observe(el)
        return () => {
            observer.disconnect()
            document.documentElement.style.removeProperty(
                "--pinboard-dock-height"
            )
            document.documentElement.style.removeProperty(
                "--pinboard-bottom-inset"
            )
        }
    }, [])

    // The show transition: the ref the publish above gates on, plus the
    // set/remove of the inset for a dock whose height did not change. Written
    // from an effect and never during render, and the ref is assigned before
    // the early return so a resize observed while HIDDEN can never re-add the
    // var behind this effect's back.
    useLayoutEffect(() => {
        shownRef.current = shown
        if (!shown) return
        document.documentElement.style.setProperty(
            "--pinboard-bottom-inset",
            `${dockHeightRef.current}px`
        )
        return () => {
            document.documentElement.style.removeProperty(
                "--pinboard-bottom-inset"
            )
        }
    }, [shown])

    // Every fixed element here carries data-search-overlay: the maximized
    // board's viewport-marquee starter and click-outside deselect both
    // exempt that selector (GalleryPinBoard), so a press on the dock never
    // rubber-bands the board underneath or clears the pin selection — and
    // useDockDismiss exempts it too, so the chrome never dismisses itself.
    return (
        <>
            {/* THREE handles, one panel, and a COLD BOARD SHOWS NOTHING
                ELSE: every edge control on a closed board opens THIS dock
                (§5.1). The sidebar has no handle of its own until this one
                is shown — it is never an entry point from a cold board,
                because it only makes sense beside the search panel or as
                the destination of a per-item Data View press (§9).
                Each handle sits CENTRALLY on its own side: bottom-center,
                left-center, right-center. Three of them so an auto-hide
                taskbar — which pops over the browser at the bottom edge and
                swallows the gesture there — can never gate the feature; the
                center one is the toolbar's top-center handle upside down and
                keeps its chevron, while the two side handles carry a SEARCH
                glyph instead, because they do not sit adjacent to the
                direction a chevron would imply. All three hide while the
                panel is shown, since the panel covers them.

                The centre one ALSO stands down while the sidebar is shown,
                for the same reason the left one does. It spans 50vw ± 56px
                and the sidebar is min(26rem,90vw) rising to 50vw at `lg`,
                and the sidebar renders after this dock at the same z-50 — so
                between 1024px and 1280px the sidebar covers the handle's
                left half, and on a window at or under ~920px it covers the
                handle entirely. The state is reachable (the viewer header's
                Data View button, a re-clicked checkbox), and an invisible
                click target under a panel is the bug this prop exists for.
                Standing it down rather than offsetting it by
                --pinboard-left-inset, because with the sidebar up the RIGHT
                handle is uncovered at every width — the sidebar is a left-
                edge panel — so a reachable path to this dock survives, and
                one nudged handle sliding around under a panel edge is worse
                than a handle that is simply not there. */}
            <DockHandle
                position="bottom-0 left-1/2 -translate-x-1/2"
                shape="h-4 w-28 rounded-t-md border-b-0 hover:h-5 hover:w-32"
                hidden={shown || sidebarShown}
                onOpen={() => setOpen(true)}
                title="Open the search dock"
                label="Open search dock (bottom edge)"
            >
                <ChevronUp className="h-3 w-3" />
            </DockHandle>
            {/* Vertically centred, and additionally stood down while the
                sidebar panel covers this spot. There is no collision left to
                arrange with the sidebar's own handle: that one exists ONLY
                while this dock is SHOWN (§9), which is exactly when all
                three of these are hidden, so the left edge never carries two
                handles at once. The `|| sidebarShown` is still load-bearing
                for the other order — the sidebar can be shown over a HIDDEN
                dock (the viewer header's Data View button, a re-clicked
                select checkbox), and an invisible click target under a panel
                is a bug. */}
            <DockHandle
                position="left-0 top-1/2 -translate-y-1/2"
                shape="h-28 w-4 rounded-r-md border-l-0 hover:w-5 hover:h-32"
                hidden={shown || sidebarShown}
                onOpen={() => setOpen(true)}
                title="Open the search dock"
                label="Open search dock (left edge)"
            >
                <Search className="h-3 w-3" />
            </DockHandle>
            {/* The RIGHT handle never stands down for the sidebar: the
                sidebar is a left-edge panel and its WIDEST rung is 90vw, not
                50vw — 50vw is the `lg` rung and every rung above it is
                narrower still (down to 18vw), but BELOW `lg` the width is
                `min(26rem, 90vw)` and the 90vw floor binds on any window
                under ~462px. That still leaves 10vw of the right edge clear,
                which is wider than this 16px handle on any viewport over
                160px, so the conclusion is unchanged: uncovered at every
                width the app is usable at. It is
                therefore the guaranteed way back to the search dock in the
                {dock hidden, sidebar shown} state, which is what lets the
                other two stand down there. */}
            <DockHandle
                position="right-0 top-1/2 -translate-y-1/2"
                shape="h-28 w-4 rounded-l-md border-r-0 hover:w-5 hover:h-32"
                hidden={shown}
                onOpen={() => setOpen(true)}
                title="Open the search dock"
                label="Open search dock (right edge)"
            >
                <Search className="h-3 w-3" />
            </DockHandle>
            {/* pointer-events-none on the wrapper, re-enabled on the panel
                only while shown — the toolbar's show pattern with the
                translate direction flipped for a bottom edge */}
            <div className="fixed inset-x-0 bottom-0 z-50 pointer-events-none">
                <div
                    ref={panelRef}
                    data-search-overlay
                    // INERT WHILE HIDDEN. The panel is hidden with opacity +
                    // translate + pointer-events-none and stays MOUNTED (the
                    // CSS-only-hide rule, §5.1 — a strip card serving as an
                    // HTML5 drag source has to survive its own panel hiding
                    // mid-drag). None of that touches the TAB ORDER, so on a
                    // cold maximized board Tab walked into the invisible
                    // search input, tag combobox, pagination links and
                    // view-mode toggle with no visible focus ring, and typing
                    // silently rewrote query params. `inert` affects focus
                    // and hit-testing ONLY — it does not unmount, does not
                    // hide, and does not abort an in-flight drag — so the
                    // drag-source guarantee is untouched.
                    inert={!shown}
                    // The only pointer gesture on the panel body: a
                    // DOUBLE-click on genuine background pins, one way —
                    // never unpin, so a stray double-click can only make the
                    // panel more persistent. Users who watch the panel
                    // dismiss on outside clicks reach for a double-click to
                    // "activate" it, and the pin toggle flipping to pressed
                    // is the feedback. The interactive-ancestor test
                    // (isPanelBackground) is what guarantees rapid clicking
                    // on a control never pins.
                    //
                    // Single background clicks stay INERT: they neither pin
                    // nor dismiss. Anything else here would be the old
                    // auto-pin under another name.
                    onDoubleClick={(e) => {
                        if (pinned || !isPanelBackground(e.target)) return
                        void setPinned(true)
                    }}
                    className={cn(
                        // pb-6, not py-3: the browser's own link-target
                        // bubble is anchored to the VIEWPORT's bottom edge,
                        // and nothing a page can do suppresses it — every
                        // control in this dock's bottom row is a real link
                        // (page hrefs, card hrefs), so hovering one pops a
                        // ~21px bubble that landed straight across the
                        // pagination buttons. The panel's own bottom padding
                        // is the only lever that does not cost link
                        // semantics. 24px is deliberately the MINIMUM that
                        // clears the bubble at default zoom rather than a
                        // comfortable margin: the dead band reads as a gap at
                        // the screen's edge, and a conspicuous gap is a worse
                        // trade than the overlap it prevents.
                        "border-t bg-background/95 px-4 pt-3 pb-6 shadow-md transition-all duration-150",
                        shown
                            ? "pointer-events-auto opacity-100 translate-y-0"
                            : "opacity-0 translate-y-2",
                    )}
                >
                    <div className="flex items-center gap-2">
                        {/* The SAME width rule the page header gives this
                            row (SearchPage: `2xl:mx-auto` plus the
                            sidebar-dependent fraction), so the search bar
                            reads identically in both mounts instead of
                            stretching the full width of the screen here.
                            The fraction widens with the sidebar for the
                            same reason it does on the page: the sidebar
                            eats the width the bar would otherwise be
                            centred in.

                            `flex-none` has to come with it. Below 2xl this
                            is a flex ITEM with flex-1, so a width class
                            alone would lose to the flex basis and change
                            nothing — the page's wrapper has no flex parent
                            and needs no such release. `mx-auto` then
                            centres the shrunk box in the row's free space
                            (the pin and close buttons stay at the right
                            edge, as they must). */}
                        <div className={cn(
                            "min-w-0 flex-1",
                            "2xl:mx-auto 2xl:flex-none",
                            sidebarShown ? "2xl:w-2/3" : "2xl:w-1/2",
                        )}>
                            <SearchBarRow
                                variant="overlay"
                                onRefresh={onRefresh}
                                isFetching={isFetching}
                                nResults={nResults}
                                resultMetrics={resultMetrics}
                                countMetrics={countMetrics}
                            />
                        </div>
                        {/* UNPINNING LEAVES THE PANEL OPEN. The pointer is
                            right here looking at it, so snapping it away
                            would read as the button having closed the dock;
                            instead `open` is raised in the same commit and
                            the panel dismisses on the next Esc or outside
                            click, which is exactly what "unpinned" now
                            means. */}
                        <Toggle
                            pressed={pinned}
                            onClick={() => {
                                if (pinned) setOpen(true)
                                void setPinned(!pinned)
                            }}
                            title={pinned
                                ? "Pinned (Ctrl+Shift+F): the search dock survives clicks on the board. Click to unpin — it stays open until Esc or a click outside"
                                : "Pin the search dock open (Ctrl+Shift+F) — unpinned, it closes on Esc or a click outside"}
                            aria-label="Pin search overlay"
                        >
                            <Pin className="h-4 w-4" />
                        </Toggle>
                        {/* The panel's own close affordance. It has to be
                            here: the edge handles that open the dock are
                            covered by the open panel, so there is no other
                            control on screen that closes it by pointer.
                            Closes for real — an unpin as well, when pinned —
                            because a close button that leaves the thing open
                            is not a close button. */}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                                setOpen(false)
                                if (pinned) void setPinned(false)
                            }}
                            title="Close the search dock (Esc)"
                            aria-label="Close search overlay"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                    {/* The thumbnail strip (design §5.3). Mounted for the
                        whole maximized session like the rest of the panel —
                        hiding is CSS-only, so a card serving as the HTML5
                        drag source survives its own panel hiding mid-drag
                        (§5.1). Drag-out, PinButton and shift-carry need no
                        overlay code: cards already set the sha256 +
                        text/uri-list payload, and the maximized board above
                        is the mounted RGL drop target. While search is
                        suppressed (dock neither open nor pinned) the strip
                        is inert by construction: its ensureRange calls flow
                        into useChunkedResults, whose queries are
                        `enabled: false` then — wanted chunks accumulate
                        under the disabled placeholder key but nothing
                        fetches, and the first enabled render rebuilds the
                        wanted window from the visible range. */}
                    <div className="mt-2">
                        <VirtualGalleryHorizontalScroll
                            source={source}
                            count={count}
                            onNavigate={navigate}
                            fallbackAnchor={fallbackAnchor}
                            onDerivedPageChange={onDerivedPageChange}
                            pageSize={pageSize}
                            onItemHover={setHoverItem}
                            viewerOpen={viewerOpen}
                            onViewerOpenChange={viewerToggle}
                        />
                    </div>
                    {/* The bottom row. 1fr_auto_1fr is the results header's
                        own idiom, here for the same reason: the scrubber
                        stays centered on the panel however wide the
                        right-hand cluster grows, and stays centered when the
                        cluster is the only thing in the row.

                        The middle track is minmax(0,auto), NOT auto, and
                        that is load-bearing rather than tidiness. A plain
                        max-content track never shrinks, so a wide enough
                        pagination bar (PageSelect renders up to 35 page
                        buttons) pushes the third track's start past the
                        panel's right edge — and this dock is `fixed
                        inset-x-0` with no overflow, so a fixed element's
                        overflow contributes no document scroll and the
                        toggle becomes literally unreachable. That would
                        evict the ONLY control able to change view mode while
                        maximized (§5.5), which is the one thing this row
                        exists to guarantee. With a zero minimum the
                        pagination is what degrades instead: the third track
                        keeps its min-content floor (1fr's automatic minimum
                        is the toggle's own min-content), the middle absorbs
                        the shortfall, and the bar scrolls inside its cell.
                        Roomy — the ordinary case — nothing moves: an `auto`
                        maximum is still max-content and the two 1fr tracks
                        still centre it. */}
                    <div className="grid grid-cols-[1fr_minmax(0,auto)_1fr] items-center">
                        {/* The pagination bar: with `gi` set, a scrubber
                            click moves the gallery position to the target
                            page's first item (setVirtualPage); with `gi` null
                            it writes only the anchor, and the strip follows
                            via fallbackAnchor while the highlight converges
                            through the strip's own live push (§5.4). Gated
                            like the page-level bar's content test: one page
                            means nothing to flip or scrub. */}
                        {totalPages > 1 && (
                            /* min-w-0 + overflow-x-auto is the other half of
                               the minmax(0,…) above: the track may now be
                               narrower than the bar, and a grid item whose
                               automatic minimum is min-content would simply
                               overflow it instead of scrolling.

                               The other two classes are not decoration.
                               `overflow-y-hidden` because a scroll container
                               with `overflow-x: auto` computes its Y to auto
                               as well, and the bar overflows its cell
                               vertically by a hairline (button borders
                               against a track height set by the taller
                               toggle cell) — enough to raise a VERTICAL
                               scrollbar that eats ~15px of width and shows
                               up in the ordinary, non-degraded case.
                               Measured: with Y hidden, the roomy case is
                               pixel-identical to the plain `auto` track it
                               replaces.

                               `justify-center-safe` because PageSelect's
                               root is `w-full justify-center`, and centred
                               overflow spills past the scroll ORIGIN, which
                               is not scrollable back to: measured at a 560px
                               panel, the first page button sat 493px to the
                               left of the origin and only half the overflow
                               was reachable. `safe center` centres while it
                               fits and falls back to start when it does not,
                               which puts every button back in reach. */
                            <div className="col-start-2 min-w-0 overflow-x-auto overflow-y-hidden [&>nav]:justify-center-safe">
                                <PageSelect
                                    totalPages={totalPages}
                                    currentPage={currentPage}
                                    setPage={setPage}
                                    getPageURL={getPageURL}
                                />
                            </div>
                        )}
                        {/* The paged/scroll switch, seated beside the control
                            whose meaning it changes (§5.5). Its page mount is
                            in the results header — a surface the maximized
                            board never renders — so without this one the
                            maximized workspace cannot change mode at all. It
                            is deliberately OUTSIDE the bar's gate above:
                            "fewer results than one page" is precisely the
                            case the header placement was chosen to cover (see
                            ViewModeToggle's docstring), and inheriting the
                            gate would lose the switch exactly there. The two
                            mounts can never be on screen together — the
                            header band is gated `!fs` and this dock only
                            exists while maximized, which requires `gf` — so
                            this is a second seat for the same machinery, not
                            a second copy of it.

                            col-start-3: the bar above is conditional, so
                            without an explicit track this cluster would slide
                            into the center when it is alone. mt-4 mirrors the
                            margin PageSelect carries, which is what lines the
                            two up in the row and what gives the row its gap
                            from the strip when the bar is absent. */}
                        <div className="col-start-3 mt-4 flex items-center justify-end">
                            <ViewModeToggle />
                        </div>
                    </div>
                </div>
            </div>
            {/* ONE preview surface, two subjects (design §8): the peek is a
                LAYER inside the viewer's own box, not a second framed thing
                over it, so fixing a peek changes nothing about the picture
                and peeking a neighbour never unmounts the player the viewer
                has running. Mounted here, not in MultiSearchView: `source`,
                `count`, `scrollMode` and the shared navigate write are
                already in scope, the surface's triggers are controls on this
                dock's own strip (so the button's glyph and the viewer's open
                state have to have one owner), and this component's own
                lifetime is already exactly the viewer's — the whole maximized
                session.

                It mounts for EITHER subject: a peek with the viewer closed is
                the P5 behavior and is still what the strip's preview button
                does before anything is fixed. */}
            {(viewerOpen || peekItem) && (
                <PreviewSurface
                    viewerOpen={viewerOpen}
                    item={viewerItem}
                    peek={peekItem}
                    source={source}
                    extent={viewerExtent}
                    resultsAreStale={resultsAreStale}
                    index={viewerIndex}
                    onNavigate={navigate}
                    onClose={closeViewer}
                />
            )}
        </>
    )
}
