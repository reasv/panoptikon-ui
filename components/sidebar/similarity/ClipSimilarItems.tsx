import { FilterContainer } from "../base/FilterContainer"
import { $api } from "@/lib/api"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { SimilarItemsView } from "./SimilarItemsView"
import { useItemSelection } from "@/lib/state/itemSelection"
import { useSelectedDBs } from "@/lib/state/database"
import { useSBClipSimilarity, useSBClipSimilarityTextSrc, useSBSimilarityPageArgs, useSBSimilarityQuery } from "@/lib/state/searchQuery/clientHooks"
import { ItemSimilaritySearchOptions } from "../options/itemSimilarity/similaritySearchOptions"

export function ClipItemSimilarity() {
    const sha256 = useItemSelection((state) => state.getSelected()?.sha256)

    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        },
    })
    const clipSetters = data?.setters.filter((setter) => setter[0] === "clip").map((setter) => setter[1]) || []
    const [filter, setFilter] = useSBClipSimilarity()
    const model = filter.model.length > 0 ? filter.model : clipSetters[0] || ""
    const [srcFilter, setSrcFilter] = useSBClipSimilarityTextSrc()
    const { clip } = useSBSimilarityQuery()
    const [pageArgs, setPageArgs] = useSBSimilarityPageArgs()
    return (
        <FilterContainer
            label={<span>CLIP Similarity</span>}
            description={<span>Similar items based on CLIP embeddings</span>}
            storageKey="clip-similarity"
            unMountOnCollapse
        >
            <FilterContainer
                label={<span>CLIP Options</span>}
                description={<span>Options for CLIP similarity</span>}
                storageKey="clip-similarity-options"
            >
                <ConfidenceFilter
                    label={<span>Max Results Displayed</span>}
                    confidence={pageArgs.page_size_clip}
                    setConfidence={(value) => setPageArgs({ page_size_clip: value })}
                    description={<span>'0' disables this similarity query</span>}
                    min={0}
                    max={50}
                    step={1}
                />
                <ItemSimilaritySearchOptions
                    storageKey="clip-item-similarity-src"
                    filter={{
                        ...filter,
                        distance_function: "COSINE",
                        target: "",
                        model,
                    }}
                    setFilter={setFilter}
                    srcFilter={srcFilter}
                    setSrcFilter={setSrcFilter}
                />
            </FilterContainer>
            <div className="mt-4">
                {sha256 && model.length > 0 && pageArgs.page_size_clip > 0 && (
                    <SimilarItemsView
                        model={model}
                        srcFilterOptions={srcFilter}
                        filterOptions={filter}
                        distance_function={"COSINE"}
                        sha256={sha256}
                        query={clip(sha256, model)}
                    />)}
            </div>
        </FilterContainer>
    )
}