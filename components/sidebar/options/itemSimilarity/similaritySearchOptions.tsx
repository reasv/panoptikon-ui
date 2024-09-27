import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { SetFn } from "@/lib/state/searchQuery/clientHooks"
import { KeymapComponents } from "@/lib/state/searchQuery/searchQueryKeyMaps"
import { ComboBoxResponsive } from "@/components/combobox"
import { SrcTextFilter } from "../../base/SrcTextFilter"
import { FilterContainer } from "../../base/FilterContainer"
import { SwitchFilter } from "../../base/SwitchFilter"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export function ItemSimilaritySearch({
    enable,
    setEnable,
    filter,
    setFilter,
    srcFilter,
    setSrcFilter,
    children,
}: {
    enable: boolean,
    setEnable: (value: boolean) => void,
    filter: KeymapComponents["ItemSimilarity"],
    setFilter: SetFn<KeymapComponents["ItemSimilarity"]>
    srcFilter: KeymapComponents["ItemSimilarityTextSource"],
    setSrcFilter: SetFn<KeymapComponents["ItemSimilarityTextSource"]>
    children?: React.ReactNode
}) {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        }
    })
    const embeddingType = filter.distance_function === "L2" ? "text-embedding" : "clip"
    const models = [...(
        data?.setters
            .filter((setter) => setter[0] === embeddingType)
            .map((setter) => ({ value: setter[1], label: setter[1] })) || [])
    ]
    const onOptionSelected = (option: string | null) => {
        if (option === null) {
            return
        }
        if (option === "MIN") {
            setFilter({ distance_aggregation: "MIN" })
        } else if (option === "MAX") {
            setFilter({ distance_aggregation: "MAX" })
        } else if (option === "AVG") {
            setFilter({ distance_aggregation: "AVG" })
        }
    }

    const textOptions = (embeddingType === "text-embedding") || (embeddingType === "clip" && filter.clip_xmodal)
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Similarity Search Options
                    </Label>
                    <div className="text-gray-400">
                        Find items similar to a target item
                    </div>
                </div>
                <Switch checked={enable} onCheckedChange={(value) => setEnable(value)} />
            </div>
            {children}
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-left">
                <ComboBoxResponsive
                    options={models}
                    currentValue={filter.model}
                    onChangeValue={(value) => setFilter({ model: value })}
                    placeholder="Model..."
                />
            </div>
            <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-left">
                <ComboBoxResponsive
                    options={[
                        { value: "MIN", label: "MIN" },
                        { value: "MAX", label: "MAX" },
                        { value: "AVG", label: "AVG" },
                    ]}
                    currentValue={filter.distance_aggregation}
                    onChangeValue={onOptionSelected}
                    placeholder="Distance Aggregation..."
                />
            </div>
            {embeddingType === "clip" &&
                <FilterContainer
                    storageKey="search-cross-modal-options"
                    label={<span>Cross Modal Similarity</span>}
                    description={
                        <span>Compare text and image embeddings together</span>
                    }
                >
                    <SwitchFilter
                        label="Enable Cross Modal"
                        description="Enables cross modal similarity search"
                        value={filter.clip_xmodal}
                        onChange={(value) => setFilter({ clip_xmodal: value })}
                    />
                    <SwitchFilter
                        label="Text to Text"
                        description="Compare text embeddings to text embeddings"
                        value={filter.xmodal_t2t}
                        onChange={(value) => setFilter({ xmodal_t2t: value })}
                    />
                    <SwitchFilter
                        label="Image to Image"
                        description="Compare image embeddings to image embeddings"
                        value={filter.xmodal_i2i}
                        onChange={(value) => setFilter({ xmodal_i2i: value })}
                    />
                </FilterContainer>
            }
            {textOptions &&
                <SrcTextFilter
                    storageKey="similarityTextSourceFilter"
                    filter={srcFilter}
                    setFilter={setSrcFilter}
                />}
        </div>
    )
}