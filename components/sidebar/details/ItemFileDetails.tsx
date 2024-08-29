"use client"
import { $api } from "@/lib/api"
import { useBookmarkCustomNs, useBookmarkNs, useDatabase } from "@/lib/zust"
import { Input } from "../../ui/input";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../../ui/button";
import { MultiBoxResponsive } from "../../multiCombobox";
import { FilterContainer } from "../options/FilterContainer";
import { components } from "@/lib/panoptikon";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/use-toast";
import { FilePathComponent, OpenFile, OpenFolder } from "@/components/imageButtons";

export function ItemFileDetails({
    item,
}: {
    item: components["schemas"]["FileSearchResult"]
}) {
    const dbs = useDatabase((state) => state.getDBs())
    const { data } = $api.useQuery("get", "/api/items/item/{sha256}", {
        params: {
            path: {
                sha256: item.sha256
            },
            query: dbs
        }
    },
        {
            placeholderData: keepPreviousData
        })
    const dateString = new Date(item.last_modified).toLocaleString('en-US')
    return (
        <FilterContainer
            label={<span>File and Item Metadata</span>}
            description={<span>Metadata for the selected file</span>}
            storageKey="file-item-details-open"
        >
            <div className="space-x-2 mt-4">
                <FilePathComponent path={item.path} />
                <p className="text-xs text-gray-500 mt-2">
                    Last Modified: {dateString}
                </p>
            </div>
            <div className="space-x-2 mt-4">
                <FilterContainer
                    label={<span>Files</span>}
                    description={<span>All duplicate files associated with this unique item</span>}
                    storageKey="file-list-open"
                    defaultIsCollapsed={true}
                >
                    {data?.files.map((file, idx) => (
                        <SingleFileItem
                            key={file.path}
                            item={item}
                            path={file.path}
                        />
                    ))}
                </FilterContainer>
            </div>
        </FilterContainer>
    )
}

function SingleFileItem({
    item,
    path,

}: {
    item: components["schemas"]["FileSearchResult"],
    path: string
}) {
    return (
        <div className="border rounded-lg p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <FilePathComponent path={path} />
                    <div className="mt-4" />
                    <OpenFile sha256={item.sha256} path={path} buttonVariant />
                    <OpenFolder sha256={item.sha256} path={path} buttonVariant />
                </div>
            </div>
        </div>
    )
}