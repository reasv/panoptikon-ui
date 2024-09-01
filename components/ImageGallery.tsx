"use client"
import Image from 'next/image'
import { PageSelect } from "@/components/pageselect";
import { BookmarkBtn, FilePathComponent, OpenFile, OpenFolder } from "@/components/imageButtons"
import { useInstantSearch } from "@/lib/state/zust"
import { Toggle } from "@/components/ui/toggle"
import { Settings, RefreshCw, X, ArrowBigLeft, ArrowBigRight, GalleryHorizontal } from "lucide-react"
import { AnimatedNumber } from "@/components/ui/animatedNumber"
import { InstantSearchLock } from "@/components/InstantSearchLock"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { SearchBar } from "@/components/searchBar"
import { useCallback, useEffect, useRef } from "react";
import { SearchErrorToast } from "@/components/searchErrorToaster";
import { cn, getFullFileURL, getLocale, getThumbnailURL } from "@/lib/utils";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { components } from "@/lib/panoptikon";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { SideBar } from "@/components/sidebar/SideBar";
import { OpenDetailsButton } from "@/components/OpenFileDetails";
import { SearchResultImage } from "@/components/SearchResultImage";
import { useItemSelection } from "@/lib/state/itemSelection";
import { Mode, useSearchMode } from "@/lib/state/similarityQuery";
import { useGalleryIndex, useGalleryName, useGalleryThumbnail } from "@/lib/state/gallery";
import { useSideBarOpen } from "@/lib/state/sideBar";
import { useSelectedDBs } from "@/lib/state/database";
import { useItemSimilaritySearch, useSearch } from "@/lib/searchHooks";

export function ImageGallery({
    items,
}: {
    items: components["schemas"]["FileSearchResult"][]
}) {
    const [name, _] = useGalleryName()
    const [qIndex, setIndex] = useGalleryIndex(name)
    const index = (qIndex || 0) % items.length
    const nextImage = () => setIndex((prevIndex) => ((prevIndex || 0) + 1) % items.length)
    const prevImage = () => setIndex((prevIndex) => ((prevIndex || 0) - 1 + items.length) % items.length)
    const closeGallery = () => setIndex(null)

    const [thumbnailsOpen, setThumbnailsOpen] = useGalleryThumbnail(name)

    const setSelectedItem = useItemSelection((state) => state.setItem)
    useEffect(() => {
        setSelectedItem(items[index])
    }, [index, items])

    const currentItem = items[index]

    const dateString = getLocale(new Date(currentItem.last_modified))
    return (
        <div className="flex flex-col border rounded p-2">
            <div className="flex justify-between items-center mb-2">
                <div className="flex items-center">
                    <BookmarkBtn sha256={currentItem.sha256} buttonVariant />
                    <OpenFile sha256={currentItem.sha256} path={currentItem.path} buttonVariant />
                    <OpenFolder sha256={currentItem.sha256} path={currentItem.path} buttonVariant />
                    <Button onClick={() => prevImage()} variant="ghost" size="icon" title="Previous Image">
                        <ArrowBigLeft className="h-4 w-4" />
                    </Button>

                </div>
                <div className="max-w-[33%] text-center">
                    <FilePathComponent path={currentItem.path} />
                    <p className="text-xs text-gray-500 truncate">
                        {dateString}
                    </p>
                </div>
                <div className="flex items-center">
                    <Button onClick={() => nextImage()} variant="ghost" size="icon" title="Next Image">
                        <ArrowBigRight className="h-4 w-4" />
                    </Button>
                    <OpenDetailsButton item={currentItem} />
                    <Toggle
                        pressed={thumbnailsOpen}
                        onClick={() => setThumbnailsOpen(!thumbnailsOpen)}
                        title={thumbnailsOpen ? "Close Thumbnails" : "Open Thumbnails"}
                        aria-label="Toggle auto-update lock"
                    >
                        <GalleryHorizontal className="h-4 w-4" />
                    </Toggle>
                    <Button onClick={() => closeGallery()} variant="ghost" size="icon" title="Close Gallery">
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            </div>
            <GalleryImageLarge
                item={currentItem}
                prevImage={prevImage}
                nextImage={nextImage}
                thumbnailsOpen={thumbnailsOpen}
            />
            {thumbnailsOpen ? <GalleryHorizontalScroll items={items} /> : null}
        </div>
    );
}

