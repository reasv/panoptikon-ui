
import { useDatabase, useItemSelection } from "@/lib/zust"
import { FilterContainer } from "../options/FilterContainer"
import { $api } from "@/lib/api"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { ComboBoxResponsive } from "@/components/combobox"
import { MultiBoxResponsive } from "@/components/multiCombobox"
import { SimilarItemsView } from "./SimilarItemsView"
import { useImageSimilarity } from "@/lib/similarityStore"
import { Switch } from "@/components/ui/switch"
import { components } from "@/lib/panoptikon"

export function TextEmbeddingsSimilarity() {
    const selected = useItemSelection((state) => state.getSelected())
    const dbs = useDatabase((state) => state.getDBs())
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        },
    })
    const setters = data?.setters.filter((setter) => setter[0] === "text-embedding").map((setter) => setter[1]) || []
    const textEmbeddingQuery = useImageSimilarity((state) => state.getTextEmbedQuery(setters[0] || ""))
    const setTextEmbeddingQuery = useImageSimilarity((state) => state.setTextEmbedQuery)
    return (
        <FilterContainer
            label={<span>Text Semantic Similarity</span>}
            description={<span>Similar items based on text embeddings</span>}
            storageKey="text-embeddings-similarity"
        >
            <TextEmbeddingsSimilarityFilter setters={setters} setTextEmbeddingQuery={setTextEmbeddingQuery} textEmbeddingQuery={textEmbeddingQuery} />
            <div className="mt-4">
                {selected && textEmbeddingQuery.setter_name.length > 0 && textEmbeddingQuery.limit > 0 && (
                    <SimilarItemsView
                        item={selected}
                        query={textEmbeddingQuery}
                    />)}
            </div>
        </FilterContainer>
    )
}
export function TextEmbeddingsSimilarityFilter({
    setters,
    textEmbeddingQuery,
    setTextEmbeddingQuery,
}: {
    setters: string[]
    textEmbeddingQuery: components["schemas"]["SimilarItemsRequest"]
    setTextEmbeddingQuery: (query: components["schemas"]["SimilarItemsRequest"]) => void
}) {
    const setterOptions = setters.map((setter) => ({ label: setter, value: setter }))
    return (
        <FilterContainer
            storageKey="text-similarity-filter"
            label={<span>Text Embeddings Filter</span>}
            description={
                <span>Options for the text semantic similarity search</span>
            }
            defaultIsCollapsed
        >
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                <ComboBoxResponsive
                    options={setterOptions}
                    currentValue={textEmbeddingQuery.setter_name.length > 0 ? textEmbeddingQuery.setter_name : null}
                    onChangeValue={(setter_name) => setter_name ? setTextEmbeddingQuery({ ...textEmbeddingQuery, setter_name }) : null}
                    placeholder="No Text Embed Model Selected"
                />
            </div>
            <ConfidenceFilter
                label={<span>Max Results Displayed</span>}
                confidence={textEmbeddingQuery.limit}
                setConfidence={(value) => setTextEmbeddingQuery({ ...textEmbeddingQuery, limit: value })}
                description={<span>'0' disables this similarity query</span>}
                min={0}
                max={50}
                step={1}
            />
            <SourceTextFilter textFilters={textEmbeddingQuery.src_text!} setTextFilters={(filter) => setTextEmbeddingQuery({
                ...textEmbeddingQuery, src_text: filter
            })} />
            <AggregationOptions textEmbeddingQuery={textEmbeddingQuery} setTextEmbeddingQuery={setTextEmbeddingQuery} />
        </FilterContainer>
    )
}

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

function CrossModalOptions({
    clipEmbeddingQuery,
    setCLIPEmbeddingQuery,
}: {
    clipEmbeddingQuery: components["schemas"]["SimilarItemsRequest"]
    setCLIPEmbeddingQuery: (query: components["schemas"]["SimilarItemsRequest"]) => void
}) {
    return (
        <FilterContainer
            storageKey="cross-modal-options"
            label={<span>Cross Modal Similarity</span>}
            description={
                <span>Compare text and image embeddings together</span>
            }
            defaultIsCollapsed
        >
            <SwitchOption
                label="Enable Cross Modal"
                description="Enables cross modal similarity search"
                value={clipEmbeddingQuery.clip_xmodal}
                setValue={(value) => setCLIPEmbeddingQuery({ ...clipEmbeddingQuery, clip_xmodal: value })}
            />
            <SwitchOption
                label="Text to Text"
                description="Compare text embeddings to text embeddings"
                value={clipEmbeddingQuery.xmodal_t2t}
                setValue={(value) => setCLIPEmbeddingQuery({ ...clipEmbeddingQuery, xmodal_t2t: value })}
            />
            <SwitchOption
                label="Image to Image"
                description="Compare image embeddings to image embeddings"
                value={clipEmbeddingQuery.xmodal_i2i}
                setValue={(value) => setCLIPEmbeddingQuery({ ...clipEmbeddingQuery, xmodal_i2i: value })}
            />
            <SourceTextFilter textFilters={clipEmbeddingQuery.src_text!} setTextFilters={(filter) => setCLIPEmbeddingQuery({
                ...clipEmbeddingQuery, src_text: filter
            })} />
        </FilterContainer>
    )
}

function AggregationOptions({
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
            defaultIsCollapsed
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

function SourceTextFilter({
    textFilters,
    setTextFilters,
}: {
    textFilters: components["schemas"]["TextFilter"]
    setTextFilters: (filter: components["schemas"]["TextFilter"]) => void
}) {
    const dbs = useDatabase((state) => state.getDBs())
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
            defaultIsCollapsed
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