"use client"
import { $api } from "@/lib/api"
import { useDatabase, useSearchQuery } from "@/lib/state/zust"
import { Label } from "../../ui/label"
import { Switch } from "../../ui/switch";
import { MultiBoxResponsive } from "../../multiCombobox";

export function BookmarksFilter() {
    const dbs = useDatabase((state) => state.getDBs())
    const { data } = $api.useQuery("get", "/api/bookmarks/ns", {
        params: {
            query: dbs
        }
    })

    const setBookmarksFilterEnabled = useSearchQuery((state) => state.setBookmarkFilterEnabled)
    const bookmarksFilterEnabled = useSearchQuery((state) => state.bookmarks.restrict_to_bookmarks)
    const bookmarksFilterNs = useSearchQuery((state) => state.bookmarks.namespaces!)
    const setBookmarksFilterNs = useSearchQuery((state) => state.setBookmarkFilterNs)

    const namespacesWithAll = ["*", ...(data?.namespaces || [])]
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Search in bookmarks
                    </Label>
                    <div className="text-gray-400">
                        Only show items that are in your bookmarks
                    </div>
                </div>
                <Switch checked={bookmarksFilterEnabled} onCheckedChange={(value) => setBookmarksFilterEnabled(value)} />
            </div>
            <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-left">
                <MultiBoxResponsive
                    options={namespacesWithAll.map((ns) => ({ value: ns, label: ns === "*" ? "All Groups" : ns }))}
                    currentValues={bookmarksFilterNs}
                    onSelectionChange={setBookmarksFilterNs}
                    placeholder="Select groups"
                    resetValue="*"
                    maxDisplayed={10}
                    buttonClassName="max-w-[310px] sm:max-w-[505px] md:max-w-[620px] lg:max-w-[350px] xl:max-w-[270px] 3xl:max-w-[300px] 4xl:max-w-[292px] 5xl:max-w-[370px]"
                />
            </div>
        </div>
    )
}