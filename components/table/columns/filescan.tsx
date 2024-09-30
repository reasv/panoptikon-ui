import { ColumnDef } from "@tanstack/react-table"
import { prettyPrintDate, prettyPrintDuration, prettyPrintDurationBetweenDates } from "../utils"
import { Button } from "@/components/ui/button"
import { ArrowUpDown } from "lucide-react"
import { components } from "@/lib/panoptikon"

export const fileScanColumns: ColumnDef<components["schemas"]["FileScanRecord"]>[] = [
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
        cell: ({ row }) => prettyPrintDate(row.getValue("end_time")),
    },
    {
        accessorKey: "duration",
        header: "Duration",
        cell: ({ row }) => prettyPrintDurationBetweenDates(row.getValue("start_time"), row.getValue("end_time")),
    },
    {
        accessorKey: "path",
        header: "Path",
    },
    {
        accessorKey: "total_available",
        header: "Total Available",
    },
    {
        accessorKey: "marked_unavailable",
        header: "Marked Unavailable",
    },
    {
        accessorKey: "errors",
        header: "Errors",
    },
    {
        accessorKey: "new_items",
        header: "New Items",
    },
    {
        accessorKey: "new_files",
        header: "New Files",
    },
    {
        accessorKey: "unchanged_files",
        header: "Unchanged Files",
    },
    {
        accessorKey: "modified_files",
        header: "Modified Files",
    },
    {
        accessorKey: "false_changes",
        header: "Wrongly Detected Changes",
    },
    {
        accessorKey: "metadata_time",
        header: "Metadata Scan Time",
        cell: ({ row }) => prettyPrintDuration(row.getValue("metadata_time")),
    },
    {
        accessorKey: "hashing_time",
        header: "File Hashing Time",
        cell: ({ row }) => prettyPrintDuration(row.getValue("hashing_time")),
    },
    {
        accessorKey: "thumbgen_time",
        header: "Thumb Gen Time",
        cell: ({ row }) => prettyPrintDuration(row.getValue("thumbgen_time")),
    },
]