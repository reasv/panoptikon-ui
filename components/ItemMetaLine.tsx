import { cn, getLocale, prettyPrintBytesCompact, prettyPrintVideoDuration } from "@/lib/utils"

/**
 * The one metadata line under a file's path, shared by every surface that
 * shows one: the search grid's cards (components/SearchResultImage.tsx), the
 * gallery header (components/gallery/ImageGallery.tsx) and the maximized
 * board's viewer header (app/search/PreviewSurface.tsx). Three copies of
 * "path, then a muted line" had already drifted — the cards showed only a
 * date while the headers had gained a size — which is exactly the drift one
 * component prevents.
 *
 * FIELDS, IN PRIORITY ORDER (left to right, most important first):
 *
 *     modified date · size · resolution · duration
 *
 * and that order is doing two jobs at once. It is the reading order, and it
 * is also the DROP order read backwards: everything degrades from the right,
 * so whatever is lost is always the least important thing still showing.
 * Duration and resolution are absent entirely for items that have none — a
 * still image has no duration, and rows from older scans carry no dimensions
 * — so "(where applicable)" needs no separate rule.
 *
 * HOW IT DEGRADES, and why this mechanism and not a better-looking one:
 *
 * The honest implementation is to measure the rendered segments against the
 * available width and drop from the right until it fits. That is off the
 * table here, and specifically because of the grid: SearchResultImage is
 * memoized with a comment saying the virtualized grid re-renders every
 * visible card on every scroll frame, so a ResizeObserver (or any
 * measure-then-drop pass) per card lands in the hottest loop in the app,
 * hundreds of instances at a time.
 *
 * Container queries buy the same behaviour for nothing: the line declares
 * itself a container and each field past the date appears only once the line
 * is wide enough to have held it. No JS, no observers, no layout reads, and
 * it re-evaluates on resize for free. The cost is that the thresholds are
 * PREDICTIONS about text widths rather than measurements of them — a long
 * locale date or a four-digit-per-axis resolution can still overflow a
 * threshold that admitted it.
 *
 * Which is what `truncate` is for, and why the field order matters twice
 * over: an overflow ellipsis eats the END of the line, so the thing it
 * mangles is the last field showing — the least important one — and never
 * the date. That is the stated rule ("only use ellipsis for the date, as a
 * last resort") satisfied structurally: the date can only be truncated when
 * it is the ONLY thing left, because everything to its right has already
 * been dropped by a threshold.
 *
 * Nothing is ever lost, whatever the width: `title` carries every field the
 * item has, labelled, one per line.
 *
 * TUNING: the three thresholds below are the entire policy. Raising one
 * makes that field rarer; the surfaces need no changes for it.
 *
 * ONE SIDE EFFECT WORTH KNOWING. `container-type: inline-size` carries
 * `contain: inline-size`, so this line no longer contributes to its parent's
 * intrinsic width — a container sized by its content now sizes to the PATH
 * above it alone. That is fine at all three call sites and not by luck: the
 * grid card's width comes from the grid, and both headers put a
 * `FilePathComponent` in the same box, whose max-content is a full file path
 * and therefore always the larger of the two. A future surface that pairs
 * this line with something SHORT would find its box narrower than the line
 * wants, and would need an explicit width rather than a content-sized one.
 */

// Widths at which each field past the date earns its place, as container
// queries on the line itself. Deliberately generous rather than tight: a
// threshold set too LOW produces an ellipsis (the failure the order above is
// arranged to keep away from the date), while one set too HIGH merely omits
// a field that is still in the title. Estimated at text-xs against the
// longest plausible value of each field, plus its separator.
const SHOW_SIZE = "hidden @[13rem]/meta:inline"
const SHOW_RESOLUTION = "hidden @[18rem]/meta:inline"
const SHOW_DURATION = "hidden @[23rem]/meta:inline"

/**
 * A field's separator, carrying its own space on BOTH sides.
 *
 * Inside the field's own span, never between spans, so a field hidden by its
 * container query takes its separator with it — otherwise the line ends on a
 * dangling "·" at every threshold.
 */
function Sep() {
    return <span className="mx-2">·</span>
}

/**
 * `w×h`, from the item's STORED dimensions.
 *
 * KNOWN CAVEAT, deliberately shipped: those are the CODED dimensions — the
 * scanner does not read EXIF orientation — so an EXIF-rotated photo reads
 * transposed here (a portrait phone photo as `4032×3024`). This is not new
 * wrongness: the Data View's own resolution line has always shown the same
 * pair, and the maximized viewer carries a whole aspect-confirmation
 * machinery precisely because the stored pair lies for these items. The fix
 * is the display-dimensions scan work, not a correction here — a second
 * place guessing at orientation is how the two would end up disagreeing.
 */
function resolutionOf(item: SearchResult): string | null {
    if (!item.width || !item.height) return null
    return `${item.width}×${item.height}`
}

// > 0, not != null: `duration` is a three-state column (null = unprobed,
// 0 = a still, > 0 = it plays), and both of the first two mean "no duration
// to show" — an animated image with a measured span is as much a duration as
// a video's.
function durationOf(item: SearchResult): string | null {
    return item.duration && item.duration > 0
        ? prettyPrintVideoDuration(item.duration)
        : null
}

export function ItemMetaLine({
    item,
    className,
}: {
    item: SearchResult
    /** The surface's own text colour; the layout rules are all in here. */
    className?: string
}) {
    const date = getLocale(new Date(item.last_modified))
    const size = item.size != null ? prettyPrintBytesCompact(item.size) : null
    const resolution = resolutionOf(item)
    const duration = durationOf(item)
    // Labelled and one per line: a tooltip is read, not glanced at, and it is
    // the only place the omitted fields exist. Built from the same values the
    // line renders, so it cannot describe a different file.
    const title = [
        `Modified: ${date}`,
        size && `Size: ${size}`,
        resolution && `Resolution: ${resolution}`,
        duration && `Duration: ${duration}`,
    ].filter(Boolean).join("\n")
    return (
        <p
            className={cn("@container/meta text-xs truncate", className)}
            title={title}
        >
            {date}
            {size && <span className={SHOW_SIZE}><Sep />{size}</span>}
            {resolution && (
                <span className={SHOW_RESOLUTION}><Sep />{resolution}</span>
            )}
            {duration && (
                <span className={SHOW_DURATION}><Sep />{duration}</span>
            )}
        </p>
    )
}
