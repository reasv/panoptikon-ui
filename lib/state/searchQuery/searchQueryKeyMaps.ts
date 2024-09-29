import { components } from "@/lib/panoptikon"
import { distance } from "framer-motion"
import { Target } from "lucide-react"
import def from "nuqs/server"

export type OrderArgsType = {
  order_by:
    | components["schemas"]["OrderArgs"]["order_by"]
    | "bookmark_time"
    | "match_at"
    | "match_text"
    | "match_path"
    | "match_tags_confidence"
    | "search_semantic_text"
    | "search_semantic_image"
    | "search_item_similarity"

  order: components["schemas"]["OrderArgs"]["order"]
  page: number
  page_size: number
}
export type orderByType = Exclude<
  components["schemas"]["OrderArgs"]["order_by"],
  null
>
export type orderType = Exclude<OrderArgsType["order"], null | undefined>

export type distanceAggregation =
  components["schemas"]["SemanticTextArgs"]["distance_aggregation"]

export type distanceFunction =
  components["schemas"]["SimilarityArgs"]["distance_function"]
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
        "time_added",
        "size",
        "type",
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
    paths: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    exclude_paths: p.parseAsArrayOf(p.parseAsString).withDefault([]),
  })

export const matchPathKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    match: p.parseAsString.withDefault(""),
    filename_only: p.parseAsBoolean.withDefault(false),
    raw_fts5_match: p.parseAsBoolean.withDefault(false),
  })

export const matchTextKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    match: p.parseAsString.withDefault(""),
    setters: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    languages: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    min_language_confidence: p.parseAsFloat.withDefault(0),
    min_confidence: p.parseAsFloat.withDefault(0),
    raw_fts5_match: p.parseAsBoolean.withDefault(false),
    min_length: p.parseAsInteger.withDefault(0),
    max_length: p.parseAsInteger.withDefault(0),
    select_snippet_as: p.parseAsString.withDefault(""),
    s_max_len: p.parseAsInteger.withDefault(30),
    s_ellipsis: p.parseAsString.withDefault("..."),
    s_start_tag: p.parseAsString.withDefault("<b>"),
    s_end_tag: p.parseAsString.withDefault("</b>"),
    filter_only: p.parseAsBoolean.withDefault(false),
  })

export const inBookmarksKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    filter: p.parseAsBoolean.withDefault(false),
    namespaces: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    sub_ns: p.parseAsBoolean.withDefault(false),
    user: p.parseAsString.withDefault("user"),
    include_wildcard: p.parseAsBoolean.withDefault(true),
  })

export const semanticTextSearchKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    query: p.parseAsString.withDefault(""),
    model: p.parseAsString.withDefault(""),
    distance_aggregation: p
      .parseAsStringEnum<distanceAggregation>(["MIN", "MAX", "AVG"])
      .withDefault("AVG"),
  })

export const sourceTextKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    setters: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    languages: p.parseAsArrayOf(p.parseAsString).withDefault([]),
    min_language_confidence: p.parseAsFloat.withDefault(0),
    min_confidence: p.parseAsFloat.withDefault(0),
    raw_fts5_match: p.parseAsBoolean.withDefault(false),
    min_length: p.parseAsInteger.withDefault(0),
    max_length: p.parseAsInteger.withDefault(0),
    confidence_weight: p.parseAsFloat.withDefault(0),
    language_confidence_weight: p.parseAsFloat.withDefault(0),
  })

export const semanticImageSearchKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    query: p.parseAsString.withDefault(""),
    model: p.parseAsString.withDefault(""),
    distance_aggregation: p
      .parseAsStringEnum<distanceAggregation>(["MIN", "MAX", "AVG"])
      .withDefault("AVG"),
    clip_xmodal: p.parseAsBoolean.withDefault(false),
  })

export const itemSimilarityKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    target: p.parseAsString.withDefault(""),
    model: p.parseAsString.withDefault(""),
    distance_aggregation: p
      .parseAsStringEnum<distanceAggregation>(["MIN", "MAX", "AVG"])
      .withDefault("AVG"),
    distance_function: p
      .parseAsStringEnum<distanceFunction>(["COSINE", "L2"])
      .withDefault("COSINE"),
    clip_xmodal: p.parseAsBoolean.withDefault(false),
    xmodal_t2t: p.parseAsBoolean.withDefault(true),
    xmodal_i2i: p.parseAsBoolean.withDefault(true),
  })

export const filterSortKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    order_by: p.parseAsBoolean.withDefault(false),
    direction: p
      .parseAsStringEnum<orderType>(["asc", "desc"])
      .withDefault("asc"),
    row_n: p.parseAsBoolean.withDefault(false),
    row_n_direction: p
      .parseAsStringEnum<orderType>(["asc", "desc"])
      .withDefault("asc"),
  })

export const rrfKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    k: p.parseAsInteger.withDefault(5),
    weight: p.parseAsFloat.withDefault(1),
  })

