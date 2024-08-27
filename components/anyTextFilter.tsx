"use client"
import { $api } from "@/lib/api"
import { useSearchQuery } from "@/lib/zust"
import { Label } from "./ui/label"
import { Switch } from "./ui/switch";
import { ComboBoxResponsive } from "./combobox";
import { SearchBar } from "./searchBar";
import { Input } from "./ui/input";

export function AnyTextFilter() {
    const anyTextQuery = useSearchQuery((state) => state.any_text.query)
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Flexible Search
                    </Label>
                    <div className="text-gray-400">
                        Returns items that match any of these filters
                    </div>
                </div>
                {/* <Switch checked={bookmarksFilterEnabled} onCheckedChange={(value) => setBookmarksFilterEnabled(value)} /> */}
            </div>
            <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
                <div className="flex flex-row items-center justify-between">
                    <div className="space-y-0.5">
                        <Label className="text-base">
                            Main Query
                        </Label>
                        <div className="text-gray-400">
                            The text query passed to all the Flexible Search filters
                        </div>
                    </div>
                </div>
                <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-left">
                    <Input
                        type="text"
                        placeholder="Type your query in the main search bar"
                        value={anyTextQuery}
                        className="flex-grow"
                        disabled
                    />
                </div>
            </div>
            <AnyTextPathFilter />
            <AnyTextETFilter />
        </div>
    )
}

function AnyTextPathFilter() {
    const pathRestrictToFilename = useSearchQuery((state) => state.any_text.path_filter.only_match_filename)
    const enablePathFilter = useSearchQuery((state) => state.any_text.enable_path_filter)
    const setPathFilterEnabled = useSearchQuery((state) => state.setAnyTextPathFilterEnabled)
    const setPathFilterFilenameOnly = useSearchQuery((state) => state.setAnyTextPathFilterFilenameOnly)
    const onOptionSelected = (option: string | null) => {
        if (option === null) {
            return
        }
        if (option === "true") {
            setPathFilterFilenameOnly(true)
        } else {
            setPathFilterFilenameOnly(false)
        }
    }
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Path Filter
                    </Label>
                    <div className="text-gray-400">
                        Searches in the path and filename of files
                    </div>
                </div>
                <Switch checked={enablePathFilter} onCheckedChange={(value) => setPathFilterEnabled(value)} />
            </div>
            <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-left">
                <ComboBoxResponsive
                    options={[
                        { value: "true", label: "Filename Only" },
                        { value: "false", label: "Full Path" },
                    ]}
                    currentOption={{ value: pathRestrictToFilename ? "true" : "false", label: pathRestrictToFilename ? "Filename Only" : "Full Path" }}
                    onSelectOption={(option) => onOptionSelected(option?.value || null)}
                    placeholder="Filename or Path..."
                />
            </div>
        </div>
    )
}

function AnyTextETFilter() {

    const enableETFilter = useSearchQuery((state) => state.any_text.enable_et_filter)
    const setETFilterEnabled = useSearchQuery((state) => state.setAnyTextETFilterEnabled)
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Extracted Text Filter
                    </Label>
                    <div className="text-gray-400">
                        Searches in all text extracted from items, including OCR and tags
                    </div>
                </div>
                <Switch checked={enableETFilter} onCheckedChange={(value) => setETFilterEnabled(value)} />
            </div>
            {/* <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-left">
                <ComboBoxResponsive
                    options={[
                        { value: "true", label: "Filename Only" },
                        { value: "false", label: "Full Path" },
                    ]}
                    currentOption={{ value: pathRestrictToFilename ? "true" : "false", label: pathRestrictToFilename ? "Filename Only" : "Full Path" }}
                    onSelectOption={(option) => onOptionSelected(option?.value || null)}
                    placeholder="Filename or Path..."
                />
            </div> */}
        </div>
    )
}