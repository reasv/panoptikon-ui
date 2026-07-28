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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown } from "lucide-react"

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
    const queue = data?.queue || []
    // Selection is keyed by queue_id (see `getRowId` below), not by array
    // index: the queue is refetched every 2.5s and rows shift as jobs finish.
    const [selected, setSelected] = React.useState<RowSelectionState>({})
    const selectedValues = queue.filter(
        (job) => selected[String(job.queue_id)] === true,
    )
    const cancelJob = $api.useMutation("delete", "/api/jobs/queue", {
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({
                queryKey: ["get", "/api/jobs/queue"],
            })
            const skipped =
                variables.params.query.run_maintenance === false
            toast({
                title: "Jobs Cancelled",
                description: skipped
                    ? "The selected jobs have been cancelled. Database maintenance was skipped."
                    : "The selected jobs have been cancelled.",
            })
            setSelected({})
        },
        onError: (error) => {
            const detail = (error as { detail?: string } | null)?.detail
            toast({
                title: "Cancellation Failed",
                description: detail || "The server rejected the request",
                variant: "destructive",
            })
        },
    })
    // run_maintenance=false suppresses the deferred DB maintenance job this
    // cancel would otherwise schedule; the owed work stays owed for the next
    // job boundary.
    const cancelSelected = (runMaintenance: boolean) => {
        cancelJob.mutate({
            params: {
                query: {
                    queue_ids: selectedValues.map((job) => job.queue_id),
                    run_maintenance: runMaintenance,
                },
            },
        })
    }
    const cancelDisabled = selectedValues.length === 0 || cancelJob.isPending

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
                    getRowId={(job) => String(job.queue_id)}
                    header={
                        <div className="flex flex-row items-center">
                            <Button
                                disabled={cancelDisabled}
                                variant="destructive"
                                className="rounded-r-none"
                                onClick={() => cancelSelected(true)}
                            >
                                Cancel Selected
                            </Button>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        disabled={cancelDisabled}
                                        variant="destructive"
                                        size="icon"
                                        aria-label="More cancel options"
                                        className="w-8 rounded-l-none border-l border-background/30"
                                    >
                                        <ChevronDown className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onSelect={() => cancelSelected(false)}
                                    >
                                        Cancel selected (skip maintenance job)
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    }
                />
                <ScrollBar orientation="horizontal" />
            </ScrollArea>
        </div>
    )
}