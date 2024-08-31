
import { useDatabase, useImageSimilarity, useItemSelection } from "@/lib/zust"
import { FilterContainer } from "../options/FilterContainer"
import { components } from "@/lib/panoptikon"
import { $api } from "@/lib/api"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { keepPreviousData } from "@tanstack/react-query"
import { SearchResultImage } from "@/components/SearchResultImage"
import { ComboBoxResponsive } from "@/components/combobox"
import { MultiBoxResponsive } from "@/components/multiCombobox"
import { SimilarItemsView } from "./SimilarItemsView"

export function TextEmbeddingsSimilarity() {
    const selected = useItemSelection((state) => state.getSelected())
    const dbs = useDatabase((state) => state.getDBs())
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        },
    })
    const textEmbedSetters = data?.setters.filter((setter) => setter[0] === "text-embedding").map((setter) => setter[1]) || []
    const textSources = data?.setters.filter((setter) => setter[0] === "text").map((setter) => setter[1]) || []
    const maxTextResults = useImageSimilarity((state) => state.textEmbeddingMaxResults)
    const selectedTextEmbedding = useImageSimilarity((state) => state.textEmbeddingSetter || textEmbedSetters[0] || null)
    const selectedTextSources = useImageSimilarity((state) => state.textSources)
    return (
        <FilterContainer
            label={<span>Text Semantic Similarity</span>}
            description={<span>Similar items based on text embeddings</span>}
            storageKey="text-embeddings-similarity"
        >
            <TextEmbeddingsSimilarityFilter setters={textEmbedSetters} textSetters={textSources} />
            <div className="mt-4">
                {selected && selectedTextEmbedding && maxTextResults > 0 && (
                    <SimilarItemsView
                        item={selected}
                        setter_name={selectedTextEmbedding}
                        src_setter_names={selectedTextSources}
                        limit={maxTextResults}
                    />)}
            </div>
        </FilterContainer>
    )
}
export function TextEmbeddingsSimilarityFilter({
    setters,
    textSetters,
}: {
    setters: string[]
    textSetters: string[]
}) {
    const selectedSetter = useImageSimilarity((state) => state.textEmbeddingSetter || setters[0] || null)
    const setSelectedSetter = useImageSimilarity((state) => state.setTextEmbeddingSetter)
    const maxResults = useImageSimilarity((state) => state.textEmbeddingMaxResults)
    const setMaxResults = useImageSimilarity((state) => state.setTextEmbeddingMaxResults)
    const textSources = useImageSimilarity((state) => state.textSources)
    const setTextSources = useImageSimilarity((state) => state.setTextSources)

    const setterOptions = setters.map((setter) => ({ label: setter, value: setter }))
    const textSourcesOptions = [{ value: "*", label: "All Text Sources" }, ...textSetters.map((setter) => ({ label: setter, value: setter }))]
    return (
        <div className="mt-4">
            <FilterContainer
                storageKey="clip-similarity-filter"
                label={<span>Text Embeddings Filter</span>}
                description={
                    <span>Options for the text semantic similarity search</span>
                }
                defaultIsCollapsed
            >
                <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                    <ComboBoxResponsive
                        options={setterOptions}
                        currentValue={selectedSetter}
                        onChangeValue={setSelectedSetter}
                        placeholder="No Text Embed Model Selected"
                    />
                </div>
                <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                    <MultiBoxResponsive
                        options={textSourcesOptions}
                        currentValues={textSources}
                        onSelectionChange={setTextSources}
                        resetValue="*"
                        maxDisplayed={3}
                        placeholder="Select Text Sources"
                    />
                </div>
                <ConfidenceFilter
                    label={<span>Max Results Displayed</span>}
                    confidence={maxResults}
                    setConfidence={setMaxResults}
                    description={<span>'0' disables this similarity query</span>}
                    min={0}
                    max={50}
                    step={1}
                />
            </FilterContainer>
        </div>
    )
}