export const queryOptionsKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    e_tags: p.parseAsBoolean.withDefault(false),
    e_path: p.parseAsBoolean.withDefault(false),
    e_path_neg: p.parseAsBoolean.withDefault(false),
    e_txt: p.parseAsBoolean.withDefault(false),
    e_pt: p.parseAsBoolean.withDefault(false),
    e_mime: p.parseAsBoolean.withDefault(false),
    e_iemb: p.parseAsBoolean.withDefault(false),
    e_temb: p.parseAsBoolean.withDefault(false),
    at_e_path: p.parseAsBoolean.withDefault(true),
    at_e_txt: p.parseAsBoolean.withDefault(true),
    at_e_st: p.parseAsBoolean.withDefault(false),
    at_e_si: p.parseAsBoolean.withDefault(false),
    at_query: p.parseAsString.withDefault(""),
    at_fts5: p.parseAsBoolean.withDefault(false),
    e_iss: p.parseAsBoolean.withDefault(false),
    s_enable: p.parseAsBoolean.withDefault(true),
  })

export interface SearchQueryOptions {
  e_tags: boolean
  e_path: boolean
  e_path_neg: boolean
  e_pt: boolean
  e_txt: boolean
  e_mime: boolean
  e_iemb: boolean
  e_temb: boolean
  at_e_path: boolean
  at_e_txt: boolean
  at_e_st: boolean
  at_e_si: boolean
  at_query: string
  at_fts5: boolean
  e_iss: boolean
  s_enable: boolean
}
type NonNullableProps<T> = {
  [P in keyof T]: NonNullable<T[P]>
}
export type ATMatchText = Required<
  Omit<components["schemas"]["MatchTextArgs"], "match" | "raw_fts5_match">
>
export type ATMatchPath = Required<
  Omit<components["schemas"]["MatchPathArgs"], "match" | "raw_fts5_match">
>

export type ATSemanticText = Required<
  Omit<
    components["schemas"]["SemanticTextArgs"],
    "query" | "embed" | "src_text"
  >
>
export type ATSemanticImage = Required<
  Omit<
    components["schemas"]["SemanticImageArgs"],
    "query" | "embed" | "src_text"
  >
>

export type ATEmbedArgs = Required<components["schemas"]["EmbedArgs"]>
export type ATSourceText = NonNullableProps<
  Required<components["schemas"]["SourceArgs"]>
>
export interface AnyTextFilterOptions {
  query: string
  raw_fts5_match: boolean
  enable_path_filter: boolean
  enable_txt_filter: boolean
  path_filter: ATMatchPath
  txt_filter: ATMatchText
}

export interface FileFilters {
  item_types: string[]
  paths: string[]
  exclude_paths: string[]
}

type tagsArgs = components["schemas"]["TagsArgs"]
export type MatchTagsArgs = Omit<tagsArgs, "tags" | "match_any"> & {
  pos_match_all: string[]
  pos_match_any: string[]
  neg_match_any: string[]
  neg_match_all: string[]
}
// Wrap the types in Required<>
export type KeymapComponents = {
  MatchText: Required<components["schemas"]["MatchTextArgs"]>
  EmbedArgs: Required<components["schemas"]["EmbedArgs"]>
  InBookmarks: Required<components["schemas"]["InBookmarksArgs"]>
  MatchPath: Required<components["schemas"]["MatchPathArgs"]>
  OrderArgs: Required<OrderArgsType>
  MatchTags: Required<MatchTagsArgs>
  FileFilters: FileFilters
  SemanticTextSearch: Required<
    Omit<components["schemas"]["SemanticTextArgs"], "embed" | "src_text">
  >
  SemanticTextSource: NonNullableProps<
    Required<components["schemas"]["SourceArgs"]>
  >
  SemanticImageSearch: Required<
    Omit<components["schemas"]["SemanticImageArgs"], "embed" | "src_text">
  >
  ItemSimilarity: Required<
    Omit<components["schemas"]["SimilarityArgs"], "embed" | "src_text">
  >
  ItemSimilarityTextSource: Required<components["schemas"]["SourceArgs"]>
  SearchQueryOptions: Required<Omit<SearchQueryOptions, "src_text">>
  ATMatchText: ATMatchText
  ATTextRRF: Required<components["schemas"]["RRF"]>
  ATMatchPath: ATMatchPath
  ATPathRRF: Required<components["schemas"]["RRF"]>
  ATSemanticText: ATSemanticText
  ATSemanticTextRRF: Required<components["schemas"]["RRF"]>
  ATSemanticImage: ATSemanticImage
  ATSemanticImageRRF: Required<components["schemas"]["RRF"]>
  ATSourceText: ATSourceText
}

// Similar Items Sidebar
export const similaritySBPageArgsKeyMap = (p: typeof def) =>
  applyOptionsToMap({
    page_clip: p.parseAsInteger.withDefault(1).withOptions({ history: "push" }),
    page_size_clip: p.parseAsInteger.withDefault(6),
    page_text: p.parseAsInteger.withDefault(1).withOptions({ history: "push" }),
    page_size_text: p.parseAsInteger.withDefault(6),
  })

export type SimilaritySideBarComponents = {
  CLIPSimilarity: Required<
    Omit<
      components["schemas"]["SimilarityArgs"],
      "target" | "distance_function" | "src_text"
    >
  >
  CLIPTextSource: Required<components["schemas"]["SourceArgs"]>

  TextSimilarity: Required<
    Omit<
      components["schemas"]["SimilarityArgs"],
      | "target"
      | "distance_function"
      | "src_text"
      | "clip_xmodal"
      | "xmodal_t2t"
      | "xmodal_i2i"
    >
  >
  TextSource: Required<components["schemas"]["SourceArgs"]>
  PageArgs: Required<{
    page_clip: number
    page_size_clip: number
    page_text: number
    page_size_text: number
  }>
}
