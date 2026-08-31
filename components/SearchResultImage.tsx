"use client"
import Image from 'next/image'
import { BookmarkBtn, FileActionCluster, FilePathComponent } from "@/components/imageButtons"
import { memo, useCallback, useMemo } from "react";
import { cn, getFileURL } from "@/lib/utils";
import { ItemMetaLine } from "@/components/ItemMetaLine";
import { PlayableBadge, isPlayableItem } from "@/components/PlayableBadge";
import { OpenDetailsButton } from "@/components/OpenFileDetails";
import { PinButton } from './gallery/PinButton';
import { blurHashToDataURL } from '@/lib/state/blurHashDataURL';
import { useCellCallbacks } from '@/lib/state/cellActions';

// Memoized: the virtualized grid re-renders on every scroll frame (tanstack
// virtual mutates state under "use no memo"), and without this each visible
// card re-executes per frame. Callers must keep object/function props
// referentially stable for the memo to hold.
export const SearchResultImage = memo(function SearchResultImage({
    result,
    index,
    dbs,
    imageClassName,
    imageContainerClassName,
    className,
    onImageClick,
    galleryLink,
    overrideURL,
    showLoadingSpinner
}: {
    result: SearchResult,
    index: number,
    dbs: { index_db: string | null, user_data_db: string | null }
    imageClassName?: string
    imageContainerClassName?: string
    className?: string
    onImageClick?: (index?: number) => void
    galleryLink?: boolean
    overrideURL?: string
    showLoadingSpinner?: boolean
}) {
    const fileUrl = overrideURL ? overrideURL : getFileURL(dbs, "file", "sha256", result.sha256)
    const thumbnailUrl = getFileURL(dbs, "thumbnail", "sha256", result.sha256)
    // Deliberately NOT a `useSearchParams` of its own. This card used to hold
    // one and rebuild its gallery href behind a `useMemo` keyed on the params
    // object — i.e. it recomputed on EVERY URL write, for every visible card,
    // and the subscription alone re-rendered the card body regardless of the
    // memo. The href now comes from the page's one CellActionsHost through a
    // callbacks object whose identity never changes, so reading it costs this
    // card nothing (lib/state/cellActions.ts).
    const { galleryHref } = useCellCallbacks()
    const imageLink = galleryLink ? galleryHref(index) : fileUrl

    const onClick = useCallback(() => {
        if (onImageClick) {
            onImageClick(index)
        }
    }, [onImageClick, index])
    const blurDataURL = useMemo(() => result.blurhash ? blurHashToDataURL(result.blurhash) : undefined, [result.blurhash])
    // The one refresh for the anchor's href — see the comment on the anchor.
    const refreshHref = galleryLink
        ? (event: React.SyntheticEvent<HTMLAnchorElement>) => {
            event.currentTarget.href = galleryHref(index)
        }
        : undefined
    const handleDragStart = (event: React.DragEvent<HTMLImageElement | HTMLAnchorElement | HTMLDivElement>): void => {
        if (!fileUrl) return;
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/plain', result.sha256);
        event.dataTransfer.setData('text/uri-list', fileUrl);
    }
    return (
        <div className={cn("border rounded p-2", className)}>
            <div className={cn("overflow-hidden relative w-full pb-full mb-2",
                showLoadingSpinner ? "" : "group"
            )}
                onDragStart={handleDragStart}
                draggable={true}
            >
                <a
                    href={imageLink}
                    target="_blank"
                    // COMPUTED ONCE, refreshed only by the handlers below.
                    // `galleryHref` has a fixed identity and `index` is stable
                    // for a mounted card, so the value rendered here never
                    // recomputes on its own — the card deliberately does not
                    // re-render on a URL write (that is the whole point), and
                    // there is NO fallback recompute behind these handlers.
                    // Between them they cover every gesture that can consume an
                    // href: mouseenter (hover, which precedes middle click,
                    // "open in new tab", copy link address and drag), mousedown
                    // (a middle click after a wheel scroll that crossed no
                    // hover boundary — mousedown precedes the default action),
                    // contextmenu (including the keyboard menu key, which fires
                    // no mouse event) and focus (keyboard navigation). The
                    // plain left click never reads the href at all
                    // (preventDefault + onImageClick).
                    //
                    // ACCEPTED RESIDUAL: writing `currentTarget.href` is an
                    // imperative DOM write React does not know about, so a
                    // later render whose RENDERED href is unchanged may skip
                    // the attribute write and leave our value standing. Not
                    // reachable in practice — every navigation path is preceded
                    // by one of these handlers, each of which writes the
                    // current value.
                    onMouseEnter={refreshHref}
                    onMouseDown={refreshHref}
                    onContextMenu={refreshHref}
                    onFocus={refreshHref}
                    onClick={(e) => {
                        e.preventDefault()
                        onClick()
                    }}
                    // onDragStart={handleDragStart}
                    rel="noopener noreferrer"
                    className={cn("block relative mb-2 h-96 4xl:h-120 5xl:h-152", imageContainerClassName)}
                >
                    <Image
                        src={thumbnailUrl}
                        alt={`Result ${result.path}`}
                        fill
                        // The blurhash PNG data URL is handed to `placeholder`
                        // DIRECTLY. `placeholder="blur"` is FORBIDDEN on this
                        // card and must not be reintroduced: with it, next/image
                        // wraps the PNG in a ~6 KB `data:image/svg+xml` document
                        // carrying a feGaussianBlur graph, UNIQUE per item.
                        // Blink treats an SVG used as an image as its own
                        // isolated Document (own style resolver, own layout
                        // tree), so a virtualized grid mints one Document per
                        // cell mount — ~12/s at scroll speed, faster than GC
                        // reclaims them. Measured: live Documents 31 -> 901 over
                        // a 180 s scroll and p90 frame time 8.4 -> 33.6 ms, while
                        // passing the data URL straight through (plain
                        // `background-image: url(<png>)`, no SVG, no Document)
                        // holds Documents at 1 and the frame time flat.
                        // `?? 'empty'` is load-bearing: next/image THROWS at
                        // render for any placeholder string that is not 'blur',
                        // 'empty' or a `data:image/…` URL.
                        placeholder={blurDataURL ?? 'empty'}
                        // draggable={true}
                        className={cn(
                            "object-cover object-top",
                            showLoadingSpinner ? "" : "group-hover:object-contain group-hover:object-center",
                            imageClassName)}
                        unoptimized
                    />
                    {/* INSIDE the anchor, not beside it: the anchor is
                        exactly the picture box (`block relative h-96`, with
                        the Image filling it), while the wrapper around it is
                        taller by the anchor's own `mb-2` — centring on the
                        wrapper would sit the badge a few pixels low. (The
                        wrapper's `pb-full` is a dead class and generates no
                        CSS, so it is not squaring anything off either.)
                        Harmless inside the link because the badge takes no
                        pointer events, so the click and the drag still belong
                        to the anchor. */}
                    {isPlayableItem(result) && <PlayableBadge />}
                </a>
                {showLoadingSpinner && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white bg-opacity-50">
                        <Image
                            src="/spinner.svg"
                            alt="Loading..."
                            width={110}
                            height={110}
                        />
                    </div>
                )}
                <BookmarkBtn sha256={result.sha256} bookmarked={result.bookmarked} />
                <FileActionCluster sha256={result.sha256} path={result.path} />
                <OpenDetailsButton item={result} variantButton />
                <PinButton sha256={result.sha256} />
            </div>
            <FilePathComponent path={result.path} />
            <ItemMetaLine item={result} className="text-gray-500" />
        </div>
    )
})
