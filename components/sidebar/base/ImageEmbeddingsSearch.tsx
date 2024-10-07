import { Label } from "../../ui/label"
import { Switch } from "../../ui/switch"
import { ComboBoxResponsive } from "../../combobox"
import { SetFn, useEmbedArgs } from "@/lib/state/searchQuery/clientHooks"
import { KeymapComponents } from "@/lib/state/searchQuery/searchQueryKeyMaps"
import { useSelectedDBs } from "@/lib/state/database"
import { $api } from "@/lib/api"
import { splitByFirstSlash } from "@/components/SearchTypeSelector"
import { useState } from "react"
import { LoaderCircle } from "lucide-react"

export function ImageEmbeddingSearch({
    enable,
    setEnable,
    filter,
    setFilter,
    children,
}: {
    enable: boolean,
    setEnable: (value: boolean) => void,
    filter: KeymapComponents["ATSemanticImage"],
    setFilter: SetFn<KeymapComponents["ATSemanticImage"]>
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
            .filter((setter) => setter[0] === "clip")
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
    const [isLoading, setIsLoading] = useState(false)
    const loadModel = $api.useMutation(
        "put",
        "/api/inference/load/{group}/{inference_id}",
        {
            onSettled: (data, error, variables, context) => {
                setIsLoading(false)
            },
        }
    )
    const onEnableChange = async (value: boolean) => {
        if (models.length === 0) {
            return
        }
        let currentModel = filter.model
        if (filter.model.length === 0) {
            setFilter({ model: models[0].value })
            currentModel = models[0].value
        }
        if (value && currentModel.length > 0) {
            setIsLoading(true)
            await loadModel.mutateAsync({
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
        }
        setEnable(value)
    }
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Semantic Image Search
                    </Label>
                    <div className="text-gray-400">
                        Searches the semantic content of images
                    </div>
                </div>
                {isLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    : <Switch checked={enable} onCheckedChange={(value) => onEnableChange(value)} />}
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
        </div>
    )
}
