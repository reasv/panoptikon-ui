import { FilterContainer } from "./FilterContainer"
import { $api } from "@/lib/api"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { MultiBoxResponsive } from "@/components/multiCombobox"
import { components } from "@/lib/panoptikon"
import { useSelectedDBs } from "@/lib/state/database"

export function SourceTextFilter({
    textFilters,
    setTextFilters,
}: {
    textFilters: components["schemas"]["TextFilter"]
    setTextFilters: (filter: components["schemas"]["TextFilter"]) => void
}) {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/search/stats", { params: { query: dbs, } })
    const textSetters = ["*", ...data?.setters.filter((s) => s[0] === "text").map((s) => s[1]) || []]
    const setterOptions = textSetters.map((setter) => ({ value: setter, label: setter === "*" ? "All Text Sources" : setter }))
    const textLanguages = ["*", ...data?.text_stats.languages || []]
    const languageOptions = textLanguages.map((setter) => ({ value: setter, label: setter === "*" ? "All Languages" : setter }))
    return (
        <FilterContainer
            storageKey="similar-items-source-text-filter"
            label={<span>Text Filters</span>}
            description={
                <span>Filter the source text for text embeddings</span>
            }
        // defaultIsCollapsed
        >
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                <MultiBoxResponsive
                    options={setterOptions}
                    currentValues={textFilters.setter_names || []}
                    onSelectionChange={(values) => setTextFilters({ ...textFilters, setter_names: values })}
                    placeholder="Select Sources"
                    resetValue="*"
                    maxDisplayed={4}
                    buttonClassName="max-w-[350px]"
                />
            </div>
            <ConfidenceFilter
                label={<span>Confidence Threshold</span>}
                confidence={textFilters.min_confidence || 0}
                setConfidence={(value) => setTextFilters({ ...textFilters, min_confidence: value })}
                description={<span>Minimum confidence for the extracted text</span>}
            />
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                <MultiBoxResponsive
                    options={languageOptions}
                    currentValues={textFilters.languages || []}
                    onSelectionChange={(values) => setTextFilters({ ...textFilters, languages: values })}
                    placeholder="Select Sources"
                    resetValue="*"
                    maxDisplayed={4}
                    buttonClassName="max-w-[350px]"
                />
            </div>
            <ConfidenceFilter
                label={<span>Language Confidence Threshold</span>}
                confidence={textFilters.min_language_confidence || 0}
                setConfidence={(value) => setTextFilters({ ...textFilters, min_language_confidence: value })}
                description={<span>Minimum confidence for language detection</span>}
            />
            <ConfidenceFilter
                label={<span>Minimum Source Length</span>}
                confidence={textFilters.min_length || 0}
                setConfidence={(value) => setTextFilters({ ...textFilters, min_length: value })}
                description={<span>Minimum Character Length for the text</span>}
                min={0}
                max={250}
                step={1}
            />
        </FilterContainer>
    )
}