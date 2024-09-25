import { components } from "@/lib/panoptikon"
import def from "nuqs/server"

export type OrderArgsType = components["schemas"]["OrderParams"]
export type orderByType = Exclude<OrderArgsType["order_by"], null>
export type orderType = Exclude<OrderArgsType["order"], null | undefined>
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

export const orderParamsKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    order_by: p
      .parseAsStringEnum<orderByType>([
        "last_modified",
        "path",
        "rank_fts",
        "rank_path_fts",
        "time_added",
        "rank_any_text",
        "text_vec_distance",
        "image_vec_distance",
      ])
      .withDefault("last_modified"),
    order: p.parseAsStringEnum<orderType>(["asc", "desc"]),
    page: p.parseAsInteger.withDefault(1).withOptions({ history: "push" }),
    page_size: p.parseAsInteger.withDefault(10),
  })

export const tagFiltersKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    pos_match_all: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    pos_match_any: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    neg_match_any: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    neg_match_all: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    all_setters_required: p.parseAsBoolean.withDefault(false),
    setters: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    namespaces: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    min_confidence: p.parseAsFloat.withDefault(0),
  })

export const embedArgsKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    cache_key: p.parseAsString.withDefault("search"),
    lru_size: p.parseAsInteger.withDefault(2),
    ttl_seconds: p.parseAsInteger.withDefault(600),
  })
export const fileFiltersKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    item_types: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    include_path_prefixes: p.parseAsArrayOf(p.parseAsString).withDefault([]),
  })

export const pathTextFiltersKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    query: p.parseAsString.withDefault(""),
    only_match_filename: p.parseAsBoolean.withDefault(false),
    raw_fts5_match: p.parseAsBoolean.withDefault(false),
  })

export const extractedTextFiltersKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    query: p.parseAsString.withDefault(""),
    targets: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    languages: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    language_min_confidence: p.parseAsFloat.withDefault(0),
    min_confidence: p.parseAsFloat.withDefault(0),
    raw_fts5_match: p.parseAsBoolean.withDefault(false),
  })

export const bookmarksFilterKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    restrict_to_bookmarks: p.parseAsBoolean.withDefault(false),
    namespaces: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    user: p.parseAsString.withDefault("user"),
    include_wildcard: p.parseAsBoolean.withDefault(true),
  })

export const extractedTextEmbeddingsFiltersKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    query: p.parseAsString.withDefault(""),
    model: p.parseAsString.withDefault(""),
    targets: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    languages: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    language_min_confidence: p.parseAsFloat.withDefault(0),
    min_confidence: p.parseAsFloat.withDefault(0),
  })

export const imageEmbeddingsFiltersKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    query: p.parseAsString.withDefault(""),
    model: p.parseAsString.withDefault(""),
  })

export const queryOptionsKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    e_tags: p.parseAsBoolean.withDefault(false),
    e_path: p.parseAsBoolean.withDefault(false),
    e_et: p.parseAsBoolean.withDefault(false),
    e_pt: p.parseAsBoolean.withDefault(false),
    e_mime: p.parseAsBoolean.withDefault(false),
    e_iemb: p.parseAsBoolean.withDefault(false),
    e_temb: p.parseAsBoolean.withDefault(false),
    at_e_path: p.parseAsBoolean.withDefault(true),
    at_e_et: p.parseAsBoolean.withDefault(true),
    at_query: p.parseAsString.withDefault(""),
    at_fts5: p.parseAsBoolean.withDefault(false),
    s_enable: p.parseAsBoolean.withDefault(true),
  })

export interface SearchQueryOptions {
  e_tags: boolean
  e_path: boolean
  e_pt: boolean
  e_et: boolean
  e_mime: boolean
  e_iemb: boolean
  e_temb: boolean
  at_e_path: boolean
  at_e_et: boolean
  at_query: string
  at_fts5: boolean
  s_enable: boolean
}
export type ATExtractedTextFilter = Required<
  Omit<components["schemas"]["ExtractedTextFilter"], "query" | "raw_fts5_match">
>
export type ATPathTextFilter = Required<
  Omit<components["schemas"]["PathTextFilter"], "query" | "raw_fts5_match">
>
export interface AnyTextFilterOptions {
  query: string
  raw_fts5_match: boolean
  enable_path_filter: boolean
  enable_et_filter: boolean
  path_filter: ATPathTextFilter
  et_filter: ATExtractedTextFilter
}

// Wrap the types in Required<>
export type KeymapComponents = {
  ExtractedTextFilter: Required<components["schemas"]["ExtractedTextFilter"]>
  EmbedArgs: Required<components["schemas"]["EmbedArgs"]>
  PathTextFilter: Required<components["schemas"]["PathTextFilter"]>
  OrderParams: Required<components["schemas"]["OrderParams"]>
  QueryTagFilters: Required<components["schemas"]["QueryTagFilters"]>
  FileFilters: Required<components["schemas"]["FileFilters"]>
  BookmarksFilter: Required<components["schemas"]["BookmarksFilter"]>
  ExtractedTextEmbeddingsFilter: Required<
    components["schemas"]["ExtractedTextEmbeddingsFilter"]
  >
  ImageEmbeddingFilter: Required<components["schemas"]["ImageEmbeddingFilter"]>
  SearchQueryOptions: Required<SearchQueryOptions>
  ATExtractedTextFilter: ATExtractedTextFilter
  ATPathTextFilter: ATPathTextFilter
}
