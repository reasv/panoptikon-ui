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

export const useFailedFilesTab = () =>
  useQueryState(
    `fft`,
    parseAsStringEnum(["extraction", "scan"])
      .withOptions({
        history: "push",
        clearOnDefault: true,
      })
      .withDefault("extraction")
  )

export const useExtractionGroupTabs = () =>
  useQueryState(
    `grouptab`,
    parseAsString.withOptions({
      history: "push",
      clearOnDefault: true,
    })
  )
