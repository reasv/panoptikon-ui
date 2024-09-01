import { useQueryStates, parseAsFloat } from "nuqs"

import {
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  useQueryState,
} from "nuqs"

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

export enum SimilarityQueryType {
  clip = "clip",
  textEmbedding = "text-embedding",
}

export const useSimilarityQuery = () =>
  useQueryStates(
    {
      is_item: parseAsString,
      is_model: parseAsString,
      is_type: parseAsStringEnum<SimilarityQueryType>(
        Object.values(SimilarityQueryType)
      ).withDefault(SimilarityQueryType.clip),
      is_page: parseAsInteger.withDefault(1).withOptions({
        clearOnDefault: true,
      }),
      is_page_size: parseAsInteger.withDefault(10).withOptions({
        clearOnDefault: true,
      }),
    },
    {
      history: "push",
    }
  )
