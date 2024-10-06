import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { keepPreviousData, useQueryClient } from "@tanstack/react-query"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import React, { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"

export function FolderLists() {
    const [dbs] = useSelectedDBs()
    const { data, error, isError, refetch, isFetching } = $api.useQuery(
        "get",
        "/api/jobs/folders",
        {
            params: {
                query: dbs,
            },
        },
        {
            placeholderData: keepPreviousData,
        },
    )
    const queryClient = useQueryClient()

    // Local state for editable folder paths
    const [includedFolders, setIncludedFolders] = React.useState("")
    const [excludedFolders, setExcludedFolders] = React.useState("")

    // Update the local state whenever data is fetched
    useEffect(() => {
        if (data) {
            setIncludedFolders(data.included_folders.join("\n"))
            setExcludedFolders(data.excluded_folders.join("\n"))
        }
    }, [data])

    const { toast } = useToast()

    const update = $api.useMutation("put", "/api/jobs/folders", {
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: [
                    "get",
                    "/api/jobs/folders",
                    {
                        params: {
                            query: dbs,
                        },
                    },
                ],
            })
            queryClient.invalidateQueries({
                queryKey: ["get", "/api/jobs/queue"],
            })
            toast({
                title: "Folder Update Queued",
                description:
                    "The folders will be updated only after the job has been completed",
            })
        },
    })

    const rescan = $api.useMutation("post", "/api/jobs/folders/rescan", {
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: [
                    "get",
                    "/api/jobs/folders",
                    {
                        params: {
                            query: dbs,
                        },
                    },
                ],
            })
            queryClient.invalidateQueries({
                queryKey: ["get", "/api/jobs/queue"],
            })
            toast({
                title: "Folder Rescan Queued",
                description: "The folders will be rescanned once the job is executed",
            })
        },
    })

    const updateFolders = async () => {
        update.mutate({
            params: {
                query: dbs,
            },
            body: {
                included_folders: includedFolders
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line !== ""),
                excluded_folders: excludedFolders
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line !== ""),
            },
        })
    }

    const rescanFolders = () => {
        rescan.mutate({
            params: {
                query: dbs,
            },
        })
    }

    return (
        <div className="rounded-lg border p-4 mb-4 mt-4">
            <Tabs className="" defaultValue="included">
                <TabsList>
                    <TabsTrigger value="included">Included Folder Paths</TabsTrigger>
                    <TabsTrigger value="excluded">Excluded Folder Paths</TabsTrigger>
                </TabsList>
                <TabsContent value="included">
                    <Textarea
                        className="min-h-40"
                        placeholder="One path per line. These folders will be scanned for files."
                        value={includedFolders}
                        onChange={(e) => setIncludedFolders(e.target.value)}
                    />
                </TabsContent>
                <TabsContent value="excluded">
                    <Textarea
                        className="min-h-40"
                        placeholder="One path per line. These folders will be excluded from the scan."
                        value={excludedFolders}
                        onChange={(e) => setExcludedFolders(e.target.value)}
                    />
                </TabsContent>
            </Tabs>
            <Button
                className="mt-4"
                variant="outline"
                onClick={() => updateFolders()}
            >
                Save And Scan New Paths
            </Button>
            <Button
                className="ml-4 mt-4"
                variant="outline"
                onClick={() => rescanFolders()}
            >
                Rescan All Paths
            </Button>
        </div>
    )
}

