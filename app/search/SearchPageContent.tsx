"use client"
import { $api } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Image from 'next/image'
import { PageSelect } from "@/components/pageselect";
import { BookmarkBtn, FilePathComponent, OpenFile, OpenFolder } from "@/components/imageButtons"
import { useAdvancedOptions, useDatabase, useInstantSearch, useSearchQuery } from "@/lib/zust"
import { Toggle } from "@/components/ui/toggle"

import { Settings, RefreshCw, X, ArrowBigLeft, ArrowBigRight, GalleryHorizontal } from "lucide-react"
import { AnimatedNumber } from "@/components/ui/animatedNumber"
import { keepPreviousData } from "@tanstack/react-query"
import { InstantSearchLock } from "@/components/InstantSearchLock"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { SearchBar } from "@/components/searchBar"
import { useCallback, useEffect, useRef } from "react";
import { AdvancedSearchOptions } from "@/components/advancedSearchOptions";
import { SearchQueryArgs } from "./page";
import { SearchErrorToast } from "@/components/searchErrorToaster";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { components } from "@/lib/panoptikon";
import { useGallery } from "@/lib/gallery";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

export function SearchPageContent({ initialQuery }:
    { initialQuery: SearchQueryArgs }
) {
    const isClient = typeof window !== "undefined"
    const searchQuery = isClient ? useSearchQuery((state) => state.getSearchQuery()) : initialQuery.body
    const dbs = isClient ? useDatabase((state) => state.getDBs()) : initialQuery.params.query
    const setPage = useSearchQuery((state) => state.setPage)
    const page = useSearchQuery((state) => state.order_args.page)
    const page_size = useSearchQuery((state) => state.order_args.page_size)
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
    const total_pages = Math.ceil((data?.count || 1) / (page_size)) || 1
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
    function getFileURL(sha256: string) {
        // Only use the DB values if they are set
        return `${sha256}?index_db=${dbs.index_db || ''}&user_data_db=${dbs.user_data_db || ''}`
    }
    const toggleOptions = useAdvancedOptions((state) => state.toggle)
    const advancedIsOpen = useAdvancedOptions((state) => state.isOpen)
    const isMobile = useMediaQuery("(max-width: 768px)")
    const isTablet = useMediaQuery("(max-width: 1024px)")
    const isSmallDesktop = useMediaQuery("(max-width: 1280px)")
    const isMediumDesktop = useMediaQuery("(max-width: 1536px)")
    const isMediumLargeDesktop = useMediaQuery("(max-width: 1920px)")
    let maxPagesButtons = isMobile ? 5 : isTablet ? 10 : isSmallDesktop ? 15 : isMediumDesktop ? 20 : isMediumLargeDesktop ? 25 : 35
    if (advancedIsOpen) {
        maxPagesButtons = isMobile ? 5 : isTablet ? 5 : isSmallDesktop ? 7 : isMediumDesktop ? 10 : isMediumLargeDesktop ? 20 : 25
    }
    const openGallery = useGallery((state) => state.openGallery)
    const galleryOpen = useGallery((state) => state.isGalleryOpen)
    return (
        <div className="flex w-full h-screen">
            <AdvancedSearchOptions />
            <div className={cn('p-4 transition-all duration-300 mx-auto',
                advancedIsOpen ? 'md:w-1/2 lg:w-1/2 xl:w-2/3 2xl:w-3/4' : 'w-full'
            )}>
                <SearchErrorToast isError={isError} error={error} />
                <div className={cn("mb-4 2xl:mx-auto",
                    advancedIsOpen ? '2xl:w-2/3' : '2xl:w-1/2'
                )}>
                    <div className="flex gap-2">
                        <Toggle
                            pressed={advancedIsOpen}
                            onClick={toggleOptions}
                            title={"Advanced Search Options Are " + (advancedIsOpen ? "Open" : "Closed")}
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
                {galleryOpen && data ? <ImageGallery items={data?.results} /> :
                    <Card>
                        <CardHeader>
                            <CardTitle>
                                <AnimatedNumber value={nResults} /> {nResults === 1 ? "Result" : "Results"}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ScrollArea className="overflow-y-auto" >
                                <div className={cn('grid gap-4 max-h-[calc(100vh-250px)]',
                                    advancedIsOpen ? 'grid-cols-1 sm:grid-cols-1 md:grid-cols-1 lg:grid-cols-1 xl:grid-cols-3 2xl:grid-cols-4' :
                                        'grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5')}>

                                    {data && data.results.map((result, index) => (
                                        <div key={result.path} className="border rounded p-2">
                                            <div className="overflow-hidden relative w-full pb-full mb-2 group">
                                                <a
                                                    href={`/api/items/file/${getFileURL(result.sha256)}`}
                                                    target="_blank"
                                                    onClick={(e) => {
                                                        e.preventDefault()
                                                        openGallery(index)
                                                    }}
                                                    rel="noopener noreferrer"
                                                    className={cn("block relative mb-2 h-80",
                                                        advancedIsOpen ? 'sm:h-96 md:h-80 lg:h-96 xl:h-80 2xl:h-80' : 'sm:h-96 md:h-80 lg:h-96 xl:h-96 2xl:h-96'
                                                    )}
                                                >
                                                    <Image
                                                        src={`/api/items/thumbnail/${getFileURL(result.sha256)}`}
                                                        alt={`Result ${result.path}`}
                                                        fill
                                                        className="group-hover:object-contain object-cover object-top group-hover:object-center"
                                                        unoptimized
                                                    />
                                                </a>
                                                <BookmarkBtn sha256={result.sha256} />
                                                <OpenFile sha256={result.sha256} path={result.path} />
                                                <OpenFolder sha256={result.sha256} path={result.path} />
                                            </div>
                                            <FilePathComponent path={result.path} />
                                            <p className="text-xs text-gray-500">
                                                {new Date(result.last_modified).toLocaleString('en-US')}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </CardContent>
                    </Card>}
                {data && data.count > page_size && (
                    <PageSelect total_pages={total_pages} current_page={page} setPage={setPage} max_pages={maxPagesButtons} />
                )}

            </div>
        </div>
    );
}
function getFileURL(sha256: string, dbs: { index_db: string | null, user_data_db: string | null }) {
    return `${sha256}?index_db=${dbs.index_db || ''}&user_data_db=${dbs.user_data_db || ''}`
}
function getFullFileURL(sha256: string, dbs: { index_db: string | null, user_data_db: string | null }) {
    return `/api/items/file/${getFileURL(sha256, dbs)}`
}
function getThumbnailURL(sha256: string, dbs: { index_db: string | null, user_data_db: string | null }) {
    return `/api/items/thumbnail/${getFileURL(sha256, dbs)}`
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
    const dateString = new Date(items[index].last_modified).toLocaleString('en-US')

    return (
        <div className="flex flex-col border rounded p-2">
            <div className="flex justify-between items-center mb-2">
                <div className="flex items-center">
                    <BookmarkBtn sha256={items[index].sha256} buttonVariant />
                    <OpenFile sha256={items[index].sha256} path={items[index].path} buttonVariant />
                    <OpenFolder sha256={items[index].sha256} path={items[index].path} buttonVariant />
                    <Button onClick={() => prevImage(items.length)} variant="ghost" size="icon" title="Previous Image">
                        <ArrowBigLeft className="h-4 w-4" />
                    </Button>

                </div>
                <div className="max-w-[33%] text-center">
                    <FilePathComponent path={items[index].path} />
                    <p className="text-xs text-gray-500 truncate">
                        {dateString}
                    </p>
                </div>
                <div className="flex items-center">
                    <Button onClick={() => nextImage(items.length)} variant="ghost" size="icon" title="Next Image">
                        <ArrowBigRight className="h-4 w-4" />
                    </Button>
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
            <GalleryImageLarge items={items} />
            {thumbnailsOpen ? <GalleryHorizontalScroll items={items} /> : null}
        </div>
    );
}

export function GalleryImageLarge(
    { items }: { items: components["schemas"]["FileSearchResult"][] }
) {
    const index = useGallery((state) => state.getImageIndex(items.length))
    const nextImage = useGallery((state) => state.nextImage)
    const prevImage = useGallery((state) => state.prevImage)
    const dbs = useDatabase((state) => state.getDBs())
    const thumbnailURL = getThumbnailURL(items[index].sha256, dbs)
    const fileURL = getFullFileURL(items[index].sha256, dbs)
    const thumbnailsOpen = useGallery((state) => state.horizontalThumbnails)

    const handleImageClick = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
        const { clientX, currentTarget } = e
        e.stopPropagation()
        const { left, right } = currentTarget.getBoundingClientRect()
        const middle = (left + right) / 2
        if (clientX > middle) {
            nextImage(items.length)
        } else {
            prevImage(items.length)
        }
    }
    return (
        <div
            className={cn("relative flex-grow flex justify-center items-center overflow-hidden cursor-pointer ",
                thumbnailsOpen ? "h-[calc(100vh-570px)]" : "h-[calc(100vh-220px)]" // Set height based on whether thumbnails
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
                    alt={`${items[index].path}`}
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
    const selected = ownIndex === index
    const thumbnailURL = getThumbnailURL(item.sha256, dbs)
    return (
        <figure
            key={item.path}
            className={cn("w-60 h-80 relative rounded-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none cursor-pointer group",
                selected ? "scale-105 ring-2 ring-blue-500" : "scale-100"
            )}>
            <Image
                src={thumbnailURL}
                alt={item.path}
                onClick={() => setIndex(ownIndex)}
                className="w-full h-full object-cover object-top rounded-md cursor-pointer"
                fill
                sizes="200px"
            />
            <BookmarkBtn sha256={item.sha256} />
        </figure>
    )
}