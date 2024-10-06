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

export function JobHistory() {
    return (
        <Tabs defaultValue="filescans" className="rounded-lg border p-4 mt-4">
            <TabsList>
                <TabsTrigger value="filescans">File Scan History</TabsTrigger>
                <TabsTrigger value="data">Data Extraction History</TabsTrigger>
            </TabsList>
            <TabsContent value="filescans">
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
                query: dbs,
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
                    "/api/jobs/data/history",
                    {
                        params: {
                            query: dbs,
                        },
                    },
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
        <ScrollArea className="max-w-[95vw] whitespace-nowrap">
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
                        className="ml-4"
                        variant="destructive"
                        onClick={() => deleteSelected()}
                    >
                        Delete Saved Data
                    </Button>
                }
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
                query: dbs,
            },
        },
        {
            refetchInterval: 2500,
            placeholderData: keepPreviousData,
        },
    )
    return (
        <ScrollArea className="max-w-[95vw] whitespace-nowrap">
            <DataTable
                storageKey="filescan"
                data={data || []}
                columns={fileScanColumns}
                filterColumn="path"
                filterPlaceholder="Search path..."
            />
            <ScrollBar orientation="horizontal" />
        </ScrollArea>
    )
}
