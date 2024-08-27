"use client"
import { useEffect } from 'react'
import { useSearchQuery } from "@/lib/zust"
import { useToast } from "@/components/ui/use-toast"
import { ToastAction } from "@/components/ui/toast"

export function SearchErrorToast({
    isError,
    error,
}: {
    isError: boolean
    error: unknown
}) {
    const rawFts5Match = useSearchQuery((state) => state.any_text.raw_fts5_match)
    const { toast } = useToast()
    useEffect(() => {
        if (isError) {
            let action = undefined
            let message = (error as Error).message
            if (!message && rawFts5Match) {
                message = "Make sure your query follows FTS5 MATCH syntax or disable the option"
                action = <ToastAction onClick={() => window.open("https://www.sqlite.org/fts5.html#full_text_query_syntax", "_blank")} altText="FTS5 Docs">Docs</ToastAction>
            }
            toast({
                title: "Error occurred while fetching results",
                description: message,
                variant: "destructive",
                action,
                duration: 5000
            })
        }
    }, [isError])
    return (
        <></>
    )
}