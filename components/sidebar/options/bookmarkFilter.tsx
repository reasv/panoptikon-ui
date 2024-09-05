import { $api } from "@/lib/api"
import { Label } from "../../ui/label"
import { Switch } from "../../ui/switch";
import { MultiBoxResponsive } from "../../multiCombobox";
import { useSelectedDBs } from "@/lib/state/database";
import { useBookmarksFilter } from "@/lib/state/searchQuery/clientHooks";

export function BookmarksFilter() {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/bookmarks/ns", {
        params: {
            query: dbs
        }
    })

    const [bookmarksFilter, setBookmarksFilter] = useBookmarksFilter()
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
                <Switch checked={bookmarksFilter.restrict_to_bookmarks} onCheckedChange={(value) => setBookmarksFilter({
                    restrict_to_bookmarks: value
                })} />
            </div>
            <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-left">
                <MultiBoxResponsive
                    options={namespacesWithAll.map((ns) => ({ value: ns, label: ns === "*" ? "All Groups" : ns }))}
                    currentValues={bookmarksFilter.namespaces}
                    onSelectionChange={(values) => setBookmarksFilter({
                        namespaces: values
                    })}
                    placeholder="Select groups"
                    resetValue="*"
                    maxDisplayed={10}
                    buttonClassName="max-w-[310px] sm:max-w-[505px] md:max-w-[620px] lg:max-w-[350px] xl:max-w-[270px] 3xl:max-w-[300px] 4xl:max-w-[292px] 5xl:max-w-[370px]"
                />
            </div>
        </div>
    )
}