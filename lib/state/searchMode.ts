import { createSerializer, parseAsStringEnum, useQueryState } from "nuqs"
import { createSearchParamsCache } from "nuqs/server"

export enum Mode {
  Search = "s",
  ItemSimilarity = "is",
}
const definition = parseAsStringEnum<Mode>(Object.values(Mode))
  .withDefault(Mode.Search)
  .withOptions({
    history: "push",
    clearOnDefault: true,
  })

export const useSearchMode = () => useQueryState("mode", definition)
export const searchModeSerializer = createSerializer({ mode: definition })
export const getSearchMode = createSearchParamsCache({
  mode: definition,
}).parse
