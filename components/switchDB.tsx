"use client"
import { $api } from "@/lib/api"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDatabase } from "@/lib/zust"
import { Label } from "./ui/label"

export function SwitchDB() {
    const { data } = $api.useQuery("get", "/api/db")
    const { index_db } = useDatabase((state) => state.getDBs())
    const setIndexDB = useDatabase((state) => state.setIndexDB)
    return (
        <>
            <div className="flex flex-row items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Index Database
                    </Label>
                    <div className="text-gray-400">
                        Choose the database you're searching in
                    </div>
                </div>
                <div>
                    <Select value={index_db || data?.index.current} onValueChange={(value) => setIndexDB(value)}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Search in..." />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectLabel>Index DBs</SelectLabel>
                                {
                                    data?.index.all.map((db) => (
                                        <SelectItem key={db} value={db}>{db}</SelectItem>
                                    ))
                                }
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </div>
            </div>
        </>
    )
}