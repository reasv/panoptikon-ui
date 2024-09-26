import { Label } from "../../ui/label"
import { Switch } from "../../ui/switch"
import { ComboBoxResponsive } from "../../combobox"
import { SetFn } from "@/lib/state/searchQuery/clientHooks"
import { KeymapComponents } from "@/lib/state/searchQuery/searchQueryKeyMaps"

export function PathFilter({
    enable,
    setEnable,
    filter,
    setFilter,
    children,
}: {
    enable: boolean,
    setEnable: (value: boolean) => void,
    filter: KeymapComponents["ATMatchPath"] | KeymapComponents["MatchPath"],
    setFilter: SetFn<KeymapComponents["MatchPath"] | KeymapComponents["ATMatchPath"]>
    children?: React.ReactNode
}) {
    const onOptionSelected = (option: string | null) => {
        if (option === null) {
            return
        }
        if (option === "true") {
            setFilter({ filename_only: true })
        } else {
            setFilter({ filename_only: false })
        }
    }
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Path Search
                    </Label>
                    <div className="text-gray-400">
                        Searches in the path and filename of files
                    </div>
                </div>
                <Switch checked={enable} onCheckedChange={(value) => setEnable(value)} />
            </div>
            {children}
            <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-left">
                <ComboBoxResponsive
                    options={[
                        { value: "true", label: "Filename Only" },
                        { value: "false", label: "Full Path" },
                    ]}
                    currentValue={filter.filename_only ? "true" : "false"}
                    onChangeValue={onOptionSelected}
                    placeholder="Filename or Path..."
                />
            </div>
        </div>
    )
}
