"use client"
import { useEffect, useRef, type ReactNode } from "react"
import { cn, hasOpenLayer } from "@/lib/utils"

// Chrome shared by the maximized workspace's two docks — the bottom search
// dock (SearchOverlay) and the left sidebar dock (SidebarOverlay). Both use
// the click-to-open model of design §5.1: an always-visible edge HANDLE is
// the only hot surface, and an open panel is a stable state dismissed by
// Esc, an outside click, or the panel's own close button.
//
// This file exists so the dismissal rules — which are all trap and no
// business logic — are written once. Duplicating them was how the two docks
// drifted the first time.

/**
 * An edge handle: the ONLY hot surface either dock has.
 *
 * It replaces the full-length `h-4`/`w-4` HOT BANDS, which were a genuine
 * defect and must never come back: they sat at z-50 OVER the board and ate
 * every click in the outermost 16px of the viewport, so a pinboard
 * crop-resize handle on an item touching the screen edge was unclickable —
 * and the click PINNED the dock instead of doing what the user aimed at.
 * Every edge pixel that is not one of these handles is plain board.
 *
 * Hovering HIGHLIGHTS (accent + a little growth); it does not open anything.
 * That is deliberate signalling, not decoration: these docks are
 * click-revealed while the top toolbar (PinboardFullscreenBar) stays
 * hover-revealed, and the handle's refusal to open on hover is what teaches
 * the difference. Clicking opens.
 *
 * `data-search-overlay` rides on the fixed wrapper: the board's
 * viewport-marquee starter and its click-outside deselect both exempt that
 * selector via `closest` (GalleryPinBoard), and so does the docks' own
 * outside-click dismissal below — which is what stops a handle from
 * dismissing the panel it just opened, and stops one dock's chrome from
 * dismissing the other.
 */
export function DockHandle({
    position,
    shape,
    hidden,
    onOpen,
    title,
    label,
    children,
}: {
    /** Tailwind classes placing the fixed wrapper against its edge. */
    position: string
    /** Tailwind classes giving the handle its size, radius and growth. */
    shape: string
    /**
     * Hidden while the panel it opens is on screen (the panel covers it),
     * and — for the bottom dock's LEFT and BOTTOM-CENTRE handles — while the
     * sidebar panel covers them. Opacity alone would leave an invisible
     * click target under a panel, so this also removes it from hit-testing
     * AND from the tab order (`inert`, below).
     *
     * Not to be confused with a handle that must not EXIST: the sidebar's
     * own handle is rendered only while the bottom dock is shown (§9), and
     * that one is a conditional render at the call site, because the claim
     * there is about the left edge belonging to the other dock the rest of
     * the time, not about a covered target.
     */
    hidden: boolean
    onOpen: () => void
    title: string
    label: string
    children: ReactNode
}) {
    return (
        <div
            data-search-overlay
            className={cn("fixed z-50", position, hidden && "pointer-events-none")}
        >
            <button
                type="button"
                // `inert` while hidden, because `pointer-events-none` +
                // `opacity-0` hide from the POINTER and from the eye but not
                // from the TAB ORDER. Without this, Tab on a cold maximized
                // board walks into invisible handles and Enter pops a dock
                // open from nowhere. React 19 passes the boolean through as
                // the real HTML attribute.
                inert={hidden}
                onClick={onOpen}
                title={title}
                aria-label={label}
                className={cn(
                    "flex cursor-pointer items-center justify-center border bg-muted text-muted-foreground shadow-sm transition-all duration-150",
                    "hover:bg-accent hover:text-accent-foreground",
                    shape,
                    hidden ? "opacity-0" : "opacity-100",
                )}
            >
                {children}
            </button>
        </div>
    )
}

// Not "outside", for BOTH docks: the docks' own chrome (either dock —
// dismissal means going back to the BOARD, and the two docks are one
// workspace's chrome) and any portaled Radix layer.
//
// The Radix exemption is load-bearing: the dock's search-type selector, tag
// autocomplete and view-mode menu all render into a body portal, so without
// it choosing an item from the dock's own menu would dismiss the dock
// underneath it.
//
// Board-side exemptions do NOT belong here — this list is shared by both
// `useDockDismiss` instances, so anything added to it exempts a board
// control from dismissing the SEARCH dock as well. That is the
// `extraNotOutside` parameter's whole reason for existing; see the
// sidebar's `[data-opens-data-view]` there.
const NOT_OUTSIDE =
    '[data-search-overlay], [data-radix-popper-content-wrapper],'
    + ' [role="dialog"], [role="menu"]'

