"use client"
import { $api } from "@/lib/api"
import Image from 'next/image'
import { PageSelect } from "@/components/pageselect";
import { BookmarkBtn, FilePathComponent, OpenFile, OpenFolder } from "@/components/imageButtons"
import { useAdvancedOptions, useDatabase, useInstantSearch, useItemSelection, useSearchQuery } from "@/lib/zust"
import { Toggle } from "@/components/ui/toggle"

import { Settings, RefreshCw, X, ArrowBigLeft, ArrowBigRight, GalleryHorizontal } from "lucide-react"
import { AnimatedNumber } from "@/components/ui/animatedNumber"
import { keepPreviousData } from "@tanstack/react-query"
import { InstantSearchLock } from "@/components/InstantSearchLock"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { SearchBar } from "@/components/searchBar"
import { useCallback, useEffect, useRef } from "react";
import { SearchErrorToast } from "@/components/searchErrorToaster";
import { cn, getFullFileURL, getLocale, getThumbnailURL } from "@/lib/utils";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { components } from "@/lib/panoptikon";
import { useGallery } from "@/lib/gallery";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { SideBar } from "@/components/sidebar/SideBar";
import { OpenDetailsButton } from "@/components/OpenFileDetails";

export function SearchResultImage({
    result,
    index,
    dbs,
    imageClassName,
    imageContainerClassName
}: {
    result: components["schemas"]["FileSearchResult"],
    index: number,
    dbs: { index_db: string | null, user_data_db: string | null }
    imageClassName?: string
    imageContainerClassName?: string
}) {
    const openGallery = useGallery((state) => state.openGallery)
    const fileUrl = getFullFileURL(result.sha256, dbs)
    const thumbnailUrl = getThumbnailURL(result.sha256, dbs)
    const dateString = getLocale(new Date(result.last_modified))
    return (
        <div className="border rounded p-2">
            <div className="overflow-hidden relative w-full pb-full mb-2 group">
                <a
                    href={fileUrl}
                    target="_blank"
                    onClick={(e) => {
                        e.preventDefault()
                        openGallery(index)
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
