import { useImageSimilarity } from "@/lib/state/similarityStore"
import { ClipItemSimilarity } from "./ClipSimilarItems"
import { TextEmbeddingsSimilarity } from "./TextSimilarItems"
import { Button } from "@/components/ui/button"
import { Delete } from "lucide-react"

export function SimilarItemsSideBar() {
    return (
        <div className="mt-4">
            <ClipItemSimilarity />
            <TextEmbeddingsSimilarity />
            <ResetFilters />
        </div>
    )
}

function ResetFilters() {
    const resetFilters = useImageSimilarity((state) => state.resetAll)
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <div className="text-base font-medium">Reset Similarity Options</div>
                    <div className="text-gray-400">Reset all options for similarity search</div>
                </div>
                <Button
                    title="Clear all similarity filters"
                    variant="ghost"
                    size="icon"
                    onClick={() => resetFilters()}
                >
                    <Delete
                        className="h-4 w-4"
                    />
                </Button>
            </div>
        </div>
    )
}