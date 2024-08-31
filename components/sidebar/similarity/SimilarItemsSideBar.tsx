"use client"

import { useDatabase, useImageSimilarity, useItemSelection } from "@/lib/zust"
import { FilterContainer } from "../options/FilterContainer"
import { components } from "@/lib/panoptikon"
import { $api } from "@/lib/api"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { keepPreviousData } from "@tanstack/react-query"
import { SearchResultImage } from "@/components/SearchResultImage"
import { ComboBoxResponsive } from "@/components/combobox"
import { MultiBoxResponsive } from "@/components/multiCombobox"

export function SimilarItemsSideBar() {
    return (
        <div className="mt-4">
            <ClipItemSimilarity />
            <TextEmbeddingsSimilarity />
        </div>
    )
}

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


export function ClipItemSimilarity() {
    const selected = useItemSelection((state) => state.getSelected())
    const dbs = useDatabase((state) => state.getDBs())
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        },
    })
    const clipSetters = data?.setters.filter((setter) => setter[0] === "clip").map((setter) => setter[1]) || []
    const maxClipResults = useImageSimilarity((state) => state.clipMaxResults)
    const selectedClipSetter = useImageSimilarity((state) => state.clipSetter || clipSetters[0] || null)
    return (
        <FilterContainer
            label={<span>CLIP Similarity</span>}
            description={<span>Similar items based on CLIP embeddings</span>}
            storageKey="clip-similarity"
        >
            <CLIPSimilarityFilter setters={clipSetters} />
            <div className="mt-4">
                {selected && selectedClipSetter && maxClipResults > 0 && (
                    <SimilarItemsView
                        item={selected}
                        setter_name={selectedClipSetter}
                        src_setter_names={[]}
                        limit={maxClipResults}
                    />)}
            </div>
        </FilterContainer>
    )
}


export function CLIPSimilarityFilter({
    setters,
}: {
    setters: string[]
}) {
    const setterOptions = setters.map((setter) => ({ label: setter, value: setter }))
    const selectedSetter = useImageSimilarity((state) => state.clipSetter || setters[0] || null)
    const setSelectedSetter = useImageSimilarity((state) => state.setClipSetter)
    const maxResults = useImageSimilarity((state) => state.clipMaxResults)
    const setMaxResults = useImageSimilarity((state) => state.setClipMaxResults)
    return (
        <div className="mt-4">
            <FilterContainer
                storageKey="clip-similarity-filter"
                label={<span>CLIP Filter</span>}
                description={
                    <span>Options for the similarity search</span>
                }
                defaultIsCollapsed
            >
                <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                    <ComboBoxResponsive
                        options={setterOptions}
                        currentValue={selectedSetter}
                        onChangeValue={setSelectedSetter}
                        placeholder="No CLIP Model Selected"
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


export function SimilarItemsView({
    item,
    setter_name,
    src_setter_names,
    limit
}: {
    item: components["schemas"]["FileSearchResult"]
    setter_name: string
    limit: number
    src_setter_names: string[]
}) {
    const dbs = useDatabase((state) => state.getDBs())
    const { data } = $api.useQuery("get", "/api/search/similar/{sha256}/{setter_name}", {
        params: {
            query: {
                limit,
                src_setter_names,
                ...dbs
            },
            path: {
                sha256: item.sha256,
                setter_name
            }
        }
    }, {
        placeholderData: keepPreviousData
    })
    const setSelected = useItemSelection((state) => state.setItem)
    const onImageClick = (index: number) => {
        if (!data) return
        const item = data.results[index]
        setSelected(item)
    }
    return (
        <div className="mt-4">
            {data && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 4xl:grid-cols-2 5xl:grid-cols-2 gap-4">
                    {data.results.map((result, index) => (
                        <SearchResultImage key={index} result={result} index={index} dbs={dbs} imageContainerClassName="h-96 xl:h-80 4xl:h-80 5xl:h-80" onImageClick={() => onImageClick(index)} />
                    ))}
                </div>
            )}
        </div>
    )
}