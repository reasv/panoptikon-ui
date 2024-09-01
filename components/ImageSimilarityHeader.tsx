import { RefreshCw, LogOut } from "lucide-react";
import { Button } from "./ui/button";
import { $api } from "@/lib/api";
import { useSelectedDBs } from "@/lib/state/database";
import { Mode, SimilarityQueryType, useSearchMode, useSimilarityQuery } from "@/lib/state/similarityQuery";
import { FilePathComponent } from "./imageButtons";
import { useItemSelection } from "@/lib/state/itemSelection";
import { Gallery, useGalleryIndex, useGalleryName } from "@/lib/state/gallery";

export function ImageSimilarityHeader() {
    const [dbs, ___] = useSelectedDBs()
    const [query, setQuery] = useSimilarityQuery()
    const { data, refetch, isFetching, isError, error } = $api.useQuery(
        "get",
        "/api/items/item/{sha256}",
        {
            params: {
                query: {
                    ...dbs,
                },
                path: {
                    sha256: query.is_item || "",
                },
            },
        }
    )
    const path = data?.files[0]?.path
    const [name, setName] = useGalleryName()
    const [index, setIndex] = useGalleryIndex(Gallery.similarity)
    const [searchMode, setSearchmode] = useSearchMode()
    const onExitClick = () => {
        if (!data) return
        setQuery({
            is_item: null,
            is_model: null,
            is_type: SimilarityQueryType.clip,
            is_page: 1
        })
        setName(Gallery.search)
        setSearchmode(Mode.Search)
        setIndex(0)
    }
    return (
        <div className="relative w-full flex items-center">
            <Button onClick={onExitClick} title="Leave Item Similarity Search" variant="ghost" size="icon" className="mr-2">
                <LogOut className="h-4 w-4" />
            </Button>
            <div className="flex items-center justify-center rounded-lg border h-10 p-2 mx-auto">
                <p className="mr-2">
                    Similar Items Search for
                </p>
                <div className="w-1/4">
                    {path ? <FilePathComponent path={path} /> : <FilePathComponent path={query.is_item || "[Missing]"} />}
                </div>
            </div>

        </div>
    )
}