"use client"
import { Delete } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { Button } from './ui/button'
import { initialSearchQueryState, useSearchQuery } from "@/lib/zust"

export function ClearSearch() {
    const { toast } = useToast()
    const setInitialState = useSearchQuery((state) => state.setInitialState)
    const clearSearchQuery = () => {
        setInitialState(initialSearchQueryState)
        toast({
            title: "Cleared Query",
            description: "All search options have been cleared",
            duration: 3000
        })
    }
    return (
        <Button
            onClick={() => clearSearchQuery()}
            title={"Clear all query options"}
            aria-label="Clear all query options"
            variant="ghost" size="icon"
        >
            <Delete className="h-4 w-4" />
        </Button>
    )
}