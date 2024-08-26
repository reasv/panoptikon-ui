"use client"
import { $api } from "@/lib/api"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBookmarkNs, useSearchQuery } from "@/lib/zust"
import { Label } from "./ui/label"
import { Switch } from "./ui/switch";

export function BookmarksFilter() {
    const { data } = $api.useQuery("get", "/api/bookmarks/ns")

    const setBookmarksFilterEnabled = useSearchQuery((state) => state.setBookmarkFilterEnabled)
    const bookmarksFilterEnabled = useSearchQuery((state) => state.bookmarks.restrict_to_bookmarks)
    const bookmarksFilterNs = useSearchQuery((state) => state.bookmarks.namespaces!)
    const setBookmarksFilterNs = useSearchQuery((state) => state.setBookmarkFilterNs)
    return (
        <div className="flex flex-row items-center justify-between rounded-lg border p-4 mt-4">
            <div className="space-y-0.5">
                <Label className="text-base">
                    Search in bookmarks
                </Label>
                <div className="text-gray-400">
                    Only show items that are in your bookmarks
                </div>
            </div>
            <Switch checked={bookmarksFilterEnabled} onCheckedChange={(value) => setBookmarksFilterEnabled(value)} />

            {/* <div id="indexSelect" className="flex items-center space-x-2 mt-3 mb-4">
                <Select>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="(Include all groups)" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            <SelectLabel>Bookmark Groups</SelectLabel>
                            {
                                data?.namespaces.map((ns) => (
                                    <SelectItem key={ns} value={ns}>{ns}</SelectItem>
                                ))
                            }
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </div> */}
        </div>
    )
}