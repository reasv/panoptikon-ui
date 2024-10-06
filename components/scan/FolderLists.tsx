import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { keepPreviousData, useQueryClient } from "@tanstack/react-query"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import React, { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { components } from "@/lib/panoptikon"
import { Label } from "../ui/label"

export function FolderLists() {
    const [dbs] = useSelectedDBs()
    const queryClient = useQueryClient()
    // Local state for editable folder paths
    const [includedFolders, setIncludedFolders] = React.useState("")
    const [excludedFolders, setExcludedFolders] = React.useState("")
    const { toast } = useToast()

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
    const changeSettings = $api.useMutation("put", "/api/jobs/config", {
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: [
                    "get",
                    "/api/jobs/config",
                    {
                        params: {
                            query: dbs,
                        },
                    }
                ],
            })
            toast({
                title: "Settings Updated",
                description: "The changes have been applied",
            })
        },
    })
    const { data, refetch } = $api.useQuery(
        "get",
        "/api/jobs/config",
        {
            params: {
                query: dbs,
            },
        },
        {
            placeholderData: keepPreviousData,
        },
    )
    const changeConfig = async (modifyConfig: (currentConfig: components["schemas"]["SystemConfig"]) => components["schemas"]["SystemConfig"]) => {
        // Refetch the latest configuration
        const latestConfig = await refetch()

        // Apply the change to the latest config
        if (latestConfig.data) {
            const newConfig = modifyConfig(latestConfig.data)
            changeSettings.mutate({ body: newConfig, params: { query: dbs } })
        }
    }
    // Update the local state whenever data is fetched
    useEffect(() => {
        if (data) {
            const includedFolders = data.included_folders || []
            const excludedFolders = data.excluded_folders || []
            setIncludedFolders(includedFolders.join("\n"))
            setExcludedFolders(excludedFolders.join("\n"))
        }
    }, [data])

    const updateFolders = async () => {
        changeConfig((currentConfig) => {
            return {
                ...currentConfig,
                included_folders: includedFolders
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line !== ""),
                excluded_folders: excludedFolders
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line !== ""),
            }
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
            <div className='grid gap-4 grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 4xl:grid-cols-4'>
                <div className="flex flex-col items-left">
                    <div className="flex flex-row items-center justify-between">
                        <div className="space-y-0.5">
                            <Label className="text-base">
                                Included Directories
                            </Label>
                            <div className="text-gray-400">
                                These folders will be scanned for files
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-center">
                        <Textarea
                            className="min-h-40"
                            placeholder="One path per line. These folders will be scanned for files."
                            value={includedFolders}
                            onChange={(e) => setIncludedFolders(e.target.value)}
                        />
                    </div>
                </div>
                <div className="flex flex-col items-left">
                    <div className="flex flex-row items-center justify-between">
                        <div className="space-y-0.5">
                            <Label className="text-base">
                                Excluded Directories
                            </Label>
                            <div className="text-gray-400">
                                These folders will be excluded from the scan
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-center">
                        <Textarea
                            className="min-h-40"
                            placeholder="One path per line. These folders will be excluded from the scan."
                            value={excludedFolders}
                            onChange={(e) => setExcludedFolders(e.target.value)}
                        />
                    </div>
                </div>
            </div>
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

