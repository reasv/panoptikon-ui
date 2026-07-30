import { ColumnDef } from "@tanstack/react-table"
import { components } from "@/lib/panoptikon"
import { Checkbox } from "@/components/ui/checkbox"
import { formatMaxBatchSize } from "@/components/scan/MaxBatchSize"

export const scheduleColumns: ColumnDef<components["schemas"]["CronJob"]>[] = [
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
        id: "inference_id",
        accessorKey: "inference_id",
        header: "Inference ID",
    },
    {
        id: "batch_size",
        accessorKey: "batch_size",
        header: "Max Batch Size",
        // Cron rows carry no cap by default: the schedule runs on auto.
        cell: ({ row }) => formatMaxBatchSize(row.original.batch_size),
    },
    {
        id: "threshold",
        accessorKey: "threshold",
        header: "Confidence Threshold",
    }
]