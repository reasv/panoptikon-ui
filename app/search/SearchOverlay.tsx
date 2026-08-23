"use client"
import { useLayoutEffect, useRef } from "react"
import { SearchBarRow } from "./SearchBarRow"
import { components } from "@/lib/panoptikon"

// The maximized board's bottom search overlay
// (docs/maximized-pinboard-search-overlay-design.md §5.1). Search chrome,
// not board chrome: it is mounted by MultiSearchView, where every value it
// needs is already in scope, never inside PinBoard. Unlike the fullscreen
// toolbar it is not hover-revealed — it is a workspace with drags
// originating inside it (P2's thumbnail strip), so it toggles and stays.
//
// Deliberately NO pointer-events forcing in either direction: the toolbar's
// `pointer-events-auto` exists because it is hover-revealed over a
// modal-locked body, and replicating it here would pierce Radix modal
// layers. A modal menu disabling this panel along with the rest of the body
// is correct dismiss behavior; menus inside the overlay work exactly as
// they do on the normal page (§5.1).
export function SearchOverlay({
    onRefresh,
    isFetching,
    nResults,
    resultMetrics,
    countMetrics,
}: {
    onRefresh: () => void
    isFetching: boolean
    nResults: number
    resultMetrics?: components["schemas"]["SearchMetrics"]
    countMetrics?: components["schemas"]["SearchMetrics"]
}) {
    const containerRef = useRef<HTMLDivElement>(null)
    // While mounted, the overlay publishes its height as
    // --pinboard-bottom-inset on the document root, so the bottom-band
    // occupants that would otherwise sit under it (PinboardHistory's bottom
    // docking, the hole-mode hint toast) can add the inset to their bottom
    // offsets (design §7). Measured with a ResizeObserver rather than a
    // one-shot: later phases add the thumbnail strip and pagination rows,
    // and the var must track the panel as it grows. Removed on unmount, so
    // absence of the var IS "no overlay" and consumers fall back to 0px.
    useLayoutEffect(() => {
        const el = containerRef.current
        if (!el) return
        const publish = () =>
            document.documentElement.style.setProperty(
                "--pinboard-bottom-inset",
                `${el.offsetHeight}px`
            )
        publish()
        const observer = new ResizeObserver(publish)
        observer.observe(el)
        return () => {
            observer.disconnect()
            document.documentElement.style.removeProperty(
                "--pinboard-bottom-inset"
            )
        }
    }, [])
    return (
        <div
            ref={containerRef}
            data-search-overlay
            className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 px-4 py-3 shadow-md"
        >
            <SearchBarRow
                variant="overlay"
                onRefresh={onRefresh}
                isFetching={isFetching}
                nResults={nResults}
                resultMetrics={resultMetrics}
                countMetrics={countMetrics}
            />
        </div>
    )
}
