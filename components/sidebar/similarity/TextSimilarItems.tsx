
import { FilterContainer } from "../base/FilterContainer"
import { $api } from "@/lib/api"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { ComboBoxResponsive } from "@/components/combobox"
import { SimilarItemsView } from "./SimilarItemsView"
import { useImageSimilarity } from "@/lib/state/similarityStore"
import { components } from "@/lib/panoptikon"
import { useItemSelection } from "@/lib/state/itemSelection"
import { useSelectedDBs } from "@/lib/state/database"
import { SourceTextFilter } from "../base/SourceTextFilter"
import { AggregationOptions } from "../base/AggregationOptions"
import { SimilarityQueryType } from "@/lib/state/similarityQuery/similarityQueryKeyMaps"
import { useSBSimilarityPageArgs, useSBSimilarityQuery, useSBTextSimilarity, useSBTextSimilarityTextSrc } from "@/lib/state/searchQuery/clientHooks"
import { ItemSimilaritySearchOptions } from "../options/itemSimilarity/similaritySearchOptions"

export function TextEmbeddingsSimilarity() {
    const sha256 = useItemSelection((state) => state.getSelected()?.sha256)
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        },
    })
    const setters = data?.setters.filter((setter) => setter[0] === "text-embedding").map((setter) => setter[1]) || []
    const [filter, setFilter] = useSBTextSimilarity()
    const [srcFilter, setSrcFilter] = useSBTextSimilarityTextSrc()
    const { text } = useSBSimilarityQuery()
    const [pageArgs, setPageArgs] = useSBSimilarityPageArgs()
    const model = filter.model.length > 0 ? filter.model : setters[0] || ""
    return (
        <FilterContainer
            label={<span>Text Semantic Similarity</span>}
            description={<span>Similar items based on text embeddings</span>}
            storageKey="text-embeddings-similarity"
            unMountOnCollapse
        >
            <FilterContainer
                label={<span>Text Embedding Options</span>}
                description={<span>Options for text embeddings</span>}
                storageKey="text-similarity-options"
            >
                <ConfidenceFilter
                    label={<span>Max Results Displayed</span>}
                    confidence={pageArgs.page_size}
                    setConfidence={(value) => setPageArgs({ page_size: value })}
                    description={<span>'0' disables this similarity query</span>}
                    min={0}
                    max={50}
                    step={1}
                />
                <ItemSimilaritySearchOptions
                    storageKey="text-item-similarity-src"
                    filter={{
                        ...filter,
                        distance_function: "L2",
                        target: sha256 || "",
                        clip_xmodal: false,
                        xmodal_i2i: true,
                        xmodal_t2t: true,
                        model,
                    }}
                    setFilter={setFilter}
                    srcFilter={srcFilter}
                    setSrcFilter={setSrcFilter}
                />
            </FilterContainer>
            <div className="mt-4">
                {sha256 && model.length > 0 && pageArgs.page_size > 0 && (
                    <SimilarItemsView
                        type={SimilarityQueryType.textEmbedding}
                        sha256={sha256}
                        query={text(sha256, model)}
                    />)}
            </div>
        </FilterContainer>
    )
}
export function TextEmbeddingsSimilarityFilter({
    setters,
    textEmbeddingQuery,
    setTextEmbeddingQuery,
    hideMaxResults
}: {
    setters: string[]
    textEmbeddingQuery: components["schemas"]["SimilarItemsRequest"]
    setTextEmbeddingQuery: (query: components["schemas"]["SimilarItemsRequest"]) => void
    hideMaxResults?: boolean
}) {
    const setterOptions = setters.map((setter) => ({ label: setter, value: setter }))
    return (
        <FilterContainer
            storageKey="text-similarity-filter"
            label={<span>Text Embeddings Filter</span>}
            description={
                <span>Options for the text semantic similarity search</span>
            }
        // defaultIsCollapsed
        >
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                <ComboBoxResponsive
                    options={setterOptions}
                    currentValue={textEmbeddingQuery.setter_name.length > 0 ? textEmbeddingQuery.setter_name : null}
                    onChangeValue={(setter_name) => setter_name ? setTextEmbeddingQuery({ ...textEmbeddingQuery, setter_name }) : null}
                    placeholder="No Text Embed Model Selected"
                />
            </div>
            {hideMaxResults && <ConfidenceFilter
                label={<span>Max Results Displayed</span>}
                confidence={textEmbeddingQuery.page_size}
                setConfidence={(value) => setTextEmbeddingQuery({ ...textEmbeddingQuery, page_size: value })}
                description={<span>'0' disables this similarity query</span>}
                min={0}
                max={50}
                step={1}
            />}
            <SourceTextFilter textFilters={textEmbeddingQuery.src_text!} setTextFilters={(filter) => setTextEmbeddingQuery({
                ...textEmbeddingQuery, src_text: filter
            })} />
            <AggregationOptions textEmbeddingQuery={textEmbeddingQuery} setTextEmbeddingQuery={setTextEmbeddingQuery} />
        </FilterContainer>
    )
}
