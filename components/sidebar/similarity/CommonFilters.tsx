
import { } from "@/lib/state/zust"
import { FilterContainer } from "../options/FilterContainer"
import { $api } from "@/lib/api"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { ComboBoxResponsive } from "@/components/combobox"
import { MultiBoxResponsive } from "@/components/multiCombobox"
import { Switch } from "@/components/ui/switch"
import { components } from "@/lib/panoptikon"
import { useSelectedDBs } from "@/lib/state/database"

export function SwitchOption({
    label,
    description,
    value,
    setValue,
}: {
    label: string
    description: string
    value: boolean
    setValue: (value: boolean) => void
}) {
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <div className="text-base font-medium">{label}</div>
                    {description && <div className="text-gray-400">{description}</div>}
                </div>
                <Switch checked={value} onCheckedChange={setValue} />
            </div>
        </div>
    )
}
export function AggregationOptions({
    textEmbeddingQuery,
    setTextEmbeddingQuery,
}: {
    textEmbeddingQuery: components["schemas"]["SimilarItemsRequest"]
    setTextEmbeddingQuery: (query: components["schemas"]["SimilarItemsRequest"]) => void
}) {
    const aggregationOptions = ["AVG", "MAX", "MIN"] as const
    return (
        <FilterContainer
            storageKey="similarity-aggregation-options"
            label={<span>Distance Aggregation Options</span>}
            description={
                <span>How to aggregate distances of different embeddings for an item</span>
            }
        // defaultIsCollapsed
        >
            <ComboBoxResponsive
                options={aggregationOptions.map((option) => ({ label: option, value: option }))}
                currentValue={textEmbeddingQuery.distance_aggregation}
                onChangeValue={(value) => {
                    if (!value) return
                    const index = ["AVG", "MAX", "MIN"].indexOf(value)
                    if (index === -1) return
                    setTextEmbeddingQuery({ ...textEmbeddingQuery, distance_aggregation: aggregationOptions[index] })
                }}
                placeholder="Select Aggregation Function"
            />
            <ConfidenceFilter
                label={<span>Text Confidence Weight</span>}
                description={<span>'0' disables this weight</span>}
                confidence={textEmbeddingQuery.src_confidence_weight}
                setConfidence={(value) => setTextEmbeddingQuery({ ...textEmbeddingQuery, src_confidence_weight: value })}
                min={0}
                max={3}
                step={0.01}
            />
            <ConfidenceFilter
                label={<span>Language Confidence Weight</span>}
                description={<span>'0' disables this weight</span>}
                confidence={textEmbeddingQuery.src_language_confidence_weight}
                setConfidence={(value) => setTextEmbeddingQuery({ ...textEmbeddingQuery, src_language_confidence_weight: value })}
                min={0}
                max={3}
                step={0.01}
            />
        </FilterContainer>
    )
}

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