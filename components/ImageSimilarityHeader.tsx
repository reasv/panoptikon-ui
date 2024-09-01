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
            is_type: null,
            is_page: null
        })
        setName(Gallery.search)
        setSearchmode(Mode.Search)
    }
    return (
        <div className="relative w-full flex items-center">
            <Button onClick={onExitClick} title="Leave Item Similarity Search" variant="ghost" size="icon" className="mr-2">
                <LogOut className="h-4 w-4" />
            </Button>
            <div className="flex items-center justify-center rounded-lg sm:border h-10 p-2 mx-auto">
                <p className="mr-2 hidden sm:block lg:hidden xl:block">
                    Similarity Search for
                </p>
                <p className="mr-2 sm:hidden lg:block xl:hidden">
                    Similarity Search
                </p>
                <div className="w-1/4 hidden sm:block lg:hidden xl:block">
                    {path ? <FilePathComponent path={path} /> : <FilePathComponent path={query.is_item || "[Missing]"} />}
                </div>
            </div>

        </div>
    )
}