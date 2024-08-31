
import { useDatabase } from "@/lib/zust"
import { components } from "@/lib/panoptikon"
import { $api } from "@/lib/api"
import { keepPreviousData } from "@tanstack/react-query"
import { SearchResultImage } from "@/components/SearchResultImage"
import { useItemSelection } from "@/lib/itemSelection"

export function SimilarItemsView({
    item,
    query,
}: {
    item: components["schemas"]["FileSearchResult"]
    query: components["schemas"]["SimilarItemsRequest"]
}) {
    const dbs = useDatabase((state) => state.getDBs())
    const { data } = $api.useQuery("post", "/api/search/similar/{sha256}", {
        params: {
            query: {
                ...dbs
            },
            path: {
                sha256: item.sha256,
            }
        },
        body: query
    }, {
        placeholderData: keepPreviousData
    })
    const setSelected = useItemSelection((state) => state.setItem)
    const onImageClick = (index: number) => {
        if (!data) return
        const item = data.results[index]
        setSelected(item)
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