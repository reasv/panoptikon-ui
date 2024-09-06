import { parseAsBoolean, useQueryState } from "nuqs"

export const useAlwaysShowBookmarkBtn = () =>
  useQueryState(
    "bk-show",
    parseAsBoolean.withDefault(false).withOptions({
      clearOnDefault: true,
    })
  )
