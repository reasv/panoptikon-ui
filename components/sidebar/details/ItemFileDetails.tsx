import { $api } from "@/lib/api"
import { } from "@/lib/state/zust"

import { FilterContainer } from "../options/FilterContainer";
import { components } from "@/lib/panoptikon";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { FilePathComponent, OpenFile, OpenFolder } from "@/components/imageButtons";
import { getFullFileURL, getLocale, prettyPrintBytes, prettyPrintVideoDuration } from "@/lib/utils";
import { useSelectedDBs } from "@/lib/state/database";

export function ItemFileDetails({
    item,
}: {
    item: components["schemas"]["FileSearchResult"]
}) {

    return (
        <FilterContainer
            label={<span>File and Item Metadata</span>}
            description={<span>Metadata for the selected file</span>}
            storageKey="file-item-details-open"
            unMountOnCollapse
        >
            <ItemFileDetailsInternal item={item} />
        </FilterContainer>
    )
}

function ItemFileDetailsInternal({
    item,
}: {
    item: components["schemas"]["FileSearchResult"]
}) {
    const [dbs, ___] = useSelectedDBs()
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
    const dateString = getLocale(new Date(item.last_modified))
    const sizeString = data ? prettyPrintBytes(data.item.size || 0) : 0
    const resolutionString = data && data.item.width && data.item.height ? `${data.item.width}x${data.item.height}` : null
    const timeAddedString = data ? getLocale(new Date(data.item.time_added)) : null
    const durationString = data && data.item.duration ? prettyPrintVideoDuration(data.item.duration) : null
    return (<>
        <div className="space-x-2 mt-4">
            <div className="w-full max-w-[350px] sm:max-w-[550px] md:max-w-[670px] lg:max-w-[410px] xl:max-w-[310px] 3xl:max-w-[370px] 4xl:max-w-[340px] 5xl:max-w-[440px] overflow-hidden">
                <FilePathComponent path={item.path} />
            </div>
            <p className="text-xs text-gray-500 mt-2">
                <a href={getFullFileURL(item.sha256, dbs)} target="_blank">Download Original File ({sizeString})</a>
            </p>
            <p className="text-xs text-gray-500 mt-2">
                Type: {item.type} {resolutionString && `(${resolutionString})`} {durationString && `(${durationString})`}
            </p>
            <p className="text-xs text-gray-500 mt-2">
                Modified: {dateString}
            </p>
            {timeAddedString && <p className="text-xs text-gray-500 mt-2">
                Added: {timeAddedString}
            </p>}
        </div>
        <div className="space-x-2 mt-4">
            <FilterContainer
                label={<span>Files</span>}
                description={<span>All files associated with this item</span>}
                storageKey="file-list-open"
            // defaultIsCollapsed={true}
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
    </>)
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
                <div className="w-full max-w-[310px] sm:max-w-[505px] md:max-w-[620px] lg:max-w-[350px] xl:max-w-[270px] 3xl:max-w-[300px] 4xl:max-w-[292px] 5xl:max-w-[370px]  overflow-hidden">
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