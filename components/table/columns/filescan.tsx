import { ColumnDef } from "@tanstack/react-table"
import { prettyPrintDate, prettyPrintDuration, prettyPrintDurationBetweenDates } from "../utils"
import { Button } from "@/components/ui/button"
import { ArrowUpDown } from "lucide-react"
import { components } from "@/lib/panoptikon"

export const fileScanColumns: ColumnDef<components["schemas"]["FileScanRecord"]>[] = [
    {
        id: "id",
        accessorKey: "id",
        header: "ID",
    },
    {
        id: "start_time",
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
        cell: ({ row }) => prettyPrintDate(row.getValue("end_time")),
    },
    {
        id: "duration",
        accessorKey: "duration",
        header: "Duration",
        cell: ({ row }) => prettyPrintDurationBetweenDates(row.getValue("start_time"), row.getValue("end_time")),
    },
    {
        id: "path",
        accessorKey: "path",
        header: "Path",
    },
    {
        id: "total_available",
        accessorKey: "total_available",
        header: "Total Available",
    },
    {
        id: "marked_unavailable",
        accessorKey: "marked_unavailable",
        header: "Marked Unavailable",
    },
    {
        id: "errors",
        accessorKey: "errors",
        header: "Errors",
    },
    {
        id: "new_items",
        accessorKey: "new_items",
        header: "New Items",
    },
    {
        id: "new_files",
        accessorKey: "new_files",
        header: "New Files",
    },
    {
        id: "unchanged_files",
        accessorKey: "unchanged_files",
        header: "Unchanged Files",
    },
    {
        id: "modified_files",
        accessorKey: "modified_files",
        header: "Modified Files",
    },
    {
        id: "false_changes",
        accessorKey: "false_changes",
        header: "Wrongly Detected Changes",
    },
    {
        id: "metadata_time",
        accessorKey: "metadata_time",
        header: "Metadata Scan Time",
        cell: ({ row }) => prettyPrintDuration(row.getValue("metadata_time")),
    },
    {
        id: "hashing_time",
        accessorKey: "hashing_time",
        header: "File Hashing Time",
        cell: ({ row }) => prettyPrintDuration(row.getValue("hashing_time")),
    },
    {
        id: "thumbgen_time",
        accessorKey: "thumbgen_time",
        header: "Thumb Gen Time",
        cell: ({ row }) => prettyPrintDuration(row.getValue("thumbgen_time")),
    },
    {
        id: "blurhash_time",
        accessorKey: "blurhash_time",
        header: "Blurhash Gen Time",
        cell: ({ row }) => prettyPrintDuration(row.getValue("blurhash_time")),
    },
]