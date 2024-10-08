import { $api } from "@/lib/api"
import { Label } from "../../ui/label"
import { Switch } from "../../ui/switch"
import { MultiBoxResponsive } from "../../multiCombobox"
import { useSelectedDBs } from "@/lib/state/database"
import { SetFn } from "@/lib/state/searchQuery/clientHooks"
import { KeymapComponents } from "@/lib/state/searchQuery/searchQueryKeyMaps"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { FilterContainer } from "./FilterContainer"

export function TextFilter({
    enable,
    setEnable,
    filter,
    setFilter,
    children,
    storageKey,
}: {
    enable: boolean,
    setEnable: (value: boolean) => void,
    filter: KeymapComponents["ATMatchText"] | KeymapComponents["MatchText"],
    setFilter: SetFn<KeymapComponents["ATMatchText"] | KeymapComponents["MatchText"]>
    children?: React.ReactNode,
    storageKey: string
}) {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        }
    })

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
                <Switch checked={enable} onCheckedChange={(value) => setEnable(value)} />
            </div>
            {children}
            <FilterContainer
                label="Text Filters"
                description="Allow text that matches the following criteria"
                storageKey={storageKey}
            >
                <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                    <MultiBoxResponsive
                        options={textTargets}
                        resetValue="*" // Reset value is the value that will clear the selection
                        currentValues={filter.setters}
                        onSelectionChange={(value) => setFilter({ setters: value })}
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
                    confidence={filter.min_language_confidence || 0}
                    setConfidence={(value) => setFilter({ min_language_confidence: value })}
                    description={<span>Minimum confidence for language detection</span>}
                />
                <ConfidenceFilter
                    label={<span>Mininum Length</span>}
                    confidence={filter.min_length || 0}
                    setConfidence={(value) => setFilter({ min_length: value })}
                    description={<span>Minimum characters in text</span>}
                />
                <ConfidenceFilter
                    label={<span>Maximum Length</span>}
                    confidence={filter.max_length || 0}
                    setConfidence={(value) => setFilter({ max_length: value })}
                    description={<span>Maximum characters in text</span>}
                />
            </FilterContainer>
        </div>
    )
}