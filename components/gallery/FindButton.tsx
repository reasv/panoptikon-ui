'use client'

import React, { useEffect, useRef } from 'react'
import { FolderSearch } from 'lucide-react'
import { toast } from '../ui/use-toast'
import { getGalleryOptionsSerializer, useGalleryNavigate, usePinboardMaximized, useViewMode } from '@/lib/state/gallery'
import { gridScrollAnchorSerializer } from '@/lib/state/gridScroll'
import { useSearchOverlayReveal } from '@/lib/state/searchOverlayReveal'
import { useFileFilters, useOrderArgs, useQueryOptions, useResetSearchQueryState } from '@/lib/state/searchQuery/clientHooks'
import { selectedDBsSerializer, useSelectedDBs } from '@/lib/state/database'
import { fetchClient } from '@/lib/api'
import { components } from '@/lib/panoptikon'
import { OrderArgsType, orderByType } from '@/lib/state/searchQuery/searchQueryKeyMaps'
import { Button } from '../ui/button'
import { partitionBySerializer, usePartitionBy } from '@/lib/state/partitionBy'
import { useInstantSearch } from '@/lib/state/zust'
import { serializers } from '@/lib/state/searchQuery/serializers'
import { cn } from '@/lib/utils'
import {
    FindNavigationData,
    FindNavigatorApi,
    useFindNavigatorApi,
} from '@/lib/state/findNavigatorApi'

function getFolderFromPath(fullPath: string): string {
    // Find the last occurrence of a separator, either '/' or '\'
    const lastSeparatorIndex = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'));

    // If no separator was found, return an empty string or decide how to handle it
    if (lastSeparatorIndex === -1) return '';

    // Return the path up to the last separator, maintaining the input's separator format
    return fullPath.substring(0, lastSeparatorIndex);
}
function getQuery(
    folder: string,
    page: number,
    page_size: number,
    order_by: orderByType,
    order: OrderArgsType["order"],
    count: boolean,
    check_path: boolean
): components["schemas"]["PqlQuery"] {
    return {
        page,
        page_size,
        results: !count,
        count,
        check_path,
        order_by: [
            {
                order_by,
                order,
                priority: 0,
            },
        ],
        select: ["item_id"],
        entity: "file",
        query: {
            "and_": [
                {
                    "match": {
                        "startswith": {
                            "path": [
                                folder
                            ]
                        }
                    }
                }
            ]
        },
    }
}

async function findFileIndex(
    folder: string,
    file_id: number,
    page_size: number,
    order_by: orderByType,
    order: OrderArgsType["order"],
    dbs: {
        index_db?: string | null
        user_data_db?: string | null
    }) {
    const params = { query: dbs }
    try {
        const resultQuery = await fetchClient.POST(
            "/api/search/pql", {
            params,
            body: getQuery(
                folder,
                1,
                -1,
                order_by,
                order,
                false,
                false,
            ),
        })
        const result = resultQuery.data?.results || []
        const indexInFolder = result.findIndex((r: { file_id: number }) => r.file_id === file_id)
        if (indexInFolder === -1) {
            return [0, 0, 0]
        }
        const page = Math.floor(indexInFolder / page_size) + 1
        const index = indexInFolder % page_size
        // Three numbers, because the two view modes want different ones:
        // pages mode lands with (page, index-within-page), scroll mode with
        // the absolute index (see FindNavigationData).
        return [page, index, indexInFolder]
    } catch (e) {
        console.error(e)
    }
    return [0, 0, 0]
}

/**
 * The one owner of find-in-folder's URL state, mounted once by the search
 * page and published through useFindNavigatorApi. Every FindButton used to
 * own these hooks itself; with one button per grid cell, per pin and per
 * strip item, that put ~27 nuqs hook families in every cell, and any URL
 * write re-rendered them all (see lib/state/findNavigatorApi.ts).
 */
