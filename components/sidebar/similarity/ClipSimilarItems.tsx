import { useDatabase } from "@/lib/state/zust"
import { FilterContainer } from "../options/FilterContainer"
import { $api } from "@/lib/api"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { ComboBoxResponsive } from "@/components/combobox"
import { SimilarItemsView } from "./SimilarItemsView"
import { components } from "@/lib/panoptikon"
import { AggregationOptions, SourceTextFilter, SwitchOption } from "./CommonFilters"
import { useImageSimilarity } from "@/lib/state/similarityStore"
import { useItemSelection } from "@/lib/state/itemSelection"

export function ClipItemSimilarity() {
    const selected = useItemSelection((state) => state.getSelected())
    const dbs = useDatabase((state) => state.getDBs())
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        },
    })
    const clipSetters = data?.setters.filter((setter) => setter[0] === "clip").map((setter) => setter[1]) || []
    const clipQuery = useImageSimilarity((state) => state.getClipQuery(clipSetters[0] || ""))
    const setClipQuery = useImageSimilarity((state) => state.setClipQuery)
    return (
        <FilterContainer
            label={<span>CLIP Similarity</span>}
            description={<span>Similar items based on CLIP embeddings</span>}
            storageKey="clip-similarity"
        >
            <CLIPSimilarityFilter setters={clipSetters} clipQuery={clipQuery} setClipQuery={setClipQuery} />
            <div className="mt-4">
                {selected && clipQuery.setter_name.length > 0 && clipQuery.limit > 0 && (
                    <SimilarItemsView
                        item={selected}
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
}: {
    setters: string[]
    clipQuery: components["schemas"]["SimilarItemsRequest"]
    setClipQuery: (query: components["schemas"]["SimilarItemsRequest"]) => void
}) {
    const setterOptions = setters.map((setter) => ({ label: setter, value: setter }))
    return (
        <FilterContainer
            storageKey="text-similarity-filter"
            label={<span>CLIP Embeddings Options</span>}
            description={
                <span>Options for the CLIP semantic similarity search</span>
            }
            defaultIsCollapsed
        >
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                <ComboBoxResponsive
                    options={setterOptions}
                    currentValue={clipQuery.setter_name.length > 0 ? clipQuery.setter_name : null}
                    onChangeValue={(setter_name) => setter_name ? setClipQuery({ ...clipQuery, setter_name }) : null}
                    placeholder="No CLIP Model Selected"
                />
            </div>
            <ConfidenceFilter
                label={<span>Max Results Displayed</span>}
                confidence={clipQuery.limit}
                setConfidence={(value) => setClipQuery({ ...clipQuery, limit: value })}
                description={<span>'0' disables this similarity query</span>}
                min={0}
                max={50}
                step={1}
            />
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
            {clipEmbeddingQuery.src_text && clipEmbeddingQuery.clip_xmodal && <SourceTextFilter textFilters={clipEmbeddingQuery.src_text} setTextFilters={(filter) => setCLIPEmbeddingQuery({
                ...clipEmbeddingQuery, src_text: filter
            })} />}
        </FilterContainer>
    )
}