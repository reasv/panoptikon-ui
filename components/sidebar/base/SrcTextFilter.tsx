import { FilterContainer } from "./FilterContainer"
import { $api } from "@/lib/api"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { MultiBoxResponsive } from "@/components/multiCombobox"
import { components } from "@/lib/panoptikon"
import { useSelectedDBs } from "@/lib/state/database"
import { ATSourceText } from "@/lib/state/searchQuery/searchQueryKeyMaps"
import { SetFn } from "@/lib/state/searchQuery/clientHooks"

export function SrcTextFilter({
    filter,
    setFilter,
}: {
    filter: components["schemas"]["SourceArgs"] | ATSourceText
    setFilter: SetFn<components["schemas"]["SourceArgs"] | ATSourceText>
}) {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/search/stats", { params: { query: dbs, } })
    const textSetters = ["*", ...data?.setters.filter((s) => s[0] === "text").map((s) => s[1]) || []]
    const setterOptions = textSetters.map((setter) => ({ value: setter, label: setter === "*" ? "All Text Sources" : setter }))
    const textLanguages = ["*", ...data?.text_stats.languages || []]
    const languageOptions = textLanguages.map((setter) => ({ value: setter, label: setter === "*" ? "All Languages" : setter }))
    return (
        <FilterContainer
            storageKey="source-text-filter"
            label={<span>Text Filters</span>}
            description={
                <span>Filter the source text for text embeddings</span>
            }
        >
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                <MultiBoxResponsive
                    options={setterOptions}
                    currentValues={filter.setters || []}
                    onSelectionChange={(values) => setFilter({ setters: values })}
                    placeholder="Select Sources"
                    resetValue="*"
                    maxDisplayed={4}
                    buttonClassName="max-w-[350px]"
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
                    options={languageOptions}
                    currentValues={filter.languages || []}
                    onSelectionChange={(values) => setFilter({ languages: values })}
                    placeholder="Select Sources"
                    resetValue="*"
                    maxDisplayed={4}
                    buttonClassName="max-w-[350px]"
                />
            </div>
            <ConfidenceFilter
                label={<span>Language Confidence Threshold</span>}
                confidence={filter.min_language_confidence || 0}
                setConfidence={(value) => setFilter({ min_language_confidence: value })}
                description={<span>Min confidence for language detection</span>}
            />
            <ConfidenceFilter
                label={<span>Minimum Source Length</span>}
                confidence={filter.min_length || 0}
                setConfidence={(value) => setFilter({ min_length: value })}
                description={<span>Min Character Length for the text</span>}
                min={0}
                max={250}
                step={1}
            />
            <ConfidenceFilter
                label={<span>Maximum Source Length</span>}
                confidence={filter.max_length || 0}
                setConfidence={(value) => setFilter({ max_length: value })}
                description={<span>Max Character Length for the text</span>}
                min={0}
                max={250}
                step={1}
            />
            <ConfidenceFilter
                label={<span>Confidence Weight</span>}
                confidence={filter.confidence_weight || 0}
                setConfidence={(value) => setFilter({ confidence_weight: value })}
                description={<span>Weight of conf. on dist. aggr.</span>}
                min={-1}
                max={16}
                step={0.1}
            />
            <ConfidenceFilter
                label={<span>Language Confidence Weight</span>}
                confidence={filter.language_confidence_weight || 0}
                setConfidence={(value) => setFilter({ language_confidence_weight: value })}
                description={<span>Weight of lang. conf. on dist. aggr.</span>}
                min={-1}
                max={16}
                step={0.1}
            />
        </FilterContainer>
    )
}