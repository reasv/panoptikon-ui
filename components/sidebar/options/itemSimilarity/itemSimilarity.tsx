import { useItemSimilaritySearch, useItemSimilarityTextSource, useQueryOptions } from "@/lib/state/searchQuery/clientHooks"
import { FilterContainer } from "../../base/FilterContainer"
import { Label } from "@radix-ui/react-label"
import { Input } from "postcss"
import { ItemSimilaritySearch } from "./similaritySearchOptions"
import { ComboBoxResponsive } from "@/components/combobox"
import { SimilarityTarget } from "./similarityTarget"
import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"


export function ItemSimilarityWrapper() {
    const [options, setOptions] = useQueryOptions()
    const [filter, setFilter] = useItemSimilaritySearch()
    const [srcFilter, setSrcFilter] = useItemSimilarityTextSource()
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        }
    })

    const onDistanceFunctionSelected = (option: string | null) => {
        if (option === null) {
            return
        }
        const models = [...(
            data?.setters
                .filter((setter) => setter[0] === (option === "L2" ? "text-embedding" : "clip"))
                .map((setter) => ({ value: setter[1], label: setter[1] })) || [])
        ]
        const model = models.length > 0 ? models[0].value : ""
        if (option === "L2") {
            setFilter({ distance_function: "L2", model }, { history: "push" })
        } else if (option === "COSINE") {
            setFilter({ distance_function: "COSINE", model }, { history: "push" })
        }
    }
    return (
        <FilterContainer
            storageKey="itemSimilarityFilterContainer" // Add a storageKey prop to make the localStorage key unique
            label={<span>Similarity Search</span>}
            description={
                <span>Find items similar to a target item</span>
            }
        >
            <ItemSimilaritySearch
                enable={options.e_iss}
                setEnable={(value) => setOptions({ e_iss: value })}
                filter={filter}
                setFilter={setFilter}
                srcFilter={srcFilter}
                setSrcFilter={setSrcFilter}
                children={
                    <>
                        <SimilarityTarget />
                        <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-left">
                            <ComboBoxResponsive
                                options={[
                                    { value: "L2", label: "Text Embeddings" },
                                    { value: "COSINE", label: "Clip Embeddings" },
                                ]}
                                currentValue={filter.distance_function}
                                onChangeValue={onDistanceFunctionSelected}
                                placeholder="Embedding Type..."
                            />
                        </div>
                    </>
                }
            />

        </FilterContainer>
    )
}
