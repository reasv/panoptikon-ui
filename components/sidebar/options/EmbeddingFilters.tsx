
import { useQueryOptions, useSemanticImageSearch, useSemanticTextSearch, useSemanticTextSource } from "@/lib/state/searchQuery/clientHooks"
import { TextEmbeddingSearch } from "../base/TextEmbeddingSearch"
import { Input } from "@/components/ui/input"
import { ImageEmbeddingSearch } from "../base/ImageEmbeddingsSearch"

export function TextEmbSearch() {
    const [filter, setFilter] = useSemanticTextSearch()
    const [srcFilter, setSrcFilter] = useSemanticTextSource()
    const [options, setOptions] = useQueryOptions()
    return (
        <TextEmbeddingSearch
            enable={options.e_temb}
            setEnable={(value) => setOptions({ e_temb: value })}
            filter={filter}
            setFilter={setFilter}
            srcFilter={srcFilter}
            setSrcFilter={setSrcFilter}
            children={
                <Input
                    type="text"
                    placeholder={"Semantic Text Search"}
                    value={filter.query}
                    onChange={(e) => setFilter({ query: e.target.value })}
                    className="flex-grow"
                />
            }
        />
    )
}

export function ImgEmbSearch() {
    const [filter, setFilter] = useSemanticImageSearch()
    const [options, setOptions] = useQueryOptions()
    return (
        <ImageEmbeddingSearch
            enable={options.e_iemb}
            setEnable={(value) => setOptions({ e_iemb: value })}
            filter={filter}
            setFilter={setFilter}
            children={
                <Input
                    type="text"
                    placeholder={"Semantic Image Search"}
                    value={filter.query}
                    onChange={(e) => setFilter({ query: e.target.value })}
                    className="flex-grow"
                />
            }
        />
    )
}