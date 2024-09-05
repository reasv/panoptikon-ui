"use client"
import { useEffect } from 'react'
import { useToast } from "@/components/ui/use-toast"
import { ToastAction } from "@/components/ui/toast"
import { useQueryOptions } from '@/lib/state/searchQuery/clientHooks'

export function SearchErrorToast({
    isError,
    error,
    noFtsErrors
}: {
    isError: boolean
    error: unknown
    noFtsErrors?: boolean
}) {
    const [options, setOptions] = useQueryOptions()
    const { toast } = useToast()
    useEffect(() => {
        if (isError) {
            let action = undefined
            let message = (error as Error).message
            if (!message && options.at_fts5 && !noFtsErrors) {
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