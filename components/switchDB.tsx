"use client"
import { $api } from "@/lib/api"
import { useDatabase } from "@/lib/zust"
import { Label } from "./ui/label"
import { ComboBoxResponsive } from "./combobox";

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
                    <ComboBoxResponsive
                        options={data?.index.all.map((db) => ({ value: db, label: db })) || []}
                        currentOption={index_db ? { value: index_db, label: index_db } : (data ? { value: data?.index.current, label: data?.index.current } : null)}
                        onSelectOption={(option) => setIndexDB(option?.value || null)}
                        placeholder="Search in..."
                    />
                </div>
            </div>
        </>
    )
}