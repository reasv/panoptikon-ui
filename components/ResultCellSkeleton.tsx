import { memo } from "react"
import { cn } from "@/lib/utils"

/**
 * A result card's frame with nothing in it yet: what a scroll-mode grid cell
 * renders while the chunk holding its row is in flight
 * (docs/search-scroll-mode-design.md §3). Not an end-of-results marker — the
 * chunk store's `get` returns undefined for "not loaded", and the grid only
 * renders cells below the known item count.
 *
 * EVERY class here is copied verbatim from SearchResultImage's frame, and
 * that is load-bearing rather than tidy. Scroll mode derives ONE row height by
 * measuring the first row that mounts, and on a deep-linked load that row can
 * easily be all skeletons; a skeleton a few pixels shorter than a card would
 * then become the height of every row in the set. The two text lines keep an
 * `&nbsp;` so their line boxes come from the same font metrics as the real
 * path and date, with the pulse drawn over them rather than in place of them.
 *
 * `bg-muted` rather than the shared `Skeleton` primitive
 * (components/ui/skeleton.tsx), whose `bg-slate-100` is a light-mode-only
 * value: this renders a screenful at a time, so bright blocks over the dark
 * theme would not be a detail.
 *
 * Memoized for the same reason SearchResultImage is, and its one prop is a
 * plain number so the memo still holds: the grid that renders these is
 * `"use no memo"` (TanStack Virtual re-renders it by mutating internal state,
 * once a scroll frame), and a screenful of skeletons is exactly the state a
 * deep-linked load scrolls in.
 */
export const ResultCellSkeleton = memo(function ResultCellSkeleton({
    imageHeightPx,
    className,
}: {
    /**
     * The picture box's height under an explicit cell size (design §9), where
     * the breakpoint classes no longer describe it. Omitted keeps them — and
     * passing it through matters for the same reason every class here is
     * copied verbatim: this is one of the rows scroll mode may measure its one
     * row height from.
     */
    imageHeightPx?: number
    /**
     * The frame extra of the card this stands in for, matching
     * SearchResultImage's own `className` prop. The GRID never passes one — its
     * cards do not either, and the verbatim-classes rule above is about that
     * case. The similarity-target panel does, because there the skeleton and
     * the card it becomes are the same box in the same layout.
     */
    className?: string
}) {
    return (
        <div className={cn("border rounded p-2", className)} aria-hidden="true">
            <div className="overflow-hidden relative w-full pb-full mb-2">
                <div
                    className={imageHeightPx == null
                        ? "block relative mb-2 h-96 4xl:h-120 5xl:h-152"
                        : "block relative mb-2"}
                    style={imageHeightPx == null ? undefined : { height: imageHeightPx }}
                >
                    <div className="absolute inset-0 animate-pulse rounded bg-muted" />
                </div>
            </div>
            {/* The path line (text-sm truncate) and the date line (text-xs) */}
            <p className="text-sm truncate relative">
                &nbsp;
                <span className="absolute inset-y-1 left-0 w-3/5 animate-pulse rounded bg-muted" />
            </p>
            <p className="text-xs text-gray-500 relative">
                &nbsp;
                <span className="absolute inset-y-0.5 left-0 w-1/4 animate-pulse rounded bg-muted" />
            </p>
        </div>
    )
})
