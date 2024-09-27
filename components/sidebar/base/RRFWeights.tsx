import { FilterContainer } from "./FilterContainer"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { components } from "@/lib/panoptikon"
import { SetFn } from "@/lib/state/searchQuery/clientHooks"

export function RRFParams({
    rrf,
    setRrf,
}: {
    rrf: components["schemas"]["RRF"]
    setRrf: SetFn<components["schemas"]["RRF"]>
}) {
    return (
        <FilterContainer
            storageKey="rrf"
            label={<span>Reciprocal Rank Fusion</span>}
            description={
                <span>Used when &gt;1 flex filters are enabled</span>
            }
        >
            <ConfidenceFilter
                label={<span>Weight</span>}
                confidence={rrf.weight || 0}
                setConfidence={(value) => setRrf({ weight: value })}
                description={<span>Influence of this filter on the results</span>}
                min={0}
                max={16}
                step={0.1}
            />
            <ConfidenceFilter
                label={<span>Smoothing Factor K</span>}
                confidence={rrf.k || 0}
                setConfidence={(value) => setRrf({ k: value })}
                description={<span>Reduces the impact of individual top results</span>}
                min={0}
                max={16}
                step={0.1}
            />
        </FilterContainer>
    )
}