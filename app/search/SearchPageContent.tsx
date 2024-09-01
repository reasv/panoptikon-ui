"use client"
import { $api } from "@/lib/api"
import Image from 'next/image'
import { PageSelect } from "@/components/pageselect";
import { BookmarkBtn, FilePathComponent, OpenFile, OpenFolder } from "@/components/imageButtons"
import { useAdvancedOptions, useDatabase, useInstantSearch, useSearchQuery } from "@/lib/state/zust"
import { Toggle } from "@/components/ui/toggle"

import { Settings, RefreshCw, X, ArrowBigLeft, ArrowBigRight, GalleryHorizontal } from "lucide-react"
import { AnimatedNumber } from "@/components/ui/animatedNumber"
import { keepPreviousData } from "@tanstack/react-query"
import { InstantSearchLock } from "@/components/InstantSearchLock"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { SearchBar } from "@/components/searchBar"
import { useCallback, useEffect, useRef } from "react";
import { SearchQueryArgs } from "./page";
import { SearchErrorToast } from "@/components/searchErrorToaster";
import { cn, getFullFileURL, getLocale, getThumbnailURL } from "@/lib/utils";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { components } from "@/lib/panoptikon";
import { useGallery } from "@/lib/state/gallery";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { SideBar } from "@/components/sidebar/SideBar";
import { itemEquals, OpenDetailsButton } from "@/components/OpenFileDetails";
import { SearchResultImage } from "@/components/SearchResultImage";
import { useItemSelection } from "@/lib/state/itemSelection";

export function SearchPageContent({ initialQuery }:
    { initialQuery: SearchQueryArgs }
) {
    const isClient = typeof window !== "undefined"
    const searchQuery = isClient ? useSearchQuery((state) => state.getSearchQuery()) : initialQuery.body
    const dbs = isClient ? useDatabase((state) => state.getDBs()) : initialQuery.params.query
    const setPage = useSearchQuery((state) => state.setPage)
    const page = useSearchQuery((state) => state.order_args.page)
    const pageSize = useSearchQuery((state) => state.order_args.page_size)
    const searchEnabled = useSearchQuery((state) => state.enable_search)
    const instantSearch = useInstantSearch((state) => state.enabled)

    const { data, error, isError, refetch, isFetching } = $api.useQuery(
        "post",
        "/api/search",
        {
            params: {
                query: dbs,
            },
            body: {
                ...searchQuery
            }
        },
        {
            enabled: searchEnabled && instantSearch,
            placeholderData: keepPreviousData
        }
    );

    const nResults = data?.count || 0
    const { toast } = useToast()
    const onRefresh = async () => {
        await refetch()
        toast({
            title: "Refreshed results",
            description: "Results have been updated",
            duration: 2000
        })
    }
    useEffect(() => {
        if (!instantSearch && searchEnabled) {
            // Make pagination work if the user has disabled instant search
            refetch()
        }
    }, [page])

    const toggleOptions = useAdvancedOptions((state) => state.toggle)
    const sidebarOpen = useAdvancedOptions((state) => state.isOpen)
    const galleryOpen = useGallery((state) => state.isGalleryOpen)
    return (
        <div className="flex w-full h-screen">
            <SideBar />
            <div className={cn('p-4 transition-all duration-300 mx-auto',
                sidebarOpen ? 'w-full lg:w-1/2 xl:w-2/3 2xl:w-3/4 4xl:w-[80%] 5xl:w-[82%]' : 'w-full'
            )}>
                <SearchErrorToast isError={isError} error={error} />
                <div className={cn("mb-4 2xl:mx-auto",
                    sidebarOpen ? '2xl:w-2/3' : '2xl:w-1/2'
                )}>
                    <div className="flex gap-2">
                        <Toggle
                            pressed={sidebarOpen}
                            onClick={toggleOptions}
                            title={"Advanced Search Options Are " + (sidebarOpen ? "Open" : "Closed")}
                            aria-label="Toggle Advanced Search Options"
                        >
                            <Settings className="h-4 w-4" />
                        </Toggle>
                        <SearchBar />
                        <InstantSearchLock />
                        <Button title="Refresh search results" onClick={onRefresh} variant="ghost" size="icon">
                            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>
                </div>
                {data && (
                    <ResultsView
                        results={data?.results || []}
                        totalCount={nResults}
                        pageSize={pageSize}
                        currentPage={page}
                        setPage={setPage}
                        galleryOpen={galleryOpen}
                    />)}
            </div>
        </div>
    );
}
export function ResultsView({
    results,
    totalCount,
    pageSize,
    currentPage,
    setPage,
    galleryOpen
}: {
    results: components["schemas"]["FileSearchResult"][]
    totalCount: number
    pageSize: number
    currentPage: number
    setPage: (page: number) => void
    galleryOpen: boolean
}) {
    const totalPages = Math.ceil((totalCount || 1) / (pageSize)) || 1
    return <>
        {
            (galleryOpen && results.length > 0)
                ?
                <ImageGallery items={results} />
                :
                <ResultGrid
                    results={results}
                    totalCount={totalCount}
                />
        }
        {
            totalCount > pageSize && (
                <PageSelect totalPages={totalPages} currentPage={currentPage} setPage={setPage} />
            )
        }
    </>
}