export function GalleryImageLarge(
    {
        item,
        thumbnailsOpen,
        prevImage,
        nextImage,
    }: {
        item: components["schemas"]["FileSearchResult"],
        prevImage: () => void,
        nextImage: () => void,
        thumbnailsOpen: boolean
    }
) {
    const [dbs, ___] = useSelectedDBs()
    const thumbnailURL = getThumbnailURL(item.sha256, dbs)
    const fileURL = getFullFileURL(item.sha256, dbs)

    const handleImageClick = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
        const { clientX, currentTarget } = e
        e.stopPropagation()
        const { left, right } = currentTarget.getBoundingClientRect()
        const middle = (left + right) / 2
        if (clientX > middle) {
            nextImage()
        } else {
            prevImage()
        }
    }

    return (
        <div
            className={cn("relative flex-grow flex justify-center items-center overflow-hidden cursor-pointer ",
                thumbnailsOpen ? "h-[calc(100vh-570px)]" : "h-[calc(100vh-215px)]" // Set height based on whether thumbnails
            )}
            onClick={handleImageClick} // Attach click handler to the entire area
        >
            <a
                href={fileURL}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute inset-0"
                onClick={(e) => e.preventDefault()}
            >
                <Image
                    src={thumbnailURL}
                    alt={`${item.path}`}
                    fill
                    className="object-contain"
                    unoptimized={true}
                />
            </a>
        </div>
    )
}

export function GalleryHorizontalScroll({
    items,
}: {
    items: components["schemas"]["FileSearchResult"][]
}) {
    const viewportRef = useRef<HTMLDivElement>(null)
    const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        if (!viewportRef.current || e.deltaY === 0 || e.deltaX !== 0) {
            return
        }

        const delta = e.deltaY
        const currPos = viewportRef.current.scrollLeft
        const scrollWidth = viewportRef.current.scrollWidth
        const clientWidth = viewportRef.current.clientWidth

        const newPos = Math.max(0, Math.min(scrollWidth - clientWidth, currPos + delta))

        viewportRef.current.scrollLeft = newPos
    }, [])

    return (
        <ScrollAreaPrimitive.Root onWheel={onWheel} className={cn("relative overflow-hidden w-full whitespace-nowrap rounded-md border")}>
            <ScrollAreaPrimitive.Viewport ref={viewportRef} className="h-full w-full rounded-[inherit]">
                <div className="flex w-max space-x-4 p-4">
                    {items.map((item, i) => (
                        <HorizontalScrollElement
                            key={item.path}
                            item={item}
                            ownIndex={i}
                            nItems={items.length}
                        />
                    ))}
                </div>
            </ScrollAreaPrimitive.Viewport>
            <ScrollBar orientation="horizontal" />
            <ScrollAreaPrimitive.Corner />
        </ScrollAreaPrimitive.Root>
    )
}

export function HorizontalScrollElement({
    item,
    ownIndex,
    nItems,
}: {
    item: components["schemas"]["FileSearchResult"],
    ownIndex: number,
    nItems: number,
}) {
    const [name, _] = useGalleryName()
    const [qIndex, setIndex] = useGalleryIndex(name)
    const index = (qIndex || 0) % nItems

    const [dbs, __] = useSelectedDBs()
    const setSelected = useItemSelection((state) => state.setItem)
    const thumbnailURL = getThumbnailURL(item.sha256, dbs)
    const onClick = () => {
        setIndex(ownIndex % nItems)
        setSelected(item)
    }
    return (
        <figure
            key={item.path}
            className={cn("w-60 h-80 relative rounded-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none cursor-pointer group",
                ownIndex === index ? "scale-105 ring-2 ring-blue-500" : "scale-100"
            )}>
            <Image
                src={thumbnailURL}
                alt={item.path}
                onClick={() => onClick()}
                className="w-full h-full object-cover object-top rounded-md cursor-pointer"
                fill
                sizes="200px"
            />
            <BookmarkBtn sha256={item.sha256} />
        </figure>
    )
}