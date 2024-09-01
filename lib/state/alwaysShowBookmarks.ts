import {
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  useQueryState,
} from "nuqs"

export const useAlwaysShowBookmarkBtn = () =>
  useQueryState(
    "bk-show",
    parseAsBoolean.withDefault(false).withOptions({
      clearOnDefault: true,
    })
  )