/**
 * Dismiss an OPEN, UNPINNED dock panel: Esc, or a click outside it.
 *
 * Pinned panels ignore both entirely — that is the whole meaning of pinned,
 * and it is why the effect bails on `pinned` rather than filtering inside
 * the handlers.
 *
 * `dismiss` must be stable (the effect depends on it); callers pass the
 * zustand setter or a useCallback over it.
 *
 * `viewerOpen` is the EFFECTIVE viewer flag, never the raw `gsv`, and the
 * distinction was a dead-Esc bug. Esc stands down here because the viewer's
 * own window-capture handler (PreviewSurface's useViewerEscape) is going to
 * consume the press — but that handler only exists while a PreviewSurface is
 * MOUNTED, and the surface stands down whenever the gallery host is showing
 * its large image under a stale `gpb` (`largeImageHosted`, §8.3). `gsv` is
 * deliberately never cleared on that stand-down, so the raw flag stayed
 * true with nothing behind it and ONE Esc press closed nothing anywhere: not
 * the viewer (no surface), not the dock (yielded to it). Both docks
 * therefore take the effective value from their caller rather than reading
 * the URL for themselves — only MultiSearchView can compute it.
 *
 * `escYield` stands THIS dock's Esc down while the OTHER dock is going to
 * consume the same press — see the Esc-layering note on the key handler.
 *
 * `extraNotOutside` adds a selector to the outside-click exemptions FOR
 * THIS DOCK ONLY. The shared NOT_OUTSIDE list is consumed by both
 * instances, so a board-side control exempted there would stop dismissing
 * the search dock too — which is the asymmetry this parameter fixes (only
 * the sidebar has a board-side opener).
 */
