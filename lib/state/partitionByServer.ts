import { createSearchParamsCache, parseAsStringEnum } from "nuqs/server"

export const partitionByParamsCache = createSearchParamsCache({
  partition_by: parseAsStringEnum(["item_id"]),
})
