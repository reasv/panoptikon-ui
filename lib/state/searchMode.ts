import { parseAsStringEnum, useQueryState } from "nuqs"

export enum Mode {
  Search = "s",
  ItemSimilarity = "is",
}

export const useSearchMode = () =>
  useQueryState(
    "mode",
    parseAsStringEnum<Mode>(Object.values(Mode))
      .withDefault(Mode.Search)
      .withOptions({
        history: "push",
        clearOnDefault: true,
      })
  )
