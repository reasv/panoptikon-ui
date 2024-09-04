import { useQueryStates, useQueryState } from "nuqs"
import { components } from "../../panoptikon"

import {
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  parseAsArrayOf,
  parseAsJson,
  parseAsBoolean,
  parseAsTimestamp,
  parseAsIsoDateTime,
  parseAsFloat,
  parseAsHex,
  parseAsNumberLiteral,
  parseAsStringLiteral,
} from "nuqs/server"

export enum SimilarityQueryType {
  clip = "clip",
  textEmbedding = "text-embedding",
}

type OrderArgsType = components["schemas"]["OrderParams"]

type orderByType = Exclude<OrderArgsType["order_by"], null>
type orderType = Exclude<OrderArgsType["order"], null | undefined>

type Nullable<T> = {
  [K in keyof T]: T[K] | null
}

type UpdaterFn<T> = (old: T) => Partial<Nullable<T>>

type SetFn<T> = (
  values: Partial<Nullable<T>> | UpdaterFn<T>,
  options?: Options
) => Promise<URLSearchParams>

export function useOrderArgs(): [OrderArgsType, SetFn<OrderArgsType>] {
  const [orderArgs, setOrderArgs] = useQueryStates(
    {
      order_by: parseAsStringEnum<orderByType>([
        "last_modified",
        "path",
        "rank_fts",
        "rank_path_fts",
        "time_added",
        "rank_any_text",
        "text_vec_distance",
        "image_vec_distance",
      ]).withDefault("last_modified"),
      order: parseAsStringEnum<orderType>(["asc", "desc"]),
      page: parseAsInteger.withDefault(1),
      page_size: parseAsInteger.withDefault(10),
    },
    {
      history: "push",
    }
  )
  return [orderArgs, setOrderArgs] as const
}

export function queryFromState(
  state: SearchQueryState | SearchQueryStateState
): components["schemas"]["SearchQuery"] {
  const query: components["schemas"]["SearchQuery"] = {
    order_args: {
      ...state.order_args,
    },
    count: true,
    check_path: true,
    query: {
      filters: {
        any_text: {},
      },
    },
  }
  if (state.any_text.query) {
    if (state.any_text.enable_path_filter) {
      query.query!.filters!.any_text!.path = { ...state.any_text.path_filter }
      query.query!.filters!.any_text!.path.query = state.any_text.query
      query.query!.filters!.any_text!.path.raw_fts5_match =
        state.any_text.raw_fts5_match
    }
    if (state.any_text.enable_et_filter) {
      query.query!.filters!.any_text!.extracted_text = {
        ...state.any_text.et_filter,
      }
      query.query!.filters!.any_text!.extracted_text.query =
        state.any_text.query
      query.query!.filters!.any_text!.extracted_text.raw_fts5_match =
        state.any_text.raw_fts5_match
    }
  }
  if (state.bookmarks.restrict_to_bookmarks) {
    query.query!.filters!.bookmarks = { ...state.bookmarks }
  }
  if (getIsPathPrefixEnabled(state)) {
    query.query!.filters!.files = {
      include_path_prefixes: state.paths,
    }
  }
  if (getIsTypePrefixEnabled(state)) {
    query.query!.filters!.files = {
      ...query.query!.filters!.files,
      item_types: state.types,
    }
  }
  if (state.e_tags) {
    query.query!.tags = state.tags
  }
  query.order_args!.order_by = getOrderBy(state)
  return query
}

import { createParser } from "nuqs"

const parseAsQuery = createParser({
  parse(queryValue): SearchQueryStateState {
    return JSON.parse(queryValue)
  },
  serialize(value: SearchQueryStateState) {
    return JSON.stringify(value)
  },
})

const [query, setQuery] = useQueryState("query", parseAsQuery)

interface AnyTextSettings {
  query: string
  raw_fts5_match: boolean
  enable_path_filter: boolean
  enable_et_filter: boolean
  path_filter: components["schemas"]["PathTextFilter"]
  et_filter: components["schemas"]["ExtractedTextFilter"]
}

export interface SearchQueryStateState {
  enable_search: boolean
  order_args: components["schemas"]["OrderParams"]
  any_text: AnyTextSettings
  bookmarks: components["schemas"]["BookmarksFilter"]
  paths: string[]
  types: string[]
  e_path: boolean
  e_types: boolean
  e_tags: boolean
  tags: components["schemas"]["QueryTagFilters"]
}

interface SearchQuery {
  order: components["schemas"]["OrderParams"]["order"]
}
