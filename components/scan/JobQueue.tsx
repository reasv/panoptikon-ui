import { $api } from "@/lib/api"
import { keepPreviousData, useQueryClient } from "@tanstack/react-query"
import { DataTable } from "@/components/table/dataTable"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import React from "react"
import { RowSelectionState } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { jobQueueColumns } from "@/components/table/columns/queue"
import { useToast } from "@/components/ui/use-toast"
import { Label } from "@/components/ui/label"

export function JobQueue() {
    const { data, error, isError, refetch, isFetching } = $api.useQuery(
        "get",
        "/api/jobs/queue",
        {},
        {
            refetchInterval: 2500,
            placeholderData: keepPreviousData,
        },
    )
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const cancelJob = $api.useMutation("delete", "/api/jobs/queue", {
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ["get", "/api/jobs/queue"],
            })
            toast({
                title: "Jobs Cancelled",
                description: "The selected jobs have been cancelled.",
            })
        },
    })
    const queue = data?.queue || []
    const [selected, setSelected] = React.useState<RowSelectionState>({})
    const selectedValues = queue.filter((_, index) => selected[index] === true)
    const cancelSelected = () => {
        cancelJob.mutate({
            params: {
                query: {
                    queue_ids: selectedValues.map((job) => job.queue_id),
                },
            },
        })
        setSelected({})
    }

    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">Job Queue</Label>
                    <div className="text-gray-400">Queued and running jobs</div>
                </div>
            </div>
            <ScrollArea className="max-w-[97vw] whitespace-nowrap">
                <DataTable
                    setRowSelection={setSelected}
                    rowSelection={selected}
                    storageKey="jobQueue"
                    data={queue}
                    columns={jobQueueColumns}
                    header={
                        <Button
                            disabled={selectedValues.length === 0}
                            variant="destructive"
                            onClick={() => cancelSelected()}
                        >
                            Cancel Selected
                        </Button>
                    }
                />
                <ScrollBar orientation="horizontal" />
            </ScrollArea>
        </div>
    )
}