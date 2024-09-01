import { useQueryState, parseAsBoolean } from "nuqs"

export const useSideBarOpen = () =>
  useQueryState(
    `sb`,
    parseAsBoolean.withDefault(false).withOptions({
      history: "push",
      clearOnDefault: true,
    })
  )
