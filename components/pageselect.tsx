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
import { useSideBarOpen } from "@/lib/state/sideBar";
import { ReadonlyURLSearchParams, useSearchParams } from "next/navigation";

const range = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, i) => start + i);
export function PageSelect({
    totalPages,
    currentPage,
    setPage,
    getPageURL
}: {
    totalPages: number;
    currentPage: number;
    setPage: (page: number) => void;
    getPageURL: (base: ReadonlyURLSearchParams | URLSearchParams, newPage: number) => string
}) {
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

    return (
        <Pagination className="mt-4">
            <PaginationContent>
                {/* Previous Button */}
                <PaginationItem>
                    <PaginationPrevious
                        href={getPageURL(params, Math.max(1, currentPage - 1))}
                        onClick={(e) => {
                            e.preventDefault();
                            if (currentPage > 1) setPage(currentPage - 1);
                        }}
                    />
                </PaginationItem>

                {/* First Page */}
                <PaginationItem>
                    <PaginationLink
                        href={getPageURL(params, 1)}
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
                            href={getPageURL(params, page)}
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
                        href={getPageURL(params, totalPages)}
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
                        href={getPageURL(params, Math.min(totalPages, currentPage + 1))}
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