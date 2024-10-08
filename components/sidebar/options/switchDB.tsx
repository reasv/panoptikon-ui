import { $api } from "@/lib/api"
import { Label } from "../../ui/label"
import { ComboBoxResponsive } from "../../combobox";
import { useSelectedDBs } from "@/lib/state/database";
import { useScanDrawerOpen } from "@/lib/state/scanDrawer";

export function SwitchDB() {
    const { data } = $api.useQuery("get", "/api/db")
    const [{ index_db }, setDBs] = useSelectedDBs()
    const drawerOpen = useScanDrawerOpen()[0]
    return (
        <>
            <div className="flex flex-row items-center justify-between rounded-lg border p-4 mt-4">
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
                        currentValue={index_db ? index_db : data?.index.current || null}
                        onChangeValue={(v) => setDBs({
                            index_db: v,
                        })}
                        placeholder="Search in..."
                        forceDrawer={drawerOpen}
                    />
                </div>
            </div>
        </>
    )
}