import { useQueryState, parseAsStringEnum, parseAsString } from "nuqs"

export const useJobHistoryTab = () =>
  useQueryState(
    `jht`,
    parseAsStringEnum(["files", "data"])
      .withOptions({
        history: "push",
        clearOnDefault: true,
      })
      .withDefault("files")
  )

export const useExtractionGroupTabs = () =>
  useQueryState(
    `grouptab`,
    parseAsString.withOptions({
      history: "push",
      clearOnDefault: true,
    })
  )
