import { $api } from "@/lib/api"
import { Label } from "../../ui/label"
import { Switch } from "../../ui/switch";
import { ComboBoxResponsive } from "../../combobox";
import { Input } from "../../ui/input";
import { MultiBoxResponsive } from "../../multiCombobox";
import { FilterContainer } from "./FilterContainer";
import { ConfidenceFilter } from "./confidenceFilter";
import { useSelectedDBs } from "@/lib/state/database";
import { useAnyTextExtractedTextFilters, useAnyTextPathTextFilters, useQueryOptions } from "@/lib/state/searchQuery/clientHooks";

export function AnyTextFilter() {
    const [options, _] = useQueryOptions()
    return (
        <FilterContainer
            storageKey="flexibleSearchContainer" // Add a storageKey prop to make the localStorage key unique
            label={<span>Flexible Search</span>}
            description={
                <span>Returns items that match any of these filters</span>
            }
        >
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
                        value={options.at_query}
                        className="flex-grow"
                        disabled
                    />
                </div>
            </div>
            <AnyTextPathFilter />
            <AnyTextETFilter />
        </FilterContainer>
    )
}

function AnyTextPathFilter() {
    const [filter, setFilter] = useAnyTextPathTextFilters()
    const [options, setOptions] = useQueryOptions()
    const onOptionSelected = (option: string | null) => {
        if (option === null) {
            return
        }
        if (option === "true") {
            setFilter({ only_match_filename: true })
        } else {
            setFilter({ only_match_filename: false })
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
                <Switch checked={options.at_e_path} onCheckedChange={(value) => setOptions({ at_e_path: value })} />
            </div>
            <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-left">
                <ComboBoxResponsive
                    options={[
                        { value: "true", label: "Filename Only" },
                        { value: "false", label: "Full Path" },
                    ]}
                    currentValue={filter.only_match_filename ? "true" : "false"}
                    onChangeValue={onOptionSelected}
                    placeholder="Filename or Path..."
                />
            </div>
        </div>
    )
}

function AnyTextETFilter() {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        }
    })
    const [options, setOptions] = useQueryOptions()
    const [filter, setFilter] = useAnyTextExtractedTextFilters()
    const textTargets = [{ value: "*", label: "All Sources" }, ...(
        data?.setters
            .filter((setter) => setter[0] === "text")
            .map((setter) => ({ value: setter[1], label: setter[1] })) || [])
    ]

    const textLanguages = [{ value: "*", label: "All Languages" }, ...(data?.text_stats.languages || []).map(lang => ({ value: lang, label: lang }))]
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Extracted Text Search
                    </Label>
                    <div className="text-gray-400">
                        Searches in all text extracted from items, including OCR and tags
                    </div>
                </div>
                <Switch checked={options.at_e_et} onCheckedChange={(value) => setOptions({ at_e_et: value })} />
            </div>
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                <MultiBoxResponsive
                    options={textTargets}
                    resetValue="*" // Reset value is the value that will clear the selection
                    currentValues={filter.targets}
                    onSelectionChange={(value) => setFilter({ targets: value })}
                    maxDisplayed={3}
                    placeholder="Targets..."
                />
            </div>
            <ConfidenceFilter
                label={<span>Confidence Threshold</span>}
                confidence={filter.min_confidence || 0}
                setConfidence={(value) => setFilter({ min_confidence: value })}
                description={<span>Minimum confidence for the extracted text</span>}
            />
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                <MultiBoxResponsive
                    options={textLanguages}
                    resetValue="*" // Reset value is the value that will clear the selection
                    currentValues={filter.languages}
                    onSelectionChange={(value) => setFilter({ languages: value })}
                    maxDisplayed={3}
                    placeholder="Languages..."
                />
            </div>
            <ConfidenceFilter
                label={<span>Language Confidence Threshold</span>}
                confidence={filter.language_min_confidence || 0}
                setConfidence={(value) => setFilter({ language_min_confidence: value })}
                description={<span>Minimum confidence for language detection</span>}
            />
        </div>
    )
}