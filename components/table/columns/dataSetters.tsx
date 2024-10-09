import { ColumnDef } from "@tanstack/react-table"
import { components } from "@/lib/panoptikon"
import { Checkbox } from "@/components/ui/checkbox"
export interface DataSetter {

    setter: string;
    count: number;
    description: string | undefined;
    batch_size: number;
    threshold: number | undefined;

}
export const dataSettersColumns: ColumnDef<DataSetter>[] = [
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
        id: "setter",
        accessorKey: "setter",
        header: "Inference ID",
    },
    {
        id: "description",
        accessorKey: "description",
        header: "Description",
    },
    {
        id: "count",
        accessorKey: "count",
        header: "Saved Data Count",
    },
    {
        id: "batch_size",
        accessorKey: "batch_size",
        header: "Configured Batch Size",
    },
    {
        id: "threshold",
        accessorKey: "threshold",
        header: "Configured Threshold",
    },

]