export function ResultGrid({ results, totalCount }: { results: components["schemas"]["FileSearchResult"][], totalCount: number }) {
    const dbs = useDatabase((state) => state.getDBs())
    const sidebarOpen = useAdvancedOptions((state) => state.isOpen)
    return (
        <div className="border rounded p-2">
            <h2 className="text-xl font-bold p-4 flex items-center justify-left">
                <span><AnimatedNumber value={totalCount} /> {totalCount === 1 ? "Result" : "Results"}</span>
            </h2>
            <ScrollArea className="overflow-y-auto">
                <div className={cn('grid gap-4 max-h-[calc(100vh-225px)] grid-cols-1 md:grid-cols-2',
                    sidebarOpen ?
                        ('lg:grid-cols-1 xl:grid-cols-3 2xl:grid-cols-4 4xl:grid-cols-5') :
                        ('lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'))}>
                    {results.map((result, index) => (
                        <SearchResultImage key={result.path} result={result} index={index} dbs={dbs} />
                    ))}
                </div>
            </ScrollArea>
        </div>
    )
}

export function ImageGallery({
    items
}: {
    items: components["schemas"]["FileSearchResult"][]
}) {
    const closeGallery = useGallery((state) => state.closeGallery)
    const nextImage = useGallery((state) => state.nextImage)
    const prevImage = useGallery((state) => state.prevImage)
    const index = useGallery((state) => state.getImageIndex(items.length))
    const setThumbnailsOpen = useGallery((state) => state.setThumbnailsOpen)
    const thumbnailsOpen = useGallery((state) => state.horizontalThumbnails)
    const setSelectedItem = useItemSelection((state) => state.setItem)
    const selectedItem = useItemSelection((state) => state.getSelected())
    useEffect(() => {
        setSelectedItem(items[index])
    }, [index, items])
    // Get the current item, if the selected item is not the same as the current item, set the current item to the selected item
    // selectedItem && !itemEquals(selectedItem, items[index]) ? selectedItem : items[index]
    const currentItem = items[index]

    const dateString = getLocale(new Date(currentItem.last_modified))
    return (
        <div className="flex flex-col border rounded p-2">
            <div className="flex justify-between items-center mb-2">
                <div className="flex items-center">
                    <BookmarkBtn sha256={currentItem.sha256} buttonVariant />
                    <OpenFile sha256={currentItem.sha256} path={currentItem.path} buttonVariant />
                    <OpenFolder sha256={currentItem.sha256} path={currentItem.path} buttonVariant />
                    <Button onClick={() => prevImage(items.length)} variant="ghost" size="icon" title="Previous Image">
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
                    <Button onClick={() => nextImage(items.length)} variant="ghost" size="icon" title="Next Image">
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
            <GalleryImageLarge item={currentItem} galleryLength={items.length} />
            {thumbnailsOpen ? <GalleryHorizontalScroll items={items} /> : null}
        </div>
    );
}

export function GalleryImageLarge(
    { item, galleryLength }: { item: components["schemas"]["FileSearchResult"], galleryLength: number }
) {
    const nextImage = useGallery((state) => state.nextImage)
    const prevImage = useGallery((state) => state.prevImage)
    const dbs = useDatabase((state) => state.getDBs())
    const thumbnailURL = getThumbnailURL(item.sha256, dbs)
    const fileURL = getFullFileURL(item.sha256, dbs)
    const thumbnailsOpen = useGallery((state) => state.horizontalThumbnails)

    const handleImageClick = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
        const { clientX, currentTarget } = e
        e.stopPropagation()
        const { left, right } = currentTarget.getBoundingClientRect()
        const middle = (left + right) / 2
        if (clientX > middle) {
            nextImage(galleryLength)
        } else {
            prevImage(galleryLength)
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
                        <HorizontalScrollElement key={item.path} item={item} ownIndex={i} nItems={items.length} />
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
    nItems: number
}) {
    const setIndex = useGallery((state) => state.setIndex)

    const dbs = useDatabase((state) => state.getDBs())
    const index = useGallery((state) => state.getImageIndex(nItems))
    const selectedItem = useItemSelection((state) => state.getSelected())
    const selected = ownIndex === index // && (!selectedItem || itemEquals(item, selectedItem))
    const setSelected = useItemSelection((state) => state.setItem)
    const thumbnailURL = getThumbnailURL(item.sha256, dbs)
    const onClick = () => {
        setIndex(ownIndex)
        setSelected(item)
    }
    return (
        <figure
            key={item.path}
            className={cn("w-60 h-80 relative rounded-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none cursor-pointer group",
                selected ? "scale-105 ring-2 ring-blue-500" : "scale-100"
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