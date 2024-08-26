"use client"
import { $api } from "@/lib/api"
import { useSearchQuery } from "@/lib/zust"
import { Label } from "./ui/label"
import { Switch } from "./ui/switch";
import { ComboBoxResponsive } from "./combobox";

export function BookmarksFilter() {
    const { data } = $api.useQuery("get", "/api/bookmarks/ns")

    const setBookmarksFilterEnabled = useSearchQuery((state) => state.setBookmarkFilterEnabled)
    const bookmarksFilterEnabled = useSearchQuery((state) => state.bookmarks.restrict_to_bookmarks)
    const bookmarksFilterNs = useSearchQuery((state) => state.bookmarks.namespaces!)
    const setBookmarksFilterNs = useSearchQuery((state) => state.setBookmarkFilterNs)
    const bookmarksNsChange = (ns: string) => {
        if (ns === "*") {
            setBookmarksFilterNs([])
        } else {
            setBookmarksFilterNs([ns])
        }
    }
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
                <ComboBoxResponsive
                    options={namespacesWithAll.map((ns) => ({ value: ns, label: (ns === "*" ? "All Groups" : ns) }))}
                    currentOption={{ value: bookmarksFilterNs.length > 0 ? bookmarksFilterNs[0] : "*", label: bookmarksFilterNs.length > 0 ? bookmarksFilterNs[0] : "All Groups" }}
                    onSelectOption={(option) => bookmarksNsChange(option?.value || "")}
                    placeholder="Groups..."
                />
            </div>
        </div>
    )
}