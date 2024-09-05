import { components } from "@/lib/panoptikon"
import def from "nuqs/server"

export type FullSimilarityQuery = Required<
  components["schemas"]["SimilarItemsRequest"]
>
export type DistanceAggregationType =
  FullSimilarityQuery["distance_aggregation"]

export type SimilarityQuerySource = Required<
  NonNullable<FullSimilarityQuery["src_text"]>
>
export enum SimilarityQueryType {
  clip = "clip",
  textEmbedding = "text-embedding",
}
export type SimilarityQueryOptions = Omit<FullSimilarityQuery, "src_text"> & {
  item: string | null
  type: SimilarityQueryType
}

const applyOptionsToMap = <T extends Record<string, any>>(
  map: T
): {
  [K in keyof T]: T[K]
} =>
  Object.fromEntries(
    Object.entries(map).map(([key, value]) => [
      key,
      value.withOptions({ clearOnDefault: true }),
    ])
  ) as T

export const similarityQueryOptionsKeymap = (p: typeof def) =>
  applyOptionsToMap({
    item: p.parseAsString.withOptions({ history: "push" }),
    type: p
      .parseAsStringEnum<SimilarityQueryType>(
        Object.values(SimilarityQueryType)
      )
      .withDefault(SimilarityQueryType.clip)
      .withOptions({ history: "push" }),
    setter_name: p.parseAsString
      .withOptions({ history: "push" })
      .withDefault(""),
    page: p.parseAsInteger.withDefault(1).withOptions({ history: "push" }),
    distance_aggregation: p
      .parseAsStringEnum<DistanceAggregationType>(["MIN", "MAX", "AVG"])
      .withDefault("MIN"),
    src_confidence_weight: p.parseAsFloat.withDefault(0),
    src_language_confidence_weight: p.parseAsFloat.withDefault(0),
    clip_xmodal: p.parseAsBoolean.withDefault(false),
    xmodal_t2t: p.parseAsBoolean.withDefault(true),
    xmodal_i2i: p.parseAsBoolean.withDefault(true),
    page_size: p.parseAsInteger.withDefault(10),
    full_count: p.parseAsBoolean.withDefault(true),
  })

export const similarityQuerySourceKeymap = (p: typeof def) =>
  applyOptionsToMap({
    setter_names: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    languages: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    min_confidence: p.parseAsFloat.withDefault(0),
    min_language_confidence: p.parseAsFloat.withDefault(0),
    min_length: p.parseAsInteger.withDefault(0),
  })

export type SimilarityQueryState = {
  similarityOptions: SimilarityQueryOptions
  similaritySource: SimilarityQuerySource
}
