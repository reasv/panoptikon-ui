
import { FilterContainer } from "../base/FilterContainer"
import { $api } from "@/lib/api"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { SimilarItemsView } from "./SimilarItemsView"
import { useItemSelection } from "@/lib/state/itemSelection"
import { useSelectedDBs } from "@/lib/state/database"
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
                    confidence={pageArgs.page_size_text}
                    setConfidence={(value) => setPageArgs({ page_size_text: value })}
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
                {sha256 && model.length > 0 && pageArgs.page_size_text > 0 && (
                    <SimilarItemsView
                        filterOptions={filter}
                        srcFilterOptions={srcFilter}
                        model={model}
                        distance_function="L2"
                        sha256={sha256}
                        query={text(sha256, model)}
                    />)}
            </div>
        </FilterContainer>
    )
}