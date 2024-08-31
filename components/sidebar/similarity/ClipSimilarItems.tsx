import { useDatabase, useImageSimilarity, useItemSelection } from "@/lib/zust"
import { FilterContainer } from "../options/FilterContainer"
import { $api } from "@/lib/api"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { ComboBoxResponsive } from "@/components/combobox"
import { SimilarItemsView } from "./SimilarItemsView"

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

