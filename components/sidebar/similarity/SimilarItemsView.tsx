
import { components } from "@/lib/panoptikon"
import { $api } from "@/lib/api"
import { keepPreviousData } from "@tanstack/react-query"
import { SearchResultImage } from "@/components/SearchResultImage"
import { useItemSelection } from "@/lib/state/itemSelection"
import { Gallery, useGalleryIndex, useGalleryName } from "@/lib/state/gallery"
import { useSelectedDBs } from "@/lib/state/database"
import { Mode, useSearchMode } from "@/lib/state/searchMode"
import { useItemSimilarityOptions, useItemSimilaritySource } from "@/lib/state/similarityQuery/clientHooks"
import { SimilarityQueryType } from "@/lib/state/similarityQuery/similarityQueryKeyMaps"

export function SimilarItemsView({
    sha256,
    query,
    type,
}: {
    sha256: string
    query: components["schemas"]["SimilarItemsRequest"]
    type: SimilarityQueryType
}) {
    const [dbs, ___] = useSelectedDBs()
    const { data, isLoading, isFetching } = $api.useQuery("post", "/api/search/similar/{sha256}", {
        params: {
            query: {
                ...dbs
            },
            path: {
                sha256: sha256,
            }
        },
        body: query
    }, {
        placeholderData: keepPreviousData
    })

    const [options, setOptions] = useItemSimilarityOptions()
    const [source, setSource] = useItemSimilaritySource()

    const setSelected = useItemSelection((state) => state.setItem)
    const [name, setName] = useGalleryName()
    const [index, setIndex] = useGalleryIndex(Gallery.similarity)
    const [searchMode, setSearchmode] = useSearchMode()
    const onImageClick = (index: number) => {
        if (!data) return
        setOptions({
            ...{
                ...query,
                src_text: undefined,
                full_count: true,
            },
            item: sha256,
            page: 1,
            type: type,
        }, {
            history: "push",
        })
        setSource({
            ...query.src_text,
        }, {
            history: "push",
        })
        setName(Gallery.similarity)
        setSearchmode(Mode.ItemSimilarity)
        setIndex(index)
        setSelected(data.results[index])
    }
    return (
        <div className="mt-4">
            {data && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 4xl:grid-cols-2 5xl:grid-cols-2 gap-4">
                    {data.results.map((result, index) => (
                        <SearchResultImage
                            key={index}
                            result={result}
                            index={index}
                            dbs={dbs}
                            imageContainerClassName="h-96 xl:h-80 4xl:h-80 5xl:h-80"
                            onImageClick={() => onImageClick(index)}
                            showLoadingSpinner={isLoading || isFetching}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}