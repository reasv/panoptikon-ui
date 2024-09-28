import { FilterContainer } from "../base/FilterContainer"
import { $api } from "@/lib/api"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { ComboBoxResponsive } from "@/components/combobox"
import { SimilarItemsView } from "./SimilarItemsView"
import { components } from "@/lib/panoptikon"
import { useImageSimilarity } from "@/lib/state/similarityStore"
import { useItemSelection } from "@/lib/state/itemSelection"
import { useSelectedDBs } from "@/lib/state/database"
import { SwitchFilter } from "../base/SwitchFilter"
import { AggregationOptions } from "../base/AggregationOptions"
import { SourceTextFilter } from "../base/SourceTextFilter"
import { SimilarityQueryType } from "@/lib/state/similarityQuery/similarityQueryKeyMaps"
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
    const clipQuery = useImageSimilarity((state) => state.getClipQuery(clipSetters[0] || ""))
    const [filter, setFilter] = useSBClipSimilarity()
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
                    confidence={pageArgs.page_size}
                    setConfidence={(value) => setPageArgs({ page_size: value })}
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
                        model: filter.model.length > 0 ? filter.model : clipSetters[0] || ""
                    }}
                    setFilter={setFilter}
                    srcFilter={srcFilter}
                    setSrcFilter={setSrcFilter}
                />
            </FilterContainer>
            <div className="mt-4">
                {sha256 && clipQuery.setter_name.length > 0 && clipQuery.page_size > 0 && (
                    <SimilarItemsView
                        type={SimilarityQueryType.clip}
                        sha256={sha256}
                        query={clipQuery}
                    />)}
            </div>
        </FilterContainer>
    )
}

export function CLIPSimilarityFilter({
    setters,
    clipQuery,
    setClipQuery,
    hideMaxResults
}: {
    setters: string[]
    clipQuery: components["schemas"]["SimilarItemsRequest"]
    setClipQuery: (query: components["schemas"]["SimilarItemsRequest"]) => void
    hideMaxResults?: boolean
}) {
    const setterOptions = setters.map((setter) => ({ label: setter, value: setter }))
    return (
        <FilterContainer
            storageKey="text-similarity-filter"
            label={<span>CLIP Embeddings Options</span>}
            description={
                <span>Options for the CLIP semantic similarity search</span>
            }
        // defaultIsCollapsed
        >
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                <ComboBoxResponsive
                    options={setterOptions}
                    currentValue={clipQuery.setter_name.length > 0 ? clipQuery.setter_name : null}
                    onChangeValue={(setter_name) => setter_name ? setClipQuery({ ...clipQuery, setter_name }) : null}
                    placeholder="No CLIP Model Selected"
                />
            </div>
            {!hideMaxResults && <ConfidenceFilter
                label={<span>Max Results Displayed</span>}
                confidence={clipQuery.page_size}
                setConfidence={(value) => setClipQuery({ ...clipQuery, page_size: value })}
                description={<span>'0' disables this similarity query</span>}
                min={0}
                max={50}
                step={1}
            />}
            <AggregationOptions textEmbeddingQuery={clipQuery} setTextEmbeddingQuery={setClipQuery} />
            <CrossModalOptions clipEmbeddingQuery={clipQuery} setCLIPEmbeddingQuery={setClipQuery} />
        </FilterContainer>
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
        // defaultIsCollapsed
        >
            <SwitchFilter
                label="Enable Cross Modal"
                description="Enables cross modal similarity search"
                value={clipEmbeddingQuery.clip_xmodal}
                onChange={(value) => setCLIPEmbeddingQuery({ ...clipEmbeddingQuery, clip_xmodal: value })}
            />
            <SwitchFilter
                label="Text to Text"
                description="Compare text embeddings to text embeddings"
                value={clipEmbeddingQuery.xmodal_t2t}
                onChange={(value) => setCLIPEmbeddingQuery({ ...clipEmbeddingQuery, xmodal_t2t: value })}
            />
            <SwitchFilter
                label="Image to Image"
                description="Compare image embeddings to image embeddings"
                value={clipEmbeddingQuery.xmodal_i2i}
                onChange={(value) => setCLIPEmbeddingQuery({ ...clipEmbeddingQuery, xmodal_i2i: value })}
            />
            {clipEmbeddingQuery.src_text && clipEmbeddingQuery.clip_xmodal && <SourceTextFilter textFilters={clipEmbeddingQuery.src_text} setTextFilters={(filter) => setCLIPEmbeddingQuery({
                ...clipEmbeddingQuery, src_text: filter
            })} />}
        </FilterContainer>
    )
}