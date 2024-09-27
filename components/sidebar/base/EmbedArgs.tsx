import { FilterContainer } from "./FilterContainer"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { components } from "@/lib/panoptikon"
import { SetFn } from "@/lib/state/searchQuery/clientHooks"

export function EmbedArgs({
    embedArgs,
    setEmbedArgs,
}: {
    embedArgs: components["schemas"]["EmbedArgs"]
    setEmbedArgs: SetFn<components["schemas"]["EmbedArgs"]>
}) {
    return (
        <FilterContainer
            storageKey="embed-args"
            label={<span>Model Cache Settings</span>}
            description={
                <span>Controls how long embedding models are kept in memory</span>
            }
        >
            <ConfidenceFilter
                label={<span>Model Cache LRU Size</span>}
                confidence={embedArgs.lru_size || 0}
                setConfidence={(value) => setEmbedArgs({ lru_size: value })}
                description={<span>Max # of models to keep loaded at a time</span>}
                min={0}
                max={16}
                step={0.1}
            />
            <ConfidenceFilter
                label={<span>Model TTL (Seconds)</span>}
                confidence={embedArgs.ttl_seconds || 0}
                setConfidence={(value) => setEmbedArgs({ ttl_seconds: value })}
                description={<span>Keep a model loaded for this long after its last use</span>}
                min={-1}
                max={6000}
                step={20}
            />
        </FilterContainer>
    )
}