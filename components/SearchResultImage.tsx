"use client"
import Image from 'next/image'
import { BookmarkBtn, FilePathComponent, OpenFile, OpenFolder } from "@/components/imageButtons"
import { useCallback, useEffect, useMemo, useRef } from "react";
import { cn, getFullFileURL, getLocale, getThumbnailURL } from "@/lib/utils";
import { components } from "@/lib/panoptikon";
import { OpenDetailsButton } from "@/components/OpenFileDetails";
import { useSearchParams } from 'next/navigation';
import { getGalleryOptionsSerializer, useGalleryName } from '@/lib/state/gallery';

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
    overrideURL
}: {
    result: components["schemas"]["FileSearchResult"],
    index: number,
    dbs: { index_db: string | null, user_data_db: string | null }
    imageClassName?: string
    imageContainerClassName?: string
    className?: string
    onImageClick?: (index?: number) => void
    nItems?: number
    galleryLink?: boolean
    overrideURL?: string
}) {
    const fileUrl = overrideURL ? getFullFileURL(result.sha256, dbs) : overrideURL
    const thumbnailUrl = getThumbnailURL(result.sha256, dbs)
    const dateString = getLocale(new Date(result.last_modified))
    const params = useSearchParams()
    const [name, _] = useGalleryName()

    const imageLink = useMemo(() => {
        if (!galleryLink) return fileUrl
        const queryParams = new URLSearchParams(params)
        const indexUrl = getGalleryOptionsSerializer(name)(
            queryParams,
            { index: index }
        )
        return indexUrl
    }, [index, name, params, nItems, galleryLink, fileUrl])

    const onClick = useCallback(() => {
        if (onImageClick) {
            onImageClick(index)
        }
    }, [onImageClick, index])

    return (
        <div className={cn("border rounded p-2", className)}>
            <div className="overflow-hidden relative w-full pb-full mb-2 group">
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
                        className={cn("group-hover:object-contain object-cover object-top group-hover:object-center", imageClassName)}
                        unoptimized
                    />
                </a>
                <BookmarkBtn sha256={result.sha256} />
                <OpenFile sha256={result.sha256} path={result.path} />
                <OpenFolder sha256={result.sha256} path={result.path} />
                <OpenDetailsButton item={result} variantButton />
            </div>
            <FilePathComponent path={result.path} />
            <p className="text-xs text-gray-500">
                {dateString}
            </p>
        </div>
    )
}
