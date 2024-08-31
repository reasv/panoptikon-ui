
import { useDatabase } from "@/lib/state/zust"
import { FilterContainer } from "../options/FilterContainer"
import { $api } from "@/lib/api"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { ComboBoxResponsive } from "@/components/combobox"
import { SimilarItemsView } from "./SimilarItemsView"
import { useImageSimilarity } from "@/lib/state/similarityStore"
import { components } from "@/lib/panoptikon"
import { AggregationOptions, SourceTextFilter } from "./CommonFilters"
import { useItemSelection } from "@/lib/state/itemSelection"

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