export function FindNavigator() {
    // THE POSITION WRITE IS MODE-DEPENDENT, and getting that wrong is what
    // made find-in-folder miss. `gi` means different things in the two view
    // modes: in PAGES mode it is an index WITHIN the page `page` selects, in
    // SCROLL mode it is an absolute index over the whole result set, with
    // `top` as the grid's anchor onto it and no page at all
    // (lib/state/gallery.ts useGalleryNavigate,
    // docs/search-scroll-mode-design.md §8).
    //
    // This wrote the paged pair unconditionally, so in scroll mode the
    // landing was absolute item `indexInFolder % page_size` — the right item
    // only while the file sat in its folder's first page, which is exactly
    // the case where it was already on screen. Every real navigation (item
    // 137 of a folder, page_size 10) landed on item 7.
    //
    // useGalleryNavigate is the shared write every by-item position gesture
    // already goes through, and it is used here for the same stated reason
    // it exists: one write, so the surfaces cannot drift on which number
    // `gi` holds or on whether the anchor follows it.
    const [viewMode] = useViewMode()
    const scrollMode = viewMode === "scroll"
    const navigateGallery = useGalleryNavigate(scrollMode)
    const resetSearch = useResetSearchQueryState()
    const [orderArgs, setOrderArgs] = useOrderArgs()
    const setOptions = useQueryOptions()[1]
    const setFilter = useFileFilters()[1]
    const commit = useInstantSearch((state) => state.commit)
    const dbs = useSelectedDBs()[0]
    const [partitionBy] = usePartitionBy()
    // Find-in-folder has to SHOW the folder it navigated to, and on a
    // maximized board the only results surface is the bottom search dock
    // (docs/maximized-pinboard-search-overlay-design.md §5.1). Two separate
    // reasons this must open it, and either alone is enough:
    //
    //   - the query would not even RUN. useSearchSuppressed is
    //     `maximized && !gso && !revealed`, so with the dock closed the
    //     navigate rewrote every search param and then executed nothing;
    //     the user got the "Navigating to folder…" toast and no other
    //     evidence anything had happened.
    //   - the button lives on a PIN, i.e. on the board, so its press is an
    //     outside click for the dock's dismissal (dockChrome.tsx). Clicking
    //     it with the dock already open therefore CLOSED the dock and
    //     re-suppressed the search. Opening here also undoes that, and the
    //     ordering is safe: dismissal runs synchronously on the click, this
    //     runs after `navigate`'s awaited URL writes.
    //
    // Deliberately the EPHEMERAL open flag, not the `gso` pin: navigating to
    // a folder is one look, and the dock should dismiss on the next Esc or
    // click outside like any other opened dock rather than stranding a URL
    // flag. Mounted once, so these two extra subscriptions are not on any
    // per-row path.
    const maximized = usePinboardMaximized()
    const setOverlayOpen = useSearchOverlayReveal((s) => s.setRevealed)

    const getNavigationData = async (
        id: number | string,
        id_type: "file_id" | "sha256",
        path: string,
    ) => {
        let file_path = path
        let file_id: number = 0
        if (id_type === "sha256" || file_path === "") {
            const itemData = await fetchClient.GET("/api/items/item", {
                params: {
                    query: {
                        ...dbs,
                        id_type,
                        // The spec types id as string; numeric IDs serialize
                        // identically in the query string.
                        id: String(id),
                    }
                }
            })
            if (!itemData.data || itemData.data!.files.length === 0) {
                return
            }
            if (file_path === "") {
                file_path = itemData.data!.files[0].path
                file_id = itemData.data!.files[0].id
            } else {
                const file = itemData.data!.files.find((f) => f.path === file_path)
                if (!file) {
                    return
                }
                file_id = file.id
            }
        } else {
            file_id = id as number
        }
        const folder = getFolderFromPath(file_path)
        if (!folder) {
            return
        }
        const page_size = orderArgs.page_size || 10
        const order_by = [
            "path",
            "last_modified",
            "size",
            "type",
            "duration",
        ].includes(orderArgs.order_by) ? orderArgs.order_by : "last_modified"
        const order = orderArgs.order

        const [page, index, absoluteIndex] = await findFileIndex(
            folder,
            file_id,
            page_size,
            order_by as orderByType,
            order,
            dbs
        )
        return {
            folder, page, index, absoluteIndex, order_by, order, page_size,
        } as FindNavigationData
    }

    const buildLink = ({
        folder,
        page,
        index,
        absoluteIndex,
        order_by,
        order,
        page_size,
    }: FindNavigationData) => {
        let fullURL = selectedDBsSerializer({
            index_db: dbs.index_db,
            user_data_db: dbs.user_data_db,
        })
        fullURL = partitionBySerializer(fullURL, {
            partition_by: partitionBy.partition_by
        })
        // The prefetched href has to land where the in-place navigate below
        // does, so it takes the same fork: no `page` in scroll mode (the URL
        // normalization strips it there anyway), and `gi` carries whichever
        // number that mode's position params mean.
        fullURL = serializers.orderArgs(fullURL, scrollMode ? {
            order,
            order_by,
            page_size,
        } : {
            order,
            order_by,
            page,
            page_size,
        })
        fullURL = serializers.queryOptions(fullURL, { e_path: true })
        fullURL = serializers.fileFilters(fullURL, {
            paths: [folder],
        })
        fullURL = getGalleryOptionsSerializer()(fullURL, {
            gi: scrollMode ? absoluteIndex : index,
        })
        if (scrollMode) {
            // The grid's anchor, the scroll-mode half of the landing: `gi`
            // alone selects the item but leaves the grid wherever it was, so
            // a link that omits this opens the folder scrolled to the top
            // with the target outside the ensure-visible scan window. Null
            // at 0 mirrors useGalleryNavigate's own rule — the top of the
            // set needs no anchor and a clean URL is worth keeping.
            fullURL = gridScrollAnchorSerializer(fullURL, {
                top: absoluteIndex > 0 ? absoluteIndex : null,
            })
        }
        return fullURL
    }

    const navigate = async ({
        folder,
        page,
        index,
        absoluteIndex,
        order_by,
        order,
        page_size,
    }: FindNavigationData
    ) => {
        // Awaited as a batch so the URL holds this query before `commit()`
        // declares it one to run: navigating to a folder is a committed
        // query, not a query being edited, so the update lock must not
        // swallow it.
        await Promise.all([
            // Unset all search query parameters
            resetSearch(),
            setFilter({
                paths: [folder],
            }, {
                history: "push",
            }),
            setOptions({
                e_path: true,
            }, { history: "push" }),
            // `page` is a PAGES-MODE landing and only that: scroll mode
            // reads rows from a sparse window over the whole set and has
            // useScrollURLNormalization strip the param, so writing it there
            // is at best a transient the normalizer undoes.
            setOrderArgs(scrollMode ? {
                order_by,
                order,
                page_size,
            } : {
                order_by,
                order,
                page,
                page_size,
            }, { history: "push" }),
            // One write for both modes, and it also sets the grid's anchor
            // in scroll mode (see the hook at the top of this component).
            // Returns void rather than a promise, so it adds nothing to the
            // batch's settling — it does not need to: its setters fire in
            // this same synchronous tick, so they join the same nuqs update
            // the awaited ones do, and `gi` is a position rather than part
            // of the query key `commit()` is about.
            navigateGallery(
                scrollMode ? absoluteIndex : index,
                { history: "push" },
            ),
        ])
        // After the writes, before the commit: the dock must be open for
        // `commit()` to declare a query that anything will actually run
        // (see the flag's declaration above), and opening it BEFORE the
        // batch would have un-suppressed the search over the half-reset
        // params the batch passes through.
        if (maximized) setOverlayOpen(true)
        commit()
    }

    // One stable object, mutated every render so callers always see current
    // values without the store notifying anyone; registered while mounted
    // (the usePinboardBoardApi idiom).
    const apiRef = useRef<FindNavigatorApi>({} as FindNavigatorApi)
    useEffect(() => {
        Object.assign(apiRef.current, {
            getNavigationData,
            buildLink,
            navigate,
        } satisfies FindNavigatorApi)
    })
    useEffect(() => {
        const api = apiRef.current
        useFindNavigatorApi.getState().register(api)
        return () => useFindNavigatorApi.getState().unregister(api)
    }, [])
    // Prefetched hrefs bake in the ordering and DB selection; buttons drop
    // theirs when either changes (their old link-reset effect's deps).
    const bumpLinkEpoch = useFindNavigatorApi((state) => state.bumpLinkEpoch)
    useEffect(() => {
        bumpLinkEpoch()
    }, [
        bumpLinkEpoch,
        orderArgs.page_size,
        orderArgs.order_by,
        orderArgs.order,
        dbs.index_db,
        dbs.user_data_db,
        // A prefetched href now bakes in the VIEW MODE as well (buildLink
        // forks on it for both the position number and whether `page` is
        // written at all), so a mode switch has to drop stale hrefs the same
        // way an ordering or DB change does.
        viewMode,
    ])
    return null
}

