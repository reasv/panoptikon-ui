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
        id: "queue_id",
        accessorKey: "queue_id",
        header: "Queue ID",
    },
    {
        id: "status",
        accessorKey: "running",
        header: "Status",
        cell: ({ row }) => {
            if (row.getValue("status")) {
                return "Running"
            }
            return "Queued"
        },
    },
    {
        id: "index_db",
        accessorKey: "index_db",
        header: "Index DB",
    },
    {
        id: "job_type",
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
            if (row.getValue("job_type") === "job_data_deletion") {
                return "Index Data Deletion (Job)"
            }
        },
    },
    {
        id: "model",
        accessorKey: "metadata",
        header: "Model",
    },
    {
        id: "batch_size",
        accessorKey: "batch_size",
        header: "Batch Size",
    },
    {
        id: "threshold",
        accessorKey: "threshold",
        header: "Confidence Threshold",
    },
    {
        id: "tag",
        accessorKey: "tag",
        header: "Tag",
    }
]