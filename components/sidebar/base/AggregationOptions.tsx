import { FilterContainer } from "../base/FilterContainer"
import { $api } from "@/lib/api"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { ComboBoxResponsive } from "@/components/combobox"
import { MultiBoxResponsive } from "@/components/multiCombobox"
import { components } from "@/lib/panoptikon"
import { useSelectedDBs } from "@/lib/state/database"

export function AggregationOptions({
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
        // defaultIsCollapsed
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
