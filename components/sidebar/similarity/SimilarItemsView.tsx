
import { useDatabase } from "@/lib/state/zust"
import { components } from "@/lib/panoptikon"
import { $api } from "@/lib/api"
import { keepPreviousData } from "@tanstack/react-query"
import { SearchResultImage } from "@/components/SearchResultImage"
import { useItemSelection } from "@/lib/state/itemSelection"
import { useSimilarityQuery } from "@/lib/state/similarityQuery"
import { Gallery, useGalleryIndex, useGalleryName } from "@/lib/state/gallery"

export function SimilarItemsView({
    sha256,
    query,
    type,
}: {
    sha256: string
    query: components["schemas"]["SimilarItemsRequest"]
    type: "clip" | "text-embedding"
}) {
    const dbs = useDatabase((state) => state.getDBs())
    const { data } = $api.useQuery("post", "/api/search/similar/{sha256}", {
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
    const {
        values,
        pushState,
        replaceState,
        resetPush,
        resetReplace,
        createQueryString,
    } = useSimilarityQuery()

    const setSelected = useItemSelection((state) => state.setItem)
    const [name, setName] = useGalleryName()
    const [index, setIndex] = useGalleryIndex(Gallery.similarity)
    const onImageClick = (index: number) => {
        if (!data) return
        pushState((state) => {
            state.item = sha256
            state.type = type
            state.model = query.setter_name
            state.page = 1
        })
        setName(Gallery.similarity)
        setIndex(index)
        setSelected(data.results[index])

    }
    return (
        <div className="mt-4">
            {data && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 4xl:grid-cols-2 5xl:grid-cols-2 gap-4">
                    {data.results.map((result, index) => (
                        <SearchResultImage key={index} result={result} index={index} dbs={dbs} imageContainerClassName="h-96 xl:h-80 4xl:h-80 5xl:h-80" onImageClick={() => onImageClick(index)} />
                    ))}
                </div>
            )}
        </div>
    )
}