import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination"
import { useMediaQuery } from "@/hooks/use-media-query";
import type { DerivedPageStore } from "@/lib/state/derivedPage";
import { useSideBarOpen } from "@/lib/state/sideBar";
import { ReadonlyURLSearchParams, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * What the bar highlights: a plain page number, or — in scroll mode — the
 * derived-page box the grid writes to (lib/state/derivedPage.ts).
 *
 * A union rather than two components, so every call site keeps ONE four-prop
 * switch (`totalPages`/`currentPage`/`setPage`/`getPageURL`, chosen by mode)
 * and every surface that merely forwards those props — SearchOverlay's dock
 * bar does — needs to know nothing about where the number comes from.
 */
export type PageIndicator = number | DerivedPageStore

/**
 * The indicator's current value, subscribed to when it is a box.
 *
 * The whole point of the box lives in this one line: a virtual-page crossing
 * re-renders THIS component and nothing above it, where the same crossing used
 * to re-render MultiSearchView, GridPanel and every grid row. The number
 * branch is a `useSyncExternalStore` that can never fire — the value is already
 * a render input, so it arrives by re-render as it always has — which is what
 * keeps the hook order unconditional.
 */
const NEVER_NOTIFIES = () => () => { }
function useIndicatedPage(indicator: PageIndicator): number {
    const store = typeof indicator === "number" ? null : indicator
    const subscribe = store ? store.subscribe : NEVER_NOTIFIES
    // Both snapshots are the same function: the server render has no box to
    // read either way, and a fixed number is the honest answer on both sides.
    const snapshot = useCallback(
        () => (store ? store.get() : (indicator as number)),
        [store, indicator]
    )
    return useSyncExternalStore(subscribe, snapshot, snapshot)
}

const range = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, i) => start + i);
export function PageSelect({
    totalPages,
    currentPage: indicator,
    setPage,
    getPageURL
}: {
    totalPages: number;
    currentPage: PageIndicator;
    setPage: (page: number) => void;
    getPageURL: (base: ReadonlyURLSearchParams | URLSearchParams, newPage: number) => string
}) {
    const currentPage = useIndicatedPage(indicator)
    const [sidebarOpen, _] = useSideBarOpen()
    const isMobile = useMediaQuery("(max-width: 768px)")
    const isTablet = useMediaQuery("(max-width: 1024px)")
    const isSmallDesktop = useMediaQuery("(max-width: 1280px)")
    const isMediumDesktop = useMediaQuery("(max-width: 1536px)")
    const isMediumLargeDesktop = useMediaQuery("(max-width: 1920px)")
    let maxPagesButtons = isMobile ? 5 : isTablet ? 10 : isSmallDesktop ? 15 : isMediumDesktop ? 20 : isMediumLargeDesktop ? 25 : 35
    if (sidebarOpen) {
        maxPagesButtons = isMobile ? 5 : isTablet ? 5 : isSmallDesktop ? 7 : isMediumDesktop ? 10 : isMediumLargeDesktop ? 20 : 25
    }
    // Reserve 2 slots for the first and last pages
    const min_pages = 2;
    let visible_pages = Math.max(maxPagesButtons - min_pages, 1);

    let showLeftEllipsis = false;
    let showRightEllipsis = false;

    // Determine if we need ellipses and adjust visible_pages
    if (currentPage > Math.ceil(visible_pages / 2) + 1) {
        showLeftEllipsis = true;
        visible_pages -= 1; // Account for the left ellipsis
    }
    if (currentPage < totalPages - Math.floor(visible_pages / 2) - 1) {
        showRightEllipsis = true;
        visible_pages -= 1; // Account for the right ellipsis
    }

    // Calculate the middle pages range
    const half_visible_pages = Math.floor(visible_pages / 2);
    let startPage = Math.max(currentPage - half_visible_pages, 2);
    let endPage = Math.min(currentPage + half_visible_pages, totalPages - 1);

    // Adjust if near the start
    if (startPage <= 2) {
        startPage = 2;
        endPage = Math.min(startPage + visible_pages - 1, totalPages - 1);
    }

    // Adjust if near the end
    if (endPage >= totalPages - 1) {
        endPage = totalPages - 1;
        startPage = Math.max(endPage - visible_pages + 1, 2);
    }

    const params = useSearchParams()
    // One URL build per page number, kept for as long as the URL and the link
    // builder stand still. The bar renders up to 35 links, each of which
    // copies the whole search URL (`new URLSearchParams(base)` over a query
    // string that routinely carries dozens of filter parameters) — and in
    // scroll mode it re-renders on every virtual-page crossing, where at most
    // two of those 35 numbers are new. Correct because the builder is a pure
    // function of `(params, page)`: `getScrollPositionURL` closes over k and
    // the gallery flag, and `getPageURL`'s identity moves when those do.
    const hrefFor = useMemo(() => {
        const cache = new Map<number, string>()
        return (page: number) => {
            let href = cache.get(page)
            if (href === undefined) {
                href = getPageURL(params, page)
                cache.set(page, href)
            }
            return href
        }
    }, [params, getPageURL])

    return (
        <Pagination className="mt-4">
            <PaginationContent>
                {/* Previous Button */}
                <PaginationItem>
                    <PaginationPrevious
                        href={hrefFor(Math.max(1, currentPage - 1))}
                        onClick={(e) => {
                            e.preventDefault();
                            if (currentPage > 1) setPage(currentPage - 1);
                        }}
                    />
                </PaginationItem>

                {/* First Page */}
                <PaginationItem>
                    <PaginationLink
                        href={hrefFor(1)}
                        isActive={1 === currentPage}
                        onClick={(e) => {
                            e.preventDefault();
                            setPage(1);
                        }}
                    >
                        1
                    </PaginationLink>
                </PaginationItem>

                {/* Ellipsis before middle pages */}
                {showLeftEllipsis && (
                    <PaginationItem>
                        <PaginationEllipsis />
                    </PaginationItem>
                )}

                {/* Middle Pages */}
                {range(startPage, endPage).map((page) => (
                    <PaginationItem key={page}>
                        <PaginationLink
                            href={hrefFor(page)}
                            isActive={page === currentPage}
                            onClick={(e) => {
                                e.preventDefault();
                                setPage(page);
                            }}
                        >
                            {page}
                        </PaginationLink>
                    </PaginationItem>
                ))}

                {/* Ellipsis after middle pages */}
                {showRightEllipsis && (
                    <PaginationItem>
                        <PaginationEllipsis />
                    </PaginationItem>
                )}

                {/* Last Page */}
                <PaginationItem>
                    <PaginationLink
                        href={hrefFor(totalPages)}
                        isActive={totalPages === currentPage}
                        onClick={(e) => {
                            e.preventDefault();
                            setPage(totalPages);
                        }}
                    >
                        {totalPages}
                    </PaginationLink>
                </PaginationItem>

                {/* Next Button */}
                <PaginationItem>
                    <PaginationNext
                        href={hrefFor(Math.min(totalPages, currentPage + 1))}
                        onClick={(e) => {
                            e.preventDefault();
                            if (currentPage < totalPages) setPage(currentPage + 1);
                        }}
                    />
                </PaginationItem>
            </PaginationContent>
        </Pagination>
    );
}