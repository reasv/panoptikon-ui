import { ColumnDef } from "@tanstack/react-table"
import { components } from "@/lib/panoptikon"
import { Checkbox } from "@/components/ui/checkbox"

export const jobQueueColumns: ColumnDef<components["schemas"]["JobModel"]>[] = [
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
        accessorKey: "queue_id",
        header: "ID",
    },
    {
        accessorKey: "job_type",
        header: "Type",
        cell: ({ row }) => {
            if (row.getValue("job_type") === "data_extraction") {
                return "Index Data Extraction"
            }
            if (row.getValue("job_type") === "data_deletion") {
                return "Index Data Deletion"
            }
            if (row.getValue("job_type") === "folder_rescan") {
                return "Folder Rescan"
            }
            if (row.getValue("job_type") === "folder_update") {
                return "Folder Update"
            }
        },
    },
    {
        accessorKey: "metadata",
        header: "Model",
    }
]