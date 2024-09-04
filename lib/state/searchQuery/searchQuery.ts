import { components } from "../../panoptikon"
import { KeymapComponents } from "./searchQueryKeyMaps"

export function queryFromState(
  state: KeymapComponents
): components["schemas"]["SearchQuery"] {
  const query: Required<components["schemas"]["SearchQuery"]> = {
    order_args: {
      ...state.OrderParams,
    },
    count: true,
    check_path: true,
    query: {
      filters: {
        any_text: {},
      },
    },
  }
  if (getIsAnyTextEnabled(state)) {
    if (state.SearchQueryOptions.at_e_path) {
      query.query.filters!.any_text!.path = {
        ...state.ATPathTextFilter,
        query: state.SearchQueryOptions.at_query,
        raw_fts5_match: state.SearchQueryOptions.at_fts5,
      }
    }
    if (state.SearchQueryOptions.at_e_et) {
      query.query!.filters!.any_text!.extracted_text = {
        ...state.ATExtractedTextFilter,
        query: state.SearchQueryOptions.at_query,
        raw_fts5_match: state.SearchQueryOptions.at_fts5,
      }
    }
  }
  if (state.BookmarksFilter.restrict_to_bookmarks) {
    query.query!.filters!.bookmarks = { ...state.BookmarksFilter }
  }
  if (getIsPathPrefixEnabled(state)) {
    query.query!.filters!.files = {
      include_path_prefixes: state.FileFilters.include_path_prefixes,
    }
  }
  if (getIsTypePrefixEnabled(state)) {
    query.query!.filters!.files = {
      ...query.query!.filters!.files,
      item_types: state.FileFilters.item_types,
    }
  }
  if (state.SearchQueryOptions.e_tags) {
    query.query!.tags = state.QueryTagFilters
  }
  if (
    state.SearchQueryOptions.e_temb &&
    state.ExtractedTextEmbeddingsFilter.query
  ) {
    query.query!.filters!.extracted_text_embeddings = {
      ...state.ExtractedTextEmbeddingsFilter,
    }
  }
  if (state.SearchQueryOptions.e_iemb && state.ImageEmbeddingFilter.query) {
    query.query!.filters!.image_embeddings = {
      ...state.ImageEmbeddingFilter,
    }
  }
  if (state.SearchQueryOptions.e_path && state.PathTextFilter.query) {
    query.query!.filters!.path = {
      ...state.PathTextFilter,
    }
  }
  if (state.SearchQueryOptions.e_et && state.ExtractedTextFilter.query) {
    query.query!.filters!.extracted_text = {
      ...state.ExtractedTextFilter,
    }
  }
  query.order_args!.order_by = getOrderBy(state)
  return query
}

export function getOrderBy(state: KeymapComponents) {
  const current_order_by = state.OrderParams.order_by
  const def = "last_modified"
  if (current_order_by === null) {
    return def
  }
  if (current_order_by === "rank_any_text") {
    if (!getIsAnyTextEnabled(state)) {
      return def
    }
  }
  if (current_order_by === "time_added") {
    if (!state.BookmarksFilter.restrict_to_bookmarks) {
      return def
    }
  }
  return current_order_by
}

function getIsPathPrefixEnabled(state: KeymapComponents) {
  return (
    state.FileFilters.include_path_prefixes.length > 0 &&
    state.SearchQueryOptions.e_path
  )
}

function getIsTypePrefixEnabled(state: KeymapComponents) {
  return (
    state.FileFilters.item_types.length > 0 && state.SearchQueryOptions.e_mime
  )
}

function getIsAnyTextEnabled(state: KeymapComponents) {
  return (
    (state.SearchQueryOptions.at_e_et || state.SearchQueryOptions.at_e_path) &&
    state.SearchQueryOptions.at_query !== ""
  )
}
