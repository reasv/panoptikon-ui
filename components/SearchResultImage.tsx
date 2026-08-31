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
    nItems,
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
    nItems?: number
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
                    // The card no longer re-renders on every URL write (that
                    // is the whole point), so the href it rendered with can be
                    // one presentation-param write behind — a stale `top`,
                    // say. Refreshed here because hover PRECEDES every gesture
                    // that can consume an href: middle click, "open in new
                    // tab", copy link address, drag. The plain click below
                    // never reads it (preventDefault + onImageClick), and the
                    // next real render recomputes it from the live params.
                    onMouseEnter={galleryLink
                        ? (e) => { e.currentTarget.href = galleryHref(index) }
                        : undefined}
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
                        placeholder={blurDataURL ? 'blur' : 'empty'}
                        blurDataURL={blurDataURL}
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
