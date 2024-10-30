"use client"
import Image from 'next/image'
import { BookmarkBtn, FilePathComponent, OpenFile, OpenFolder } from "@/components/imageButtons"
import { useCallback, useMemo } from "react";
import { cn, getFileURL, getLocale } from "@/lib/utils";
import { OpenDetailsButton } from "@/components/OpenFileDetails";
import { useSearchParams } from 'next/navigation';
import { getGalleryOptionsSerializer, useGalleryIndex } from '@/lib/state/gallery';
import { PinButton } from './gallery/PinButton';
import { blurHashToDataURL } from '@/lib/state/blurHashDataURL';

export function SearchResultImage({
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
    const dateString = getLocale(new Date(result.last_modified))
    const params = useSearchParams()
    const galleryOpen = useGalleryIndex()[0] !== null

    const imageLink = useMemo(() => {
        if (!galleryLink) return fileUrl
        const queryParams = new URLSearchParams(params)
        const indexUrl = getGalleryOptionsSerializer()(
            queryParams,
            { gi: index }
        )
        return indexUrl
    }, [index, params, nItems, galleryLink, fileUrl])

    const onClick = useCallback(() => {
        if (onImageClick) {
            onImageClick(index)
        }
    }, [onImageClick, index])
    const blurDataURL = useMemo(() => result.blurhash ? blurHashToDataURL(result.blurhash) : undefined, [result.blurhash])
    return (
        <div className={cn("border rounded p-2", className)}>
            <div className={cn("overflow-hidden relative w-full pb-full mb-2",
                showLoadingSpinner ? "" : "group"
            )}>
                <a
                    href={galleryLink ? imageLink : fileUrl}
                    target="_blank"
                    onClick={(e) => {
                        e.preventDefault()
                        onClick()
                    }}
                    rel="noopener noreferrer"
                    className={cn("block relative mb-2 h-96 4xl:h-[30rem] 5xl:h-[38rem]", imageContainerClassName)}
                >
                    <Image
                        src={thumbnailUrl}
                        alt={`Result ${result.path}`}
                        fill
                        placeholder={blurDataURL ? 'blur' : 'empty'}
                        blurDataURL={blurDataURL}
                        className={cn(
                            "object-cover object-top",
                            showLoadingSpinner ? "" : "group-hover:object-contain group-hover:object-center",
                            imageClassName)}
                        unoptimized
                    />
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
                <BookmarkBtn sha256={result.sha256} />
                <OpenFile sha256={result.sha256} path={result.path} />
                <OpenFolder sha256={result.sha256} path={result.path} />
                <OpenDetailsButton item={result} variantButton />
                {galleryOpen && (<PinButton sha256={result.sha256} />)}
            </div>
            <FilePathComponent path={result.path} />
            <p className="text-xs text-gray-500">
                {dateString}
            </p>
        </div>
    )
}
