import { ColumnDef } from "@tanstack/react-table"
import { estimateEta, prettyPrintDate, prettyPrintDuration, prettyPrintDurationBetweenDates } from "../utils"
import { Button } from "@/components/ui/button"
import { ArrowUpDown } from "lucide-react"
import { components } from "@/lib/panoptikon"
import { Checkbox } from "@/components/ui/checkbox"


export const dataLogColumns: ColumnDef<components["schemas"]["LogRecord"]>[] = [
    {
        id: "select",
        header: ({ table }) => (
            <Checkbox
                checked={
                    table.getIsAllPageRowsSelected() ||
                    (table.getIsSomePageRowsSelected() && "indeterminate")
                }
                onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                aria-label="Select all"
            />
        ),
        cell: ({ row }) => (
            <Checkbox
                checked={row.getIsSelected()}
                onCheckedChange={(value) => row.toggleSelected(!!value)}
                aria-label="Select row"
            />
        ),
        enableSorting: false,
        enableHiding: false,
    },
    {
        id: "id",
        accessorKey: "id",
        header: "ID",
    },
    {
        accessorKey: "start_time",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Start Time
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        cell: ({ row }) => prettyPrintDate(row.getValue("start_time")),
    },
    {
        id: "end_time",
        accessorKey: "end_time",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    End Time
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        cell: ({ row }) => {
            if (row.getValue("failed")) {
                return `(Failed) ${prettyPrintDate(row.getValue("end_time"))}`
            }
            if (row.getValue("completed")) {
                return prettyPrintDate(row.getValue("end_time"))
            }
            if (row.getValue("status") === -1) {
                return `(Stopped) ${prettyPrintDate(row.getValue("end_time"))}`
            }
            const totalProcessed: number = (row.getValue("image_files") as number) + (row.getValue("video_files") as number) + (row.getValue("other_files") as number)
            const remaining = row.getValue("total_remaining") as number
            return `ETA: ${estimateEta(row.getValue("start_time"),
                totalProcessed,
                remaining
            )}`
        },
    },
    {
        id: "duration",
        accessorKey: "duration",
        header: "Duration",
        cell: ({ row }) => prettyPrintDurationBetweenDates(
            row.getValue("start_time"),
            row.getValue("end_time")
            || new Date().toISOString()
        ),
    },
    {
        id: "progress",
        header: "Progress",
        cell: ({ row }) => {
            const totalProcessed: number = (row.getValue("image_files") as number) + (row.getValue("video_files") as number) + (row.getValue("other_files") as number)
            if (row.getValue("completed") && !row.getValue("failed")) {
                return `${totalProcessed}/${totalProcessed}`
            }
            const remaining = row.getValue("total_remaining") as number
            return `${totalProcessed}/${totalProcessed + remaining}`
        },
    },
    {
        id: "percentage",
        header: "Percentage",
        cell: ({ row }) => {
            const totalProcessed: number = (row.getValue("image_files") as number) + (row.getValue("video_files") as number) + (row.getValue("other_files") as number)
            if (row.getValue("completed") && !row.getValue("failed")) {
                return `100%`
            }
            const remaining = row.getValue("total_remaining") as number
            const perc = (totalProcessed / (totalProcessed + remaining)) * 100
            return `${perc.toFixed(1)}%`
        },
    },
    {

        accessorKey: "type",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Type
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
    },
    {
        accessorKey: "setter",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Model
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
    },
    {
        id: "saved_data",
        accessorKey: "items_in_db",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Saved Data
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
    },
    {
        accessorKey: "batch_size",
        header: "Batch Size",
    },
    {
        accessorKey: "threshold",
        header: "Threshold",
    },
    {
        id: "data_load_time",
        accessorKey: "data_load_time",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Data Load Time
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        cell: ({ row }) => prettyPrintDuration(
            row.getValue("data_load_time")
        ),
    },
    {
        id: "inference_time",
        accessorKey: "inference_time",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Inference Time
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        cell: ({ row }) => prettyPrintDuration(
            row.getValue("inference_time")
        ),
    },
    {
        accessorKey: "image_files",
        header: "Image Files",
    },
    {
        accessorKey: "video_files",
        header: "Video Files",
    },
    {
        accessorKey: "other_files",
        header: "Other Files",
    },
    {
        id: "data_segments",
        accessorKey: "total_segments",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Data Segments
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
    },
    {
        accessorKey: "errors",
        header: "Errors",
    },
    {
        accessorKey: "total_remaining",
        header: "Remaining Unprocessed",
    },
    {
        accessorKey: "completed",
        header: "Completed",
    },
    {
        accessorKey: "failed",
        header: "Failed",
    },
    {
        id: "status",
        accessorKey: "status",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Status
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        cell: ({ row }) =>
            row.getValue("completed") ? "Completed" :
                row.getValue("failed") ? "Failed" :
                    row.getValue("status") === -1 ? "Stopped" :
                        "Processing",
    }
]