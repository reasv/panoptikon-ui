
import { } from "@/lib/state/zust"
import { components } from "@/lib/panoptikon"
import { $api } from "@/lib/api"
import { keepPreviousData } from "@tanstack/react-query"
import { SearchResultImage } from "@/components/SearchResultImage"
import { useItemSelection } from "@/lib/state/itemSelection"
import { Mode, SimilarityQueryType, useSearchMode, useSimilarityQuery } from "@/lib/state/similarityQuery"
import { Gallery, useGalleryIndex, useGalleryName } from "@/lib/state/gallery"
import { useSelectedDBs } from "@/lib/state/database"

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
    const [_, setQuery] = useSimilarityQuery()

    const setSelected = useItemSelection((state) => state.setItem)
    const [name, setName] = useGalleryName()
    const [index, setIndex] = useGalleryIndex(Gallery.similarity)
    const [searchMode, setSearchmode] = useSearchMode()
    const onImageClick = (index: number) => {
        if (!data) return
        setQuery({
            is_item: sha256,
            is_model: query.setter_name,
            is_type: type,
            is_page: 1
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