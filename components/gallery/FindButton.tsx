'use client'

import React from 'react'
import { FolderSearch } from 'lucide-react'
import { useToast } from '../ui/use-toast'
import { useGalleryIndex } from '@/lib/state/gallery'
import { useFileFilters, useOrderArgs, useQueryOptions, useResetSearchQueryState } from '@/lib/state/searchQuery/clientHooks'
import { useSelectedDBs } from '@/lib/state/database'
import { $api } from '@/lib/api'

function getFolderFromPath(fullPath: string): string {
    // Find the last occurrence of a separator, either '/' or '\'
    const lastSeparatorIndex = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'));

    // If no separator was found, return an empty string or decide how to handle it
    if (lastSeparatorIndex === -1) return '';

    // Return the path up to the last separator, maintaining the input's separator format
    return fullPath.substring(0, lastSeparatorIndex);
}
export function FindButton({
    sha256,
    path,
}: {
    sha256: string
    path: string
}) {
    const { toast } = useToast()
    const [index, setIndex] = useGalleryIndex()
    const resetSearch = useResetSearchQueryState()
    const [orderArgs, setOrderArgs] = useOrderArgs()
    const [options, setOptions] = useQueryOptions()
    const [filter, setFilter] = useFileFilters()
    const dbs = useSelectedDBs()[0]
    const handleFindClick = () => {
        const folder = getFolderFromPath(path)
        // Unset all search query parameters
        resetSearch()
        setOrderArgs({
            page: 1,
            page_size: 10,
        }, { history: "push" })
        setFilter({
            paths: [folder],
        }, {
            history: "push",
        })
        setOptions({
            e_path: true,
        }, { history: "push" })
        setIndex(0, { history: "push" })
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