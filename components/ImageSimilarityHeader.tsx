import { LogOut } from "lucide-react";
import { Button } from "./ui/button";
import { $api } from "@/lib/api";
import { useSelectedDBs } from "@/lib/state/database";
import { FilePathComponent } from "./imageButtons";
import { useItemSimilaritySearch, useQueryOptions } from "@/lib/state/searchQuery/clientHooks";

export function ImageSimilarityHeader() {
    const [dbs, ___] = useSelectedDBs()
    const [filter, setFilter] = useItemSimilaritySearch()
    const [options, setOptions] = useQueryOptions()
    const { data, refetch, isFetching, isError, error } = $api.useQuery(
        "get",
        "/api/items/item/{sha256}",
        {
            params: {
                query: {
                    ...dbs,
                },
                path: {
                    sha256: filter.target || "",
                },
            },
        }
    )
    const path = data?.files[0]?.path
    const onExitClick = () => {
        if (!data) return
        setOptions({ e_iss: false })
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
                    {path ? <FilePathComponent path={path} /> : <FilePathComponent path={filter.target || "[Missing]"} />}
                </div>
            </div>

        </div>
    )
}