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
 */
export function ResultCellSkeleton() {
    return (
        <div className="border rounded p-2" aria-hidden="true">
            <div className="overflow-hidden relative w-full pb-full mb-2">
                <div className="block relative mb-2 h-96 4xl:h-120 5xl:h-152">
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
}
