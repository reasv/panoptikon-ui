import { useQueryState, parseAsBoolean, parseAsInteger } from "nuqs"

export const useScanDrawerOpen = () =>
  useQueryState(
    `scand`,
    parseAsBoolean.withDefault(false).withOptions({
      history: "push",
      clearOnDefault: true,
    })
  )
