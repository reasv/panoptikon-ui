import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { keepPreviousData, useQueryClient } from "@tanstack/react-query"
import { fileScanColumns } from "@/components/table/columns/filescan"
import { DataTable } from "@/components/table/dataTable"
import { dataLogColumns } from "@/components/table/columns/datascan"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import React from "react"
import { useToast } from "../ui/use-toast"
import { RowSelectionState } from "@tanstack/react-table"
import { Button } from "../ui/button"
import { useJobHistoryTab } from "@/lib/state/ScanTabs"

export function JobHistory() {
    const [jobHistoryTab, setJobHistoryTab] = useJobHistoryTab()
    return (
        <Tabs
            defaultValue="files"
            value={jobHistoryTab}
            onValueChange={(value) => setJobHistoryTab(value as any)}
            className="rounded-lg border p-4 mt-4"
        >
            <TabsList>
                <TabsTrigger value="files">File Scan History</TabsTrigger>
                <TabsTrigger value="data">Data Extraction History</TabsTrigger>
            </TabsList>
            <TabsContent value="files">
                <FileScanHistory />
            </TabsContent>
            <TabsContent value="data">
                <DataExtractionHistory />
            </TabsContent>
        </Tabs>
    )
}

export function DataExtractionHistory() {
    const [dbs] = useSelectedDBs()
    const { data, error, isError, refetch, isFetching } = $api.useQuery(
        "get",
        "/api/jobs/data/history",
        {
            params: {
                query: {
                    ...dbs,
                    page_size: 2000,
                },
            },
        },
        {
            refetchInterval: 2500,
            placeholderData: keepPreviousData,
        },
    )
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [selected, setSelected] = React.useState<RowSelectionState>({})
    const selectedValues = (data || []).filter((_, index) => selected[index] === true)
    const deleteJobData = $api.useMutation(
        "delete",
        "/api/jobs/data/history", {
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: [
                    "get",
                    "/api/jobs/queue",
                ],
            })
            toast({
                title: "Scheduled Data Deletion",
                description: "The selected data deletion has been scheduled.",
            })
            setSelected({})
        }
    })

    const deleteSelected = () => {
        deleteJobData.mutate({
            params: {
                query: {
                    ...dbs,
                    log_ids: selectedValues.map((job) => job.id),
                },
            },
        })
    }
    return (
        <ScrollArea className="max-w-[97vw] whitespace-nowrap">
            <DataTable
                setRowSelection={setSelected}
                rowSelection={selected}
                storageKey="dataextraction"
                data={data || []}
                columns={dataLogColumns}
                filterColumn="setter"
                filterPlaceholder="Search model..."
                header={
                    <Button
                        disabled={selectedValues.length === 0}
                        variant="destructive"
                        onClick={() => deleteSelected()}
                    >
                        Delete Saved Data
                    </Button>
                }
                defaultColumnVisibility={{
                    "batch_size": false,
                    "threshold": false,
                    "data_load_time": false,
                    "inference_time": false,
                    "image_files": false,
                    "video_files": false,
                    "other_files": false,
                    "data_segments": false,
                    "errors": false,
                    "total_remaining": false,
                    "completed": false,
                    "failed": false,
                }}
            />
            <ScrollBar orientation="horizontal" />
        </ScrollArea>
    )
}

export function FileScanHistory() {
    const [dbs] = useSelectedDBs()
    const { data, error, isError, refetch, isFetching } = $api.useQuery(
        "get",
        "/api/jobs/folders/history",
        {
            params: {
                query: {
                    ...dbs,
                    page_size: 2000,
                },
            },
        },
        {
            refetchInterval: 2500,
            placeholderData: keepPreviousData,
        },
    )
    return (
        <ScrollArea className="max-w-[97vw] whitespace-nowrap">
            <DataTable
                storageKey="filescan"
                data={data || []}
                columns={fileScanColumns}
                filterColumn="path"
                filterPlaceholder="Search path..."
                defaultColumnVisibility={{
                    "new_items": false,
                    "unchanged_files": false,
                    "modified_files": false,
                    "false_changes": false,
                    "metadata_time": false,
                    "hashing_time": false,
                    "thumbgen_time": false,
                    "blurhash_time": false,
                }}
            />
            <ScrollBar orientation="horizontal" />
        </ScrollArea>
    )
}
