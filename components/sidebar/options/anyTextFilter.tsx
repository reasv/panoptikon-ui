import { Label } from "../../ui/label"
import { Input } from "../../ui/input"
import { FilterContainer } from "../base/FilterContainer"
import { useATMatchText, useATMatchPath, useQueryOptions, useATSemanticImage, useATSemanticText, useATSemanticTextSrc } from "@/lib/state/searchQuery/clientHooks"
import { PathFilter } from "../base/PathTextFilter"
import { TextFilter } from "../base/TextFilter"
import { ImageEmbeddingSearch } from "../base/ImageEmbeddingsSearch"
import { TextEmbeddingSearch } from "../base/TextEmbeddingSearch"

export function AnyTextFilter() {
    const [options, _] = useQueryOptions()
    return (
        <FilterContainer
            storageKey="flexibleSearchContainer" // Add a storageKey prop to make the localStorage key unique
            label={<span>Flexible Search</span>}
            description={
                <span>Returns items that match any of these filters</span>
            }
        >
            <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
                <div className="flex flex-row items-center justify-between">
                    <div className="space-y-0.5">
                        <Label className="text-base">
                            Main Query
                        </Label>
                        <div className="text-gray-400">
                            The text query passed to all the Flexible Search filters
                        </div>
                    </div>
                </div>
                <div className="flex flex-row items-center space-x-2 mt-3 w-full justify-left">
                    <Input
                        type="text"
                        placeholder="Type your query in the main search bar"
                        value={options.at_query}
                        className="flex-grow"
                        disabled
                    />
                </div>
            </div>
            <AnyTextPathFilter />
            <AnyTextETFilter />
            <AnyTextImageEmbeddingSearch />
            <AnyTextSemanticTextSearch />
        </FilterContainer>
    )
}

function AnyTextPathFilter() {
    const [filter, setFilter] = useATMatchPath()
    const [options, setOptions] = useQueryOptions()

    return (
        <PathFilter
            enable={options.at_e_path}
            setEnable={(value) => setOptions({ at_e_path: value })}
            filter={filter}
            setFilter={setFilter}
        />
    )
}

function AnyTextETFilter() {
    const [options, setOptions] = useQueryOptions()
    const [filter, setFilter] = useATMatchText()

    return <TextFilter
        enable={options.at_e_txt}
        setEnable={(value) => setOptions({ at_e_txt: value })}
        filter={filter}
        setFilter={setFilter}
    />
}

function AnyTextImageEmbeddingSearch() {
    const [filter, setFilter] = useATSemanticImage()
    const [options, setOptions] = useQueryOptions()

    return (
        <ImageEmbeddingSearch
            enable={options.at_e_si}
            setEnable={(value) => setOptions({ at_e_si: value })}
            filter={filter}
            setFilter={setFilter}
        />
    )
}

function AnyTextSemanticTextSearch() {
    const [filter, setFilter] = useATSemanticText()
    const [srcFilter, setSrcFilter] = useATSemanticTextSrc()
    const [options, setOptions] = useQueryOptions()

    return (
        <TextEmbeddingSearch
            enable={options.at_e_st}
            setEnable={(value) => setOptions({ at_e_st: value })}
            filter={filter}
            setFilter={setFilter}
            srcFilter={srcFilter}
            setSrcFilter={setSrcFilter}
        />
    )
}