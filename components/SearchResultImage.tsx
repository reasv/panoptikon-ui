"use client"
import Image from 'next/image'
import { BookmarkBtn, FilePathComponent, OpenFile, OpenFolder } from "@/components/imageButtons"
import { useCallback, useEffect, useRef } from "react";
import { cn, getFullFileURL, getLocale, getThumbnailURL } from "@/lib/utils";
import { components } from "@/lib/panoptikon";
import { useGallery } from "@/lib/state/gallery";
import { OpenDetailsButton } from "@/components/OpenFileDetails";

export function SearchResultImage({
    result,
    index,
    dbs,
    imageClassName,
    imageContainerClassName,
    onImageClick
}: {
    result: components["schemas"]["FileSearchResult"],
    index: number,
    dbs: { index_db: string | null, user_data_db: string | null }
    imageClassName?: string
    imageContainerClassName?: string
    onImageClick?: () => void
}) {
    const openGallery = useGallery((state) => state.openGallery)
    const fileUrl = getFullFileURL(result.sha256, dbs)
    const thumbnailUrl = getThumbnailURL(result.sha256, dbs)
    const dateString = getLocale(new Date(result.last_modified))
    const onClick = useCallback(() => {
        if (onImageClick) {
            onImageClick()
        } else {
            openGallery(index)
        }
    }, [onImageClick, openGallery, index])
    return (
        <div className="border rounded p-2">
            <div className="overflow-hidden relative w-full pb-full mb-2 group">
                <a
                    href={fileUrl}
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
