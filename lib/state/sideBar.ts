import { useQueryState, parseAsBoolean, parseAsInteger } from "nuqs"

export const useSideBarOpen = () =>
  useQueryState(
    `sb`,
    parseAsBoolean.withDefault(false).withOptions({
      history: "push",
      clearOnDefault: true,
    })
  )

export const useSideBarTab = () =>
  useQueryState(
    `sbt`,
    parseAsInteger.withDefault(0).withOptions({
      history: "push",
      clearOnDefault: true,
    })
  )
