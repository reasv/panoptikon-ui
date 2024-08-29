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
import { useAdvancedOptions } from "@/lib/zust";
const range = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, i) => start + i);
export function PageSelect({
    total_pages,
    current_page,
    setPage
}: {
    total_pages: number;
    current_page: number;
    setPage: (page: number) => void;
}) {
    const sidebarOpen = useAdvancedOptions((state) => state.isOpen)
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
    if (current_page > Math.ceil(visible_pages / 2) + 1) {
        showLeftEllipsis = true;
        visible_pages -= 1; // Account for the left ellipsis
    }
    if (current_page < total_pages - Math.floor(visible_pages / 2) - 1) {
        showRightEllipsis = true;
        visible_pages -= 1; // Account for the right ellipsis
    }

    // Calculate the middle pages range
    const half_visible_pages = Math.floor(visible_pages / 2);
    let startPage = Math.max(current_page - half_visible_pages, 2);
    let endPage = Math.min(current_page + half_visible_pages, total_pages - 1);

    // Adjust if near the start
    if (startPage <= 2) {
        startPage = 2;
        endPage = Math.min(startPage + visible_pages - 1, total_pages - 1);
    }

    // Adjust if near the end
    if (endPage >= total_pages - 1) {
        endPage = total_pages - 1;
        startPage = Math.max(endPage - visible_pages + 1, 2);
    }

    return (
        <Pagination className="mt-4">
            <PaginationContent>
                {/* Previous Button */}
                <PaginationItem>
                    <PaginationPrevious
                        href="#"
                        onClick={(e) => {
                            e.preventDefault();
                            if (current_page > 1) setPage(current_page - 1);
                        }}
                    />
                </PaginationItem>

                {/* First Page */}
                <PaginationItem>
                    <PaginationLink
                        href="#"
                        isActive={1 === current_page}
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
                            href="#"
                            isActive={page === current_page}
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
                        href="#"
                        isActive={total_pages === current_page}
                        onClick={(e) => {
                            e.preventDefault();
                            setPage(total_pages);
                        }}
                    >
                        {total_pages}
                    </PaginationLink>
                </PaginationItem>

                {/* Next Button */}
                <PaginationItem>
                    <PaginationNext
                        href="#"
                        onClick={(e) => {
                            e.preventDefault();
                            if (current_page < total_pages) setPage(current_page + 1);
                        }}
                    />
                </PaginationItem>
            </PaginationContent>
        </Pagination>
    );
}