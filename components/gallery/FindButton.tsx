'use client'

import React from 'react'
import { FolderSearch } from 'lucide-react'
import { useToast } from '../ui/use-toast'
import { useGalleryIndex } from '@/lib/state/gallery'
import { useFileFilters, useOrderArgs, useQueryOptions, useResetSearchQueryState } from '@/lib/state/searchQuery/clientHooks'
import { useSelectedDBs } from '@/lib/state/database'
import { $api, fetchClient } from '@/lib/api'
import { components } from '@/lib/panoptikon'

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
    count: boolean,
): components["schemas"]["PQLQuery"] {
    return {
        page,
        page_size,
        results: !count,
        count,
        check_path: true,
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
    item_id: number,
    dbs: {
        index_db?: string | null
        user_data_db?: string | null
    }) {
    const params = { query: dbs }
    try {
        const countQuery = await fetchClient.POST(
            "/api/search/pql", {
            params,
            body: getQuery(folder, 1, 10, true),
        })
        const folderSize = countQuery.data?.count || 0
        if (folderSize === 0) {
            return 0
        }
        const resultQuery = await fetchClient.POST(
            "/api/search/pql", {
            params,
            body: getQuery(folder, 1, folderSize, false),
        })
        const result = resultQuery.data?.results || []
        const index = result.findIndex((r: { item_id: number }) => r.item_id === item_id)
        console.log("Found index", index)
        if (index !== -1) {
            return index
        }
    } catch (e) {
        console.error(e)
    }
    return 0
}
export function FindButton({
    item_id,
    path,
}: {
    item_id: number,
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
        const folder = getFolderFromPath(path)
        if (!folder) {
            return
        }
        const page_size = orderArgs.page_size || 10
        const indexInFolder = await findFileIndex(folder, item_id, dbs)
        const page = Math.floor(indexInFolder / page_size) + 1
        const index = indexInFolder % page_size
        console.log("Navigating to folder", folder, "page", page, "index", index)
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