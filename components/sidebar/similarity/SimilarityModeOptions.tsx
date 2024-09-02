import { useSelectedDBs } from "@/lib/state/database";
import { CLIPSimilarityFilter } from "./ClipSimilarItems";
import { $api } from "@/lib/api";
import { useImageSimilarity } from "@/lib/state/similarityStore";
import { components } from "@/lib/panoptikon";
import { SimilarityQueryType, useSimilarityQuery } from "@/lib/state/similarityQuery";
import { TextEmbeddingsSimilarityFilter } from "./TextSimilarItems";
import { Label } from "@/components/ui/label";
import { ComboBoxResponsive } from "@/components/combobox";

export function SimilarityModeOptionsClip() {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/search/stats", {
        params: {
            query: dbs
        },
    })
    const clipSetters = data?.setters.filter((setter) => setter[0] === "clip").map((setter) => setter[1]) || []
    // The query in localstorage
    const clipQuery = useImageSimilarity((state) => state.getClipQuery(clipSetters[0] || ""))
    const setClipQuery = useImageSimilarity((state) => state.setClipQuery)
    // The query in the query parameters
    const [query, setQuery] = useSimilarityQuery()
    function onSetClipQuery(newQuery: components["schemas"]["SimilarItemsRequest"]) {
        setClipQuery({
            ...newQuery,
            setter_name: clipQuery.setter_name
        })
        setQuery({
            is_model: newQuery.setter_name
        })
    }
    const modeQuery: components["schemas"]["SimilarItemsRequest"] = {
        ...clipQuery,
        setter_name: query.is_model!
    }
    return (
        <CLIPSimilarityFilter
            hideMaxResults={true}
            setters={clipSetters}
            clipQuery={clipQuery}
            setClipQuery={onSetClipQuery}
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
    const textEmbeddingQuery = useImageSimilarity((state) => state.getTextEmbedQuery(setters[0] || ""))
    const setTextEmbeddingQuery = useImageSimilarity((state) => state.setTextEmbedQuery)
    const [query, setQuery] = useSimilarityQuery()
    function onSetTextEmbeddingQuery(newQuery: components["schemas"]["SimilarItemsRequest"]) {
        setTextEmbeddingQuery({
            ...newQuery,
            setter_name: textEmbeddingQuery.setter_name
        })
        setQuery({
            is_model: newQuery.setter_name
        })
    }
    const modeQuery: components["schemas"]["SimilarItemsRequest"] = {
        ...textEmbeddingQuery,
        setter_name: query.is_model!
    }
    return (
        <TextEmbeddingsSimilarityFilter
            setters={setters}
            setTextEmbeddingQuery={onSetTextEmbeddingQuery}
            textEmbeddingQuery={modeQuery}
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
    const textEmbeddingQuery = useImageSimilarity((state) => state.getTextEmbedQuery(textSetters[0] || ""))
    const clipSetters = data?.setters.filter((setter) => setter[0] === "clip").map((setter) => setter[1]) || []
    const clipQuery = useImageSimilarity((state) => state.getClipQuery(clipSetters[0] || ""))
    const [query, setQuery] = useSimilarityQuery()

    function switchMode() {
        if (query.is_type === SimilarityQueryType.clip) {
            setQuery({
                is_type: SimilarityQueryType.textEmbedding,
                is_page: 1,
                is_model: textEmbeddingQuery.setter_name
            })
        } else {
            setQuery({
                is_type: SimilarityQueryType.clip,
                is_page: 1,
                is_model: clipQuery.setter_name
            })
        }
    }
    function onSelectMode(mode: string | null) {
        // check if the mode is already selected
        if (mode === query.is_type) {
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
                    currentValue={query.is_type}
                    onChangeValue={onSelectMode}
                    placeholder="Select order by"
                />
            </div>
        </div>

    )
}