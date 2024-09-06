import { useSelectedDBs } from "@/lib/state/database";
import { CLIPSimilarityFilter } from "./ClipSimilarItems";
import { $api } from "@/lib/api";
import { useImageSimilarity } from "@/lib/state/similarityStore";
import { components } from "@/lib/panoptikon";
import { TextEmbeddingsSimilarityFilter } from "./TextSimilarItems";
import { Label } from "@/components/ui/label";
import { ComboBoxResponsive } from "@/components/combobox";
import { useItemSimilarityOptions, useItemSimilaritySource, useResetItemSimilarityFilter, useSimilarityQuery } from "@/lib/state/similarityQuery/clientHooks";
import { SimilarityQueryType } from "@/lib/state/similarityQuery/similarityQueryKeyMaps";
import { Button } from "@/components/ui/button";
import { Delete } from "lucide-react";

export function SimilarityModeOptionsClip() {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        },
    })
    const setters = data?.setters.filter((setter) => setter[0] === "clip").map((setter) => setter[1]) || []
    // The query in the query parameters
    const query = useSimilarityQuery()
    const [options, setQueryOptions] = useItemSimilarityOptions()
    const setSource = useItemSimilaritySource()[1]
    function onSetQuery(newQuery: components["schemas"]["SimilarItemsRequest"]) {
        const update = {
            ...{
                ...newQuery,
            },
            item: options.item,
            type: SimilarityQueryType.clip,
        }
        setQueryOptions(update)
        if (newQuery.src_text) {
            setSource(newQuery.src_text)
        }
    }
    return (
        <CLIPSimilarityFilter
            hideMaxResults={true}
            setters={setters}
            clipQuery={query}
            setClipQuery={onSetQuery}
        />
    )
}

export function SimilarityModeOptionsText() {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        },
    })
    const setters = data?.setters.filter((setter) => setter[0] === "text-embedding").map((setter) => setter[1]) || []
    // The query in the query parameters
    const query = useSimilarityQuery()
    const [options, setQueryOptions] = useItemSimilarityOptions()
    const setSource = useItemSimilaritySource()[1]
    function onSetQuery(newQuery: components["schemas"]["SimilarItemsRequest"]) {
        setQueryOptions({
            ...{
                ...newQuery,
                src_text: undefined
            },
            item: options.item,
            type: SimilarityQueryType.textEmbedding,
        })
        if (newQuery.src_text) {
            setSource(newQuery.src_text)
        }
    }
    return (
        <TextEmbeddingsSimilarityFilter
            hideMaxResults={true}
            setters={setters}
            setTextEmbeddingQuery={onSetQuery}
            textEmbeddingQuery={query}
        />
    )
}

export function SimilarityModeSwitch() {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        },
    })
    const textSetters = data?.setters.filter((setter) => setter[0] === "text-embedding").map((setter) => setter[1]) || []
    const clipSetters = data?.setters.filter((setter) => setter[0] === "clip").map((setter) => setter[1]) || []
    const [options, setQueryOptions] = useItemSimilarityOptions()
    function switchMode() {
        if (options.type === SimilarityQueryType.clip) {
            setQueryOptions({
                type: SimilarityQueryType.textEmbedding,
                page: 1,
                setter_name: textSetters[0],
                clip_xmodal: null,
            })
        } else {
            setQueryOptions({
                type: SimilarityQueryType.clip,
                page: 1,
                setter_name: clipSetters[0],
                clip_xmodal: null,
            })
        }
    }
    function onSelectMode(mode: string | null) {
        // check if the mode is already selected
        if (mode === options.type) {
            return
        }
        switchMode()
    }
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Switch Mode
                    </Label>
                    <div className="text-gray-400">
                        Switch between CLIP and Text Embeddings Search
                    </div>
                </div>
            </div>
            <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-left">
                <ComboBoxResponsive
                    options={[{
                        value: SimilarityQueryType.clip,
                        label: "CLIP"
                    }, {
                        value: SimilarityQueryType.textEmbedding,
                        label: "Text Embeddings"
                    }]}
                    currentValue={options.type}
                    onChangeValue={onSelectMode}
                    placeholder="Select order by"
                />
            </div>
        </div>

    )
}


export function ResetSimilarityFilters() {
    const resetFilters = useResetItemSimilarityFilter()
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <div className="text-base font-medium">Reset Similarity Options</div>
                    <div className="text-gray-400">Reset all options for similarity search</div>
                </div>
                <Button
                    title="Clear all similarity filters"
                    variant="ghost"
                    size="icon"
                    onClick={() => resetFilters()}
                >
                    <Delete
                        className="h-4 w-4"
                    />
                </Button>
            </div>
        </div>
    )
}