import { useMemo, useState } from "react"
import { useATSemanticImage, useATSemanticText, useEmbedArgs, useQueryOptions } from "@/lib/state/searchQuery/clientHooks"
import { MultiBoxResponsive } from "./multiCombobox"
import { GlassWater, LoaderCircle, ScanSearch } from "lucide-react"
import { Toggle } from "./ui/toggle"
import { useSelectedDBs } from "@/lib/state/database"
import { $api } from "@/lib/api"
function splitByFirstSlash(input: string): [string, string] {
    const index = input.indexOf('/');
    if (index === -1) {
        return [input, ''];
    }

    const part1 = input.substring(0, index);
    const part2 = input.substring(index + 1);

    return [part1, part2];
}
export function SearchTypeSelection() {
    const [options, setOptions] = useQueryOptions()
    const [embedArgs, setEmbedArgs] = useEmbedArgs()
    const dbs = useSelectedDBs()[0]
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        }
    })
    const [iembFilter, setIembFilter] = useATSemanticImage()
    const iembModels = [...
        data?.setters
            .filter((setter) => setter[0] === "clip")
            .map((setter) => setter[1]) || []
    ]
    const [tembFilter, setTembFilter] = useATSemanticText()
    const tembModels = [...
        data?.setters
            .filter((setter) => setter[0] === "text-embedding")
            .map((setter) => setter[1]) || []
    ]
    const [iembLoading, setIembLoading] = useState(false)
    const [tembLoading, setTembLoading] = useState(false)
    const loadModel = $api.useMutation("put", "/api/inference/load/{group}/{inference_id}")
    const onSelectionChange = async (selectedOptions: string[]) => {
        setOptions({
            at_e_path: selectedOptions.includes("path"),
            at_e_txt: selectedOptions.includes("fts"),
        })
        if (selectedOptions.includes("iemb")) {
            let currentModel = iembFilter.model
            if (
                iembFilter.model.length === 0
                && iembModels.length > 0
            ) {
                setIembFilter({
                    model: iembModels[0]
                })
                currentModel = iembModels[0]
            }
            if (currentModel.length > 0) {
                setIembLoading(true)
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
                setIembLoading(false)
            }
        }
        setOptions({
            at_e_si: selectedOptions.includes("iemb"),
        })
        if (selectedOptions.includes("temb")) {
            let currentModel = tembFilter.model
            if (
                tembFilter.model.length === 0
                && tembModels.length > 0
            ) {
                setTembFilter({
                    model: tembModels[0]
                })
                currentModel = tembModels[0]
            }
            if (currentModel.length > 0) {
                setTembLoading(true)
                await loadModel.mutateAsync({
                    params: {
                        path: {
                            group: splitByFirstSlash(tembFilter.model)[0],
                            inference_id: splitByFirstSlash(tembFilter.model)[1]
                        },
                        query: {
                            ...embedArgs
                        }
                    }
                })
                setTembLoading(false)
            }
        }
        setOptions({
            at_e_st: selectedOptions.includes("temb"),
        })
    }

    const allOptions = [
        {
            label: "File Path",
            value: "path",
        },
        {
            label: "Full Text",
            value: "fts",
        },
        {
            label: "Semantic Image Search",
            value: "iemb",
            icon: iembLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : undefined,
        },
        {
            label: "Semantic Text Search",
            value: "temb",
            icon: tembLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : undefined,
        },
    ]
    const selectedOptions = useMemo(() => {
        let selected = []
        if (options.at_e_path) {
            selected.push("path")
        }
        if (options.at_e_txt) {
            selected.push("fts")
        }
        if (options.at_e_si) {
            selected.push("iemb")
        }
        if (options.at_e_st) {
            selected.push("temb")
        }
        return selected
    }, [options])
    const [open, setOpen] = useState(false)
    return <MultiBoxResponsive
        options={allOptions}
        currentValues={selectedOptions}
        onSelectionChange={onSelectionChange}
        placeholder="Select an option"
        maxDisplayed={1}
        isOpen={open}
        onOpenChange={setOpen}
        button={
            <Toggle
                pressed={true}
                title={"Toggle search types"}
                aria-label="Toggle search types">
                <ScanSearch className="h-4 w-4" />
            </Toggle>
        }
    />
}