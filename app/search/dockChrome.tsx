"use client"
import { useEffect, type ReactNode } from "react"
import { cn, hasOpenLayer } from "@/lib/utils"
import { useSearchViewerOpen } from "@/lib/state/gallery"

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
     * and — for the bottom dock's LEFT handle — while the 26rem sidebar
     * covers it. Opacity alone would leave an invisible click target under
     * a panel, so this also removes it from hit-testing.
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

// Not "outside": the docks' own chrome (either dock — dismissal means going
// back to the BOARD, and the two docks are one workspace's chrome), and any
// portaled Radix layer. The latter is load-bearing: the dock's search-type
// selector, tag autocomplete and view-mode menu all render into a body
// portal, so without it choosing an item from the dock's own menu would
// dismiss the dock underneath it.
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
 */
export function useDockDismiss(
    shown: boolean,
    pinned: boolean,
    dismiss: () => void,
) {
    // `gsv`, the RAW flag rather than the dock's effective viewerOpen: both
    // docks ask this question and only one of them can compute the effective
    // value (it also carries largeImageHosted). Yielding in the rare
    // stood-down state costs only the Esc path — the close button and an
    // outside click still work.
    const viewerOpen = useSearchViewerOpen()[0]
    useEffect(() => {
        if (!shown || pinned) return
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
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || e.defaultPrevented) return
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
        // CAPTURE phase on document, the board's own deselect precedent:
        // bubble delivery is not guaranteed — anything between the target
        // and the document may stop propagation on pointerdown — and a
        // listener that silently stops firing over certain targets is the
        // worst failure mode a dismissal can have. Capture is about
        // DELIVERY here, not priority; nothing is consumed either way.
        //
        // SELF-DISMISS RACE: the click that OPENS a dock must not be seen by
        // the listener that click causes to be registered. It cannot be —
        // this effect runs after the state commit, by which time the
        // opening pointerdown has already been dispatched, and a listener
        // added mid-dispatch does not receive the event in flight anyway.
        // The NOT_OUTSIDE exemption covers it a second time, since every
        // opening control (the handles, the overlay row's settings toggle)
        // lives inside a [data-search-overlay] element.
        const onPointerDown = (e: PointerEvent) => {
            const t = e.target
            if (!(t instanceof Element)) return
            // A press dismissing a MODAL Radix layer hit-tests to
            // <html>/<body> — Radix puts pointer-events:none on the body —
            // so it cannot be matched against the exemptions below. It is
            // consuming the dismissal, not aiming past the panel: the same
            // guard the board's deselect carries, for the same reason.
            if (t === document.documentElement || t === document.body) return
            if (t.closest(NOT_OUTSIDE)) return
            dismiss()
        }
        window.addEventListener("keydown", onKey)
        document.addEventListener("pointerdown", onPointerDown, true)
        return () => {
            window.removeEventListener("keydown", onKey)
            document.removeEventListener("pointerdown", onPointerDown, true)
        }
    }, [shown, pinned, viewerOpen, dismiss])
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
