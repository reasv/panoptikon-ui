"use client"
import { $api } from "@/lib/api"
import { useDatabase } from "@/lib/zust"

import { FilterContainer } from "../options/FilterContainer";
import { components } from "@/lib/panoptikon";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { FilePathComponent, OpenFile, OpenFolder } from "@/components/imageButtons";
import { getFullFileURL, prettyPrintBytes } from "@/lib/utils";

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
    const sizeString = data ? prettyPrintBytes(data.item.size || 0) : 0
    const resolutionString = data ? `${data.item.width}x${data.item.height}` : null
    return (
        <FilterContainer
            label={<span>File and Item Metadata</span>}
            description={<span>Metadata for the selected file</span>}
            storageKey="file-item-details-open"
        >
            <div className="space-x-2 mt-4">
                <div className="w-full max-w-[270px] 2xl:max-w-xs overflow-hidden">
                    <FilePathComponent path={item.path} />
                </div>
                <p className="text-xs text-gray-500 mt-2">
                    <a href={getFullFileURL(item.sha256, dbs)} target="_blank">Download Original File ({sizeString})</a>
                </p>
                <p className="text-xs text-gray-500 mt-2">
                    Last Modified: {dateString}
                </p>
                <p className="text-xs text-gray-500 mt-2">
                    Type: {item.type}
                </p>
                {resolutionString && (
                    <p className="text-xs text-gray-500 mt-2">
                        Resolution: {resolutionString}
                    </p>
                )}
            </div>
            <div className="space-x-2 mt-4">
                <FilterContainer
                    label={<span>Files</span>}
                    description={<span>All files associated with this item</span>}
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
            <div className="flex flex-col space-y-2">
                <div className="w-full max-w-[250px]  overflow-hidden">
                    <FilePathComponent path={path} />
                </div>
                <div className="flex flex-row space-x-2">
                    <OpenFile sha256={item.sha256} path={path} buttonVariant />
                    <OpenFolder sha256={item.sha256} path={path} buttonVariant />
                </div>
            </div>
        </div>
    )
}