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
    const bookmarksNsChange = (ns: string) => {
        if (ns === "*") {
            setBookmarksFilterNs([])
        } else {
            setBookmarksFilterNs([ns])
        }
    }
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
            <div className="flex items-center space-x-2 ">
                <Select value={bookmarksFilterNs.length > 0 ? bookmarksFilterNs[0] : ""} onValueChange={(value) => bookmarksNsChange(value)}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="All Groups" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            <SelectLabel>Bookmark Groups</SelectLabel>
                            <SelectItem key={"*"} value={"*"}>All Groups</SelectItem>
                            {
                                data?.namespaces.map((ns) => (
                                    <SelectItem key={ns} value={ns}>{ns}</SelectItem>
                                ))
                            }
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </div>
        </div>
    )
}