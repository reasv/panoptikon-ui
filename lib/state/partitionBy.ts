import {
  createSerializer,
  parseAsArrayOf,
  parseAsStringEnum,
  useQueryStates,
} from "nuqs"
import { SetFn } from "./searchQuery/clientHooks"

export interface PartitionBy {
  partition_by: ["item_id"] | null
}

export const usePartitionBy = (): [PartitionBy, SetFn<PartitionBy>] =>
  useQueryStates(
    {
      partition_by: parseAsArrayOf(parseAsStringEnum(["item_id"])),
    },
    {
      history: "push",
      clearOnDefault: true,
    }
  ) as any

export const partitionBySerializer = createSerializer({
  partition_by: parseAsArrayOf(parseAsStringEnum(["item_id"])),
})