export function FindButton({
    id,
    id_type,
    path,
    buttonVariant,
    buttonClassName,
}: {
    id: number | string,
    id_type: "file_id" | "sha256",
    path: string,
    buttonVariant?: boolean
    buttonClassName?: string
}) {
    // Deliberately NO URL-state hooks here — this component is mounted once
    // per cell/pin/strip item and must stay out of the URL-write blast
    // radius. Everything stateful comes from the navigator's handle at
    // interaction time. Same reason for the STANDALONE `toast()`: the hook
    // form registers a listener on the shared toast store per mount, and
    // re-registers it on every toast.
    const navigatorMissing = () => {
        toast({
            title: "Error",
            description: "Could not navigate to this file's folder",
            variant: "destructive",
        })
    }
    const handleFindClick = async () => {
        const api = useFindNavigatorApi.getState().api
        if (!api) {
            navigatorMissing()
            return
        }
        const data = await api.getNavigationData(id, id_type, path)
        if (!data) {
            toast({
                title: "Error",
                description: "Could not navigate to this file's folder",
                variant: "destructive",
            })
            return
        }
        await api.navigate(data)
        toast({
            title: "Navigating to folder...",
            description: `${data.folder}`,
        })
    }
    const [link, setLink] = React.useState<string | null>(null)
    // Reset the link when the id or path changes — or when the ordering/DB
    // state it was serialized from does (linkEpoch, bumped by the navigator)
    const linkEpoch = useFindNavigatorApi((state) => state.linkEpoch)
    useEffect(() => {
        setLink(null)
    }, [id, id_type, path, linkEpoch])

    const handleHover = async () => {
        const api = useFindNavigatorApi.getState().api
        if (!api) {
            navigatorMissing()
            return
        }
        const data = await api.getNavigationData(id, id_type, path)
        if (!data) {
            toast({
                title: "Error",
                description: "Could not navigate to this file's folder",
                variant: "destructive",
            })
            return
        }
        const link = api.buildLink(data)
        setLink(link)
    }
    return (
        link ? <a
            href={link}
            target="_blank"
            onClick={(e) => {
                e.preventDefault()
                handleFindClick()
            }} >
            <ButtonElement
                buttonVariant={buttonVariant}
                buttonClassName={buttonClassName}
                handleClick={() => { }}
                handleHover={() => { }}
            />
        </a> :
            <ButtonElement
                buttonVariant={buttonVariant}
                buttonClassName={buttonClassName}
                handleClick={handleFindClick}
                handleHover={handleHover}
            />
    )
}

function ButtonElement({
    buttonVariant,
    handleClick,
    handleHover,
    buttonClassName,
}: {
    buttonVariant?: boolean,
    buttonClassName?: string,
    handleClick: () => void,
    handleHover: () => void
}) {
    return buttonVariant ?
        <Button
            title="Navigate to this image's folder in Panoptikon"
            onClick={handleClick}
            onMouseEnter={handleHover}
            variant="ghost"
            size="icon"
            className={buttonClassName}
        >
            <FolderSearch
                className="w-4 h-4"
            />
        </Button>
        : <button
            title={"Navigate to this image's folder in Panoptikon"}
            className={cn("cell-chrome-pill absolute bottom-(--cell-chrome-inset) left-(--cell-chrome-inset) opacity-0 group-hover:opacity-100 transition-opacity duration-300", buttonClassName)}
            onClick={handleClick}
            onMouseEnter={handleHover}
        >
            <FolderSearch className="w-(--cell-chrome-glyph) h-(--cell-chrome-glyph) text-gray-800" />
        </button>
}
