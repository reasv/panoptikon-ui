import { ColumnDef } from "@tanstack/react-table"
import { prettyPrintDate, prettyPrintDuration, prettyPrintDurationBetweenDates } from "../utils"
import { Button } from "@/components/ui/button"
import { ArrowUpDown } from "lucide-react"
import { components } from "@/lib/panoptikon"

export const dataLogColumns: ColumnDef<components["schemas"]["LogRecord"]>[] = [
    {
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

            return "In Progress"
        },
    },
    {
        accessorKey: "duration",
        header: "Duration",
        cell: ({ row }) => prettyPrintDurationBetweenDates(row.getValue("start_time"), row.getValue("end_time") || new Date().toISOString()),
    },
    {
        accessorKey: "data_load_time",
        header: "Data Load Time",
    },
    {
        accessorKey: "inference_time",
        header: "Inference Time",
    },
    {
        accessorKey: "type",
        header: "Type",
    },
    {
        accessorKey: "setter",
        header: "Model",
    },
    {
        accessorKey: "items_in_db",
        header: "Saved Data",
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
        accessorKey: "total_segments",
        header: "Data Segments",
    },
    {
        accessorKey: "errors",
        header: "Errors",
    },
    {
        accessorKey: "total_remaining",
        header: "Remaining Unprocessed",
    },
]