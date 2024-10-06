import { useQueryState, parseAsStringEnum } from "nuqs"

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
