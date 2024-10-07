import { $api } from "@/lib/api"
import { Label } from "../../ui/label"
import { Switch } from "../../ui/switch"
import { useSelectedDBs } from "@/lib/state/database"
import { SetFn, useEmbedArgs } from "@/lib/state/searchQuery/clientHooks"
import { KeymapComponents } from "@/lib/state/searchQuery/searchQueryKeyMaps"
import { ComboBoxResponsive } from "@/components/combobox"
import { SrcTextFilter } from "./SrcTextFilter"
import { useState } from "react"
import { splitByFirstSlash } from "@/components/SearchTypeSelector"
import { LoaderCircle } from "lucide-react"

export function TextEmbeddingSearch({
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
    filter: KeymapComponents["ATSemanticText"],
    setFilter: SetFn<KeymapComponents["ATSemanticText"]>
    srcFilter: KeymapComponents["ATSourceText"],
    setSrcFilter: SetFn<KeymapComponents["ATSourceText"]>
    children?: React.ReactNode
}) {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        }
    })
    const models = [...(
        data?.setters
            .filter((setter) => setter[0] === "text-embedding")
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
    const [embedArgs, setEmbedArgs] = useEmbedArgs()
    const loadModel = $api.useMutation(
        "put",
        "/api/inference/load/{group}/{inference_id}",
        {
            onMutate: async () => {
                setIsLoading(true)
            },
            onSettled: () => {
                setIsLoading(false)
                setEnable(true)
            },
        }
    )
    const [isLoading, setIsLoading] = useState(false)
    const onEnableChange = (value: boolean) => {
        if (models.length === 0) {
            return
        }
        let currentModel = filter.model
        if (filter.model.length === 0) {
            setFilter({ model: models[0].value })
            currentModel = models[0].value
        }
        if (value && currentModel.length > 0) {
            loadModel.mutate({
                params: {
                    path: {
                        group: splitByFirstSlash(currentModel)[0],
                        inference_id: splitByFirstSlash(currentModel)[1]
                    },
                    query: {
                        ...embedArgs
                    }
                }
            })
        } else {
            setEnable(value)
        }
    }
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Semantic Text Search
                    </Label>
                    <div className="text-gray-400">
                        Searches for similar text in the database
                    </div>
                </div>
                {isLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Switch
                    checked={enable}
                    onCheckedChange={(value) => onEnableChange(value)}
                />}
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
            <SrcTextFilter
                storageKey="textembeddingsource"
                filter={srcFilter}
                setFilter={setSrcFilter}
            />
        </div>
    )
}