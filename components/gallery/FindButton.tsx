'use client'

import React from 'react'
import { FolderSearch } from 'lucide-react'
import { useToast } from '../ui/use-toast'
import { useGalleryIndex } from '@/lib/state/gallery'
import { useFileFilters, useOrderArgs, useQueryOptions, useResetSearchQueryState } from '@/lib/state/searchQuery/clientHooks'
import { useSelectedDBs } from '@/lib/state/database'
import { $api, fetchClient } from '@/lib/api'
import { components } from '@/lib/panoptikon'
import { OrderArgsType, orderByType } from '@/lib/state/searchQuery/searchQueryKeyMaps'

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
): components["schemas"]["PQLQuery"] {
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
        console.log("Found index", indexInFolder)
        if (indexInFolder === -1) {
            return [0, 0]
        }
        const page = Math.floor(indexInFolder / page_size) + 1
        const index = indexInFolder % page_size
        return [page, index]
    } catch (e) {
        console.error(e)
    }
    return [0, 0]
}
export function FindButton({
    id,
    id_type,
    path,
}: {
    id: number | string,
    id_type: "file_id" | "sha256",
    path: string
}) {
    const { toast } = useToast()
    const setIndex = useGalleryIndex()[1]
    const resetSearch = useResetSearchQueryState()
    const [orderArgs, setOrderArgs] = useOrderArgs()
    const [options, setOptions] = useQueryOptions()
    const [filter, setFilter] = useFileFilters()
    const dbs = useSelectedDBs()[0]
    const handleFindClick = async () => {
        let file_path = path
        let file_id: number = 0
        if (id_type === "sha256" || file_path === "") {
            const itemData = await fetchClient.GET("/api/items/item", {
                params: {
                    query: {
                        ...dbs,
                        id_type,
                        id,
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

        const [page, index] = await findFileIndex(
            folder,
            file_id,
            page_size,
            order_by as orderByType,
            order,
            dbs
        )
        console.log(`Navigating to folder ${folder}, page ${page}, index ${index}`)
        // Unset all search query parameters
        resetSearch()
        setFilter({
            paths: [folder],
        }, {
            history: "push",
        })
        setOptions({
            e_path: true,
        }, { history: "push" })
        setOrderArgs({
            order_by,
            order,
            page,
            page_size,
        }, { history: "push" })
        setIndex(index, { history: "push" })
        toast({
            title: "Navigating to folder...",
            description: `${folder}`,
        })
    }
    return <button
        title={"Navigate to this image's folder in Panoptikon"}
        className={"hover:scale-105 absolute bottom-2 left-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"}
        onClick={handleFindClick}
    >
        <FolderSearch className="w-6 h-6 text-gray-800" />
    </button>
}