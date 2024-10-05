import { ColumnDef } from "@tanstack/react-table"
import { components } from "@/lib/panoptikon"
import { Checkbox } from "@/components/ui/checkbox"

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
        header: "Batch Size",
    },
    {
        id: "threshold",
        accessorKey: "threshold",
        header: "Confidence Threshold",
    }
]