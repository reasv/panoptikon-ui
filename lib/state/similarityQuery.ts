import { useQueryStates, parseAsFloat } from "nuqs"

import {
  parseAsBoolean,
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
    `mode`,
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
      item: parseAsString,
      model: parseAsString,
      type: parseAsStringEnum<SimilarityQueryType>(
        Object.values(SimilarityQueryType)
      ).withDefault(SimilarityQueryType.clip),
      page: parseAsInteger.withDefault(1).withOptions({
        clearOnDefault: true,
      }),
    },
    {
      history: "push",
    }
  )
