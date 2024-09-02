import { useSelectedDBs } from "@/lib/state/database";
import { CLIPSimilarityFilter } from "./ClipSimilarItems";
import { $api } from "@/lib/api";
import { useImageSimilarity } from "@/lib/state/similarityStore";
import { components } from "@/lib/panoptikon";
import { useSimilarityQuery } from "@/lib/state/similarityQuery";
import { TextEmbeddingsSimilarityFilter } from "./TextSimilarItems";

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