export function useDockDismiss(
    shown: boolean,
    pinned: boolean,
    dismiss: () => void,
    viewerOpen: boolean,
    {
        escYield = false,
        extraNotOutside,
    }: { escYield?: boolean; extraNotOutside?: string } = {},
) {
    // Did the CURRENT pointer gesture START inside an exempt subtree? Set by
    // the capture-phase pointerdown below and read by the click handler; see
    // the ORIGIN GUARD note there for why a click's own target is not enough.
    // Written only from an event handler, never during render.
    const originExemptRef = useRef(false)
    useEffect(() => {
        if (!shown || pinned) return
        const notOutside = extraNotOutside
            ? `${NOT_OUTSIDE}, ${extraNotOutside}`
            : NOT_OUTSIDE
        // Esc is LAST in the chain, so it stands down wherever the key
        // already belongs to someone else. Deliberately a plain window
        // BUBBLE listener with no preventDefault and no stopPropagation:
        // the viewer's own Esc (PreviewSurface's useViewerEscape) is a
        // window CAPTURE listener that stops propagation, so it wins by
        // construction and this one never even runs while the viewer has
        // the key. The explicit viewerOpen bail below is the belt to that
        // braces, for the frames where the surface is mounting.
        //
        // The board's Esc (clear pin selection) is a window bubble listener
        // too and keeps running: it does not preventDefault, and claiming
        // the key here would need stopImmediatePropagation plus a
        // registration-order guarantee we do not have. Both acting on one
        // press is the accepted behavior (§7).
        //
        // ESC PEELS ONE LAYER AT A TIME (§7), and for the same reason as
        // above — no listener here consumes the key — the layering is done
        // by STANDING DOWN rather than by claiming it. Both docks register
        // this listener, so with both panels up one press would otherwise
        // close BOTH. The bottom dock passes escYield while the sidebar is
        // shown-and-unpinned, i.e. exactly when the sidebar's own copy of
        // this handler is going to act; one Esc closes the sidebar, the next
        // closes the dock. The gate is "will the other dock actually consume
        // it", not merely "is it shown": a PINNED sidebar ignores Esc
        // entirely, and yielding to it would make the key dead for both.
        //
        // Outside-click deliberately does NOT layer — a click on the board
        // dismisses BOTH docks. The asymmetry is intended: an outside click
        // means "back to the board", Esc means "back out one step".
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || e.defaultPrevented) return
            if (escYield) return
            // A text field's Esc is that field's own key — the tag
            // autocomplete blurs its input on it. Typing in the dock's
            // search bar and pressing Esc must not yank the dock away.
            const t = e.target as HTMLElement | null
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
            // Element fullscreen: Esc is the browser's own exit.
            if (document.fullscreenElement !== null) return
            if (viewerOpen) return
            // Open dialogs/menus/poppers own the key over what they cover,
            // and so does any surface declaring itself with data-esc-owner
            // (crop mode, hole targeting, Scale & Move, the trim popover).
            if (hasOpenLayer("[data-esc-owner]")) return
            dismiss()
        }
        // The outside click is NOT swallowed — no preventDefault, no
        // stopPropagation. It performs its normal board action (select a
        // pin, start a marquee) and the chrome simply retreats with it.
        // Swallowing it would make dismissing the dock cost an extra click
        // for every board action.
        //
        // `click`, NOT `pointerdown`, and this is a bug fix rather than a
        // preference. The bottom dock's reservation is SHOWN-scoped: hiding
        // it removes --pinboard-bottom-inset and collapses the board's scroll
        // range in the same commit. Dismissing on pointerdown therefore did
        // that MID-GESTURE — the board lurched under a pointer that was
        // already down on a pin, and because `click` only fires on the common
        // ancestor of the pointerdown and pointerup targets, the click
        // frequently never fired at all and the pin was not selected. Every
        // board action inside an open dock cost two presses.
        //
        // Keeping the reservation shown-scoped is the deliberate half of
        // that trade: a mount-scoped one would leave a permanent dock-height
        // dead band under the board whenever the dock is closed, which is
        // worse and always visible. ACCEPTED, and inherent to reclaiming the
        // band: when the dock closes while the board is scrolled to the very
        // bottom, the content shifts up by the dock's height. That is the
        // reservation being given back, not a jump.
        //
        // WHAT THE `click` MODEL ACTUALLY COSTS, corrected — an earlier
        // version of this comment (and of design §5.1) claimed a marquee
        // drag does not dismiss "because it produces no click". That is
        // FALSE. Both marquee starters call `preventDefault()` on
        // `pointerdown` (GalleryPinBoard's frame listener and the grid
        // area's own onPointerDown), and per the pointer-events
        // compatibility mapping that suppresses the compatibility MOUSE
        // events (mousedown/mouseup) — never `click`, which is dispatched
        // from the pointerup regardless. So a marquee that starts and ends
        // on the board DOES dismiss. The behavior is right (a marquee is a
        // board gesture and the chrome retreating with it is the contract);
        // only the reasoning was wrong. What genuinely produces no click is
        // an HTML5 pin DRAG: a native drag session cancels the click, so
        // dragging a pin out of the board leaves an open dock up.
        //
        // ORIGIN GUARD — `click` is dispatched at the nearest common
        // inclusive ANCESTOR of the mousedown and mouseup targets, so a
        // gesture that starts inside a panel and ends outside it has a click
        // target that is NEITHER. Here the docks are fixed children of the
        // search page's content column and the board sits in a
        // [data-pinboard-frame] panel inside that same column, so the
        // ancestor is the column div: it matches no exemption and is neither
        // <html> nor <body>, so the dock dismissed itself. Drag-selecting
        // text in the dock's search input and releasing a few pixels above
        // the panel edge closed the dock — and since the bottom dock's
        // reservation is shown-scoped, the board's scroll range collapsed in
        // the same commit. Impossible under the old pointerdown model, which
        // is why it arrived with the switch. The fix is a capture-phase
        // `pointerdown` that records whether the gesture ORIGINATED in an
        // exempt subtree; the click handler bails when it did. Still no
        // preventDefault and no stopPropagation anywhere.
        //
        // The origin ref has exactly ONE writer (that pointerdown), so it is
        // reset by every new gesture and cannot go stale across them. The
        // one case it cannot describe is a click with no pointerdown of its
        // own — Enter/Space on a focused control — and those are recognised
        // by `detail === 0` and skip the guard rather than inheriting the
        // previous gesture's answer.
        //
        // CAPTURE phase on document, the board's own deselect precedent:
        // bubble delivery is not guaranteed — anything between the target
        // and the document may stop propagation — and a listener that
        // silently stops firing over certain targets is the worst failure
        // mode a dismissal can have. Capture is about DELIVERY here, not
        // priority; nothing is consumed either way.
        //
        // SELF-DISMISS RACE: the click that OPENS a dock must not be seen by
        // the listener that click causes to be registered. It cannot be —
        // this effect runs after the state commit, by which time the opening
        // click has already been dispatched, and a listener added
        // mid-dispatch does not receive the event in flight anyway. The
        // NOT_OUTSIDE exemption covers it a second time, since every opening
        // control (the handles, the overlay row's settings toggle) lives
        // inside a [data-search-overlay] element, and the board-side one —
        // the pin's corner checkbox — is passed in as this dock's
        // `extraNotOutside` by the sidebar, the only dock it opens.
        const isOutside = (t: EventTarget | null) => {
            if (!(t instanceof Element)) return false
            // A press dismissing a MODAL Radix layer hit-tests to
            // <html>/<body> — Radix puts pointer-events:none on the body —
            // so it cannot be matched against the exemptions. It is
            // consuming the dismissal, not aiming past the panel: the same
            // guard the board's deselect carries, for the same reason.
            if (t === document.documentElement || t === document.body) return false
            return t.closest(notOutside) === null
        }
        const onPointerDown = (e: PointerEvent) => {
            const t = e.target
            originExemptRef.current =
                t instanceof Element && t.closest(notOutside) !== null
        }
        const onClick = (e: MouseEvent) => {
            // `detail === 0` is a click with no pointer gesture behind it —
            // Enter/Space on a focused control. Those DO dismiss, and that
            // is deliberate: activating a board control is a genuine "back
            // to the board" gesture, and there is no half-open state to
            // protect (nothing was dragged). They skip the origin guard
            // because they have no origin of their own.
            if (e.detail !== 0 && originExemptRef.current) return
            if (isOutside(e.target)) dismiss()
        }
        // RIGHT-CLICK DISMISSES TOO. `click` fires for the primary button
        // only, so switching off pointerdown silently stopped a right-press
        // on the board — opening a pin's context menu — from retreating the
        // chrome, while every other way of reaching the board still did.
        // The board's context menu is emphatically "back to the board", so
        // it gets its own listener with the same exemptions and the same
        // origin guard. `contextmenu` rather than `auxclick`: it is the
        // event the gesture actually means, it fires whether or not a menu
        // is shown, and it leaves middle-click (which is not a board verb)
        // alone. The Radix menu it opens portals to <body> and is exempt, so
        // the menu itself survives the dismissal that revealed it.
        const onContextMenu = (e: MouseEvent) => {
            if (originExemptRef.current) return
            if (isOutside(e.target)) dismiss()
        }
        window.addEventListener("keydown", onKey)
        document.addEventListener("pointerdown", onPointerDown, true)
        document.addEventListener("click", onClick, true)
        document.addEventListener("contextmenu", onContextMenu, true)
        return () => {
            window.removeEventListener("keydown", onKey)
            document.removeEventListener("pointerdown", onPointerDown, true)
            document.removeEventListener("click", onClick, true)
            document.removeEventListener("contextmenu", onContextMenu, true)
        }
    }, [shown, pinned, viewerOpen, escYield, extraNotOutside, dismiss])
}

// The interactive-ancestor test behind "double-click on genuine panel
// background pins" (§5.1). Anything with a control for an ancestor is not
// background, which is what guarantees rapid clicking on a button never
// pins. `[role]` is deliberately broad — Radix puts roles on every widget
// it renders, and a tab strip or a slider is emphatically not background.
const INTERACTIVE =
    'button, a, input, textarea, select, label, [role], [contenteditable="true"]'

/**
 * Is this double-click on genuine panel background? One-way pin gesture:
 * callers pin on true and never unpin, so a stray double-click can only
 * ever make the panel MORE persistent.
 */
export function isPanelBackground(target: EventTarget | null): boolean {
    return target instanceof Element && !target.closest(INTERACTIVE)
}
