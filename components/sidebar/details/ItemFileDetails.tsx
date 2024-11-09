import { $api } from "@/lib/api"
import { FilterContainer } from "../base/FilterContainer";
import { components } from "@/lib/panoptikon";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { FilePathComponent, OpenFile, OpenFolder } from "@/components/imageButtons";
import { getFileURL, getLocale, prettyPrintBytes, prettyPrintVideoDuration } from "@/lib/utils";
import { useSelectedDBs } from "@/lib/state/database";
import { FindButton } from "@/components/gallery/FindButton";
import { useClientConfig } from "@/lib/useClientConfig";

export function ItemFileDetails({
    item,
}: {
    item: SearchResult
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
    item: SearchResult
}) {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/items/item", {
        params: {
            query: {
                ...dbs,
                id: item.sha256,
                id_type: "sha256",
            }
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
                <a href={getFileURL(dbs, "file", "sha256", item.sha256)} target="_blank">Download Original File ({sizeString})</a>
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
                        file_id={file.id}
                        path={file.path}
                    />
                ))}
            </FilterContainer>
        </div>
    </>)
}

function SingleFileItem({
    item,
    file_id,
    path,
}: {
    item: SearchResult,
    file_id: number,
    path: string
}) {
    const clientConfig = useClientConfig()
    const disableOpenFileButton = clientConfig?.data?.disableBackendOpen || false
    return (
        <div className="border rounded-lg p-4 mt-4">
            <div className="flex flex-col space-y-2">
                <div className="w-full max-w-[310px] sm:max-w-[505px] md:max-w-[620px] lg:max-w-[350px] xl:max-w-[270px] 3xl:max-w-[300px] 4xl:max-w-[292px] 5xl:max-w-[370px]  overflow-hidden">
                    <FilePathComponent path={path} />
                </div>
                <div className="flex flex-row space-x-2">
                    <OpenFile sha256={item.sha256} path={path} buttonVariant />
                    {!disableOpenFileButton && <OpenFolder sha256={item.sha256} path={path} buttonVariant />}
                    <FindButton
                        id={file_id}
                        id_type="file_id"
                        path={path}
                        buttonVariant
                    />
                </div>
            </div>
        </div>
    )
}