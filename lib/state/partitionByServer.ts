import {
  createSearchParamsCache,
  parseAsArrayOf,
  parseAsStringEnum,
} from "nuqs/server"

export const partitionByParamsCache = createSearchParamsCache({
  partition_by: parseAsArrayOf(parseAsStringEnum(["item_id"])),
})
