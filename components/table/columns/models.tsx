import { ColumnDef } from "@tanstack/react-table"
import { prettyPrintDate, prettyPrintDuration, prettyPrintDurationBetweenDates } from "../utils"
import { Button } from "@/components/ui/button"
import { ArrowUpDown } from "lucide-react"
import { components } from "@/lib/panoptikon"
export type Group = {
    group_name: string;
    description: string;
    name: string;
    default_threshold: number;
    default_batch_size: number;
    default_inference_id: string;
    target_entities: string[];
    output_type: string;
    input_mime_types: string[];
    input_spec: object;
    inference_ids: Model[];
};

export type InputObject = Record<string, {
    group_metadata: {
        description: string;
        name: string;
        default_threshold: number;
        default_batch_size: number;
        default_inference_id: string;
        target_entities: string[];
        output_type: string;
        input_mime_types: string[];
        input_spec: object;
    };
    inference_ids: Record<string, { description: string, link?: string }>;
}>;

export function transformData(input: InputObject): Group[] {
    return Object.entries(input).map(([groupName, groupData]) => {
        const inferenceIds = Object.entries(groupData.inference_ids).map(([inferenceId, details]) => ({
            inference_id: inferenceId,
            ...details,
        }));

        return {
            group_name: groupName,
            ...groupData.group_metadata,
            inference_ids: inferenceIds,
        };
    });
}
export interface Model {
    inference_id: string;
    description: string;
    link?: string;
}
export const modelColumns: ColumnDef<Model>[] = [
    {
        accessorKey: "inference_id",
        header: "Inference ID",
    },
    {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => {
            return <div className="max-w-50vw text-wrap">{row.getValue("description")}</div>
        },
    },
    // {
    //     accessorKey: "link",
    //     header: "Link",
    // }
]