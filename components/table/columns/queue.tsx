import { ColumnDef } from "@tanstack/react-table"
import { components } from "@/lib/panoptikon"
import { Checkbox } from "@/components/ui/checkbox"

// A job type the UI doesn't know falls back to its own wire name rather than
// a placeholder: unhelpful, but at least it says which job is running.
const jobTypeLabels: Record<string, string> = {
    data_extraction: "Index Data Extraction",
    data_deletion: "Index Data Deletion",
    folder_rescan: "Folder Rescan",
    folder_update: "Folder Update",
    job_data_deletion: "Index Data Deletion (Job)",
    vector_quant_reconcile: "Vector Quant Reconcile",
    db_maintenance: "Database Maintenance",
}

// Deferred maintenance jobs carry their owed-work flags in `metadata`, the
// same field extraction jobs use for the model name. Translate the flags:
// the recount + ANALYZE pass always runs, a VACUUM only when data was deleted
// (and only if the server then judges it worthwhile).
const maintenanceMetadataLabel = (metadata: string) => {
    const flags = metadata.split(",").map((flag) => flag.trim())
    return flags.includes("deleted_data")
        ? "Tag recount + analyze, possible vacuum"
        : "Tag recount + analyze"
}

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
            const jobType = row.getValue("job_type") as string
            return jobTypeLabels[jobType] || jobType
        },
    },
    {
        id: "model",
        accessorKey: "metadata",
        header: "Model",
        cell: ({ row }) => {
            const metadata = row.getValue("model") as string | null
            if (row.original.job_type === "db_maintenance") {
                return maintenanceMetadataLabel(metadata ?? "")
            }
            return metadata
        },
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