'use client'

import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useVirtualizer } from '@tanstack/react-virtual'
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { useSearchParams } from 'next/navigation'
import { BookmarkBtn } from "@/components/imageButtons"
import { ScrollBar } from "@/components/ui/scroll-area"
import { cn, getFileURL } from "@/lib/utils"
import { useGalleryIndex, getGalleryOptionsSerializer } from "@/lib/state/gallery"
import { useSelectedDBs } from "@/lib/state/database"
import { useItemSelection } from "@/lib/state/itemSelection"
import { PinButton } from './PinButton'
import { FindButton } from './FindButton'
import { blurHashToDataURL } from '@/lib/state/blurHashDataURL'
import { useSearchLoading } from '@/lib/state/zust'

export function VirtualGalleryHorizontalScroll({
    items,
}: {
    items: SearchResult[]
}) {
    const parentRef = useRef<HTMLDivElement>(null)

    const virtualizer = useVirtualizer({
        count: items.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 256,
        horizontal: true,
    })

    const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        if (parentRef.current) {
            const delta = e.deltaY
            parentRef.current.scrollLeft += delta
        }
    }, [])
    const [qIndex, setIndex] = useGalleryIndex()
    useEffect(() => {
        virtualizer.scrollToIndex((qIndex || 0) % items.length)

    }, [items, items.length, qIndex, virtualizer])

    return (
        <ScrollAreaPrimitive.Root onWheel={onWheel} className="relative overflow-hidden w-full whitespace-nowrap rounded-md border">
            <ScrollAreaPrimitive.Viewport ref={parentRef} className="h-full w-full rounded-[inherit]">
                <div
                    className="flex h-[22rem]"
                    style={{
                        width: `${virtualizer.getTotalSize()}px`,
                        position: 'relative',
                    }}
                >
                    {virtualizer.getVirtualItems().map((virtualItem) => (
                        <VirtualHorizontalScrollElement
                            key={items[virtualItem.index].file_id}
                            item={items[virtualItem.index]}
                            ownIndex={virtualItem.index}
                            nItems={items.length}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: `${virtualItem.size}px`,
                                transform: `translateX(${virtualItem.start}px)`,
                            }}
                        />
                    ))}
                </div>
            </ScrollAreaPrimitive.Viewport>
            <ScrollBar orientation="horizontal" />
            <ScrollAreaPrimitive.Corner />
        </ScrollAreaPrimitive.Root>
    )
}

function VirtualHorizontalScrollElement({
    item,
    ownIndex,
    nItems,
    style,
}: {
    item: SearchResult
    ownIndex: number
    nItems: number
    style: React.CSSProperties
}) {
    const [qIndex, setIndex] = useGalleryIndex()
    const isSelected = useMemo(() => ownIndex === ((qIndex || 0) % nItems), [qIndex, nItems, ownIndex])
    const [dbs] = useSelectedDBs()
    const setSelected = useItemSelection((state) => state.setItem)
    const thumbnailURL = getFileURL(dbs, "thumbnail", "sha256", item.sha256)
    const params = useSearchParams()

    const imageLink = useMemo(() => {
        const queryParams = new URLSearchParams(params)
        const indexUrl = getGalleryOptionsSerializer()(queryParams, { gi: ownIndex % nItems })
        return indexUrl
    }, [ownIndex, params, nItems])

    const onClick = (e: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
        e.preventDefault()
        setIndex(ownIndex % nItems)
        setSelected(item)
    }
    const blurDataURL = useMemo(() => item.blurhash ? blurHashToDataURL(item.blurhash) : undefined, [item.blurhash])
    const searchLoading = useSearchLoading(state => state.loading)
    return (
        <div
            style={{
                ...style,
                width: '240px',
                padding: '16px',
            }}
        >
            <figure
                className={cn(
                    "w-[240px] h-80 relative rounded-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none cursor-pointer group",
                    isSelected ? "scale-105 ring-2 ring-blue-500" : "scale-100"
                )}
            >
                <Link href={imageLink} onClick={onClick}>
                    <div className="w-full h-full relative">
                        <Image
                            src={thumbnailURL}
                            alt={item.path}
                            className="object-cover object-top rounded-md cursor-pointer"
                            fill
                            placeholder={blurDataURL ? 'blur' : 'empty'}
                            blurDataURL={blurDataURL}
                            unoptimized={true}
                            sizes="240px"
                        />
                    </div>
                </Link>
                {searchLoading && (
                    <div className="absolute inset-0 z-10 flex items-center rounded-md justify-center bg-white bg-opacity-50">
                        <Image
                            src="/spinner.svg"
                            alt="Loading..."
                            width={110}
                            height={110}
                        />
                    </div>
                )}
                <BookmarkBtn sha256={item.sha256} />
                <PinButton sha256={item.sha256} />
                <FindButton
                    id={item.file_id}
                    id_type='file_id'
                    path={item.path}
                />
            </figure>
        </div>
    )
}