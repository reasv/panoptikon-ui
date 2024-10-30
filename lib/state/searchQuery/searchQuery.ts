import { components } from "../../panoptikon"
import {
  KeymapComponents,
  orderByType,
  SimilaritySideBarComponents,
} from "./searchQueryKeyMaps"

export interface OrderMetadata {
  actual_order_by: KeymapComponents["OrderArgs"]["order_by"]
  available_filter_orders: string[]
  force_order_by: boolean
}
export function queryFromState(
  state: KeymapComponents
): [components["schemas"]["PQLQuery"], OrderMetadata] {
  const queryFilters: components["schemas"]["AndOperator"] = {
    and_: [],
  }
  let actual_order_by: KeymapComponents["OrderArgs"]["order_by"] =
    getOrderBy(state)
  let available_filter_orders = [] as string[]
  let force_order_by = false
  // Match column filters
  const match_filter_ops: components["schemas"]["MatchOps"] = {}
  let add_match_filter_ops = false
  if (state.SearchQueryOptions.e_path && state.FileFilters.paths.length > 0) {
    match_filter_ops.startswith = {
      path: state.FileFilters.paths,
    }
    add_match_filter_ops = true
  }
  if (
    state.SearchQueryOptions.e_path_neg &&
    state.FileFilters.exclude_paths.length > 0
  ) {
    match_filter_ops.not_startswith = {
      path: state.FileFilters.exclude_paths,
    }
    add_match_filter_ops = true
  }
  if (
    state.SearchQueryOptions.e_mime &&
    state.FileFilters.item_types.length > 0
  ) {
    match_filter_ops.startswith = {
      ...match_filter_ops.startswith,
      type: state.FileFilters.item_types,
    }
    add_match_filter_ops = true
  }
  if (add_match_filter_ops) {
    queryFilters.and_.push({ match: match_filter_ops })
  }
  // Bookmarks
  const sort_bookmarks = state.OrderArgs.order_by === "bookmark_time"
  const bookmarks_desc: boolean = state.OrderArgs.order !== "asc"
  if (state.InBookmarks.filter) {
    const sortBookmarks: components["schemas"]["InBookmarks"] = {
      order_by: sort_bookmarks,
      direction: bookmarks_desc ? "desc" : "asc",
      priority: 0,
      row_n_direction: "asc",
      row_n: false,
      in_bookmarks: state.InBookmarks,
    }
    queryFilters.and_.push(sortBookmarks)
    if (sort_bookmarks) {
      actual_order_by = "bookmark_time"
    }
    available_filter_orders.push("bookmark_time")
  }
  // Match Path text
  const sort_path = state.OrderArgs.order_by === "match_path"
  const path_match_asc: boolean = state.OrderArgs.order !== "desc"
  if (state.SearchQueryOptions.e_pt && state.MatchPath.match.length > 0) {
    const matchPath: components["schemas"]["MatchPath"] = {
      order_by: sort_path,
      direction: path_match_asc ? "asc" : "desc",
      priority: 0,
      row_n_direction: "asc",
      row_n: false,
      match_path: state.MatchPath,
    }
    queryFilters.and_.push(matchPath)
    if (sort_path) {
      actual_order_by = "match_path"
    }
    available_filter_orders.push("match_path")
  }
  // Match Text
  const sort_text = state.OrderArgs.order_by === "match_text"
  const text_match_asc: boolean = state.OrderArgs.order !== "desc"
  if (state.SearchQueryOptions.e_txt && state.MatchText.match.length > 0) {
    const matchText: components["schemas"]["MatchText"] = {
      order_by: sort_text,
      direction: text_match_asc ? "asc" : "desc",
      priority: 0,
      row_n_direction: "asc",
      row_n: false,
      match_text: state.MatchText,
    }
    queryFilters.and_.push(matchText)
    if (sort_text) {
      actual_order_by = "match_text"
    }
    available_filter_orders.push("match_text")
  }
  // Match Tags
  const sort_tags = state.OrderArgs.order_by === "match_tags_confidence"
  const tags_match_desc: boolean = state.OrderArgs.order !== "asc"
  if (state.SearchQueryOptions.e_tags) {
    const sortArgs: Omit<components["schemas"]["MatchText"], "match_text"> = {
      order_by: sort_tags ? true : false,
      direction: tags_match_desc ? "desc" : "asc",
      priority: 50,
      row_n_direction: "asc",
      row_n: false,
    }
    let tag_filter_enabled = false
    if (state.MatchTags.pos_match_all.length > 0) {
      const matchTags: components["schemas"]["MatchTags"] = {
        ...sortArgs,
        match_tags: {
          ...state.MatchTags,
          match_any: false,
          tags: state.MatchTags.pos_match_all,
        },
      }
      queryFilters.and_.push(matchTags)
      tag_filter_enabled = true
    }
    if (state.MatchTags.pos_match_any.length > 0) {
      const matchTags: components["schemas"]["MatchTags"] = {
        ...sortArgs,
        match_tags: {
          ...state.MatchTags,
          match_any: true,
          tags: state.MatchTags.pos_match_any,
        },
      }
      queryFilters.and_.push(matchTags)
      tag_filter_enabled = true
    }
    if (state.MatchTags.neg_match_all.length > 0) {
      const matchTags: components["schemas"]["MatchTags"] = {
        ...sortArgs,
        match_tags: {
          ...state.MatchTags,
          match_any: false,
          tags: state.MatchTags.neg_match_all,
        },
      }
      queryFilters.and_.push({ not_: matchTags })
      tag_filter_enabled = true
    }
    if (state.MatchTags.neg_match_any.length > 0) {
      const matchTags: components["schemas"]["MatchTags"] = {
        ...sortArgs,
        match_tags: {
          ...state.MatchTags,
          match_any: true,
          tags: state.MatchTags.neg_match_any,
        },
      }
      queryFilters.and_.push({ not_: matchTags })
      tag_filter_enabled = true
    }
    if (tag_filter_enabled) {
      if (sort_tags) {
        actual_order_by = "match_tags_confidence"
      }
      available_filter_orders.push("match_tags_confidence")
    }
  }
  // Semantic Image Search
  const sort_image = true // Must always sort by this since it's semantic search
  const image_match_asc: boolean = state.OrderArgs.order !== "desc"
  if (
    state.SearchQueryOptions.e_iemb &&
    state.SemanticImageSearch.query &&
    state.SemanticImageSearch.model.length > 0
  ) {
    const searchSemanticImage: components["schemas"]["SemanticImageSearch"] = {
      order_by: sort_image,
      direction: image_match_asc ? "asc" : "desc",
      priority: 60,
      row_n_direction: "asc",
      row_n: false,
      image_embeddings: {
        ...state.SemanticImageSearch,
        embed: state.EmbedArgs,
      },
    }
    queryFilters.and_.push(searchSemanticImage)
    if (sort_image) {
      actual_order_by = "search_semantic_image"
      force_order_by = true
    }
    available_filter_orders = ["search_semantic_image"]
  }
  // Semantic Text Search
  const sort_semantic_text = true // Must always sort by this since it's semantic search
  const semantic_text_match_asc: boolean = state.OrderArgs.order !== "desc"
  if (
    state.SearchQueryOptions.e_temb &&
    state.SemanticTextSearch.query &&
    state.SemanticTextSearch.model.length > 0
  ) {
    const searchSemanticText: components["schemas"]["SemanticTextSearch"] = {
      order_by: sort_semantic_text,
      direction: semantic_text_match_asc ? "asc" : "desc",
      priority: 60,
      row_n_direction: "asc",
      row_n: false,
      text_embeddings: {
        ...state.SemanticTextSearch,
        src_text: sourceFilters(state.SemanticTextSource),
        embed: state.EmbedArgs,
      },
    }
    queryFilters.and_.push(searchSemanticText)
    if (sort_semantic_text) {
      actual_order_by = "search_semantic_text"
      force_order_by = true
    }
    available_filter_orders = ["search_semantic_text"]
  }
  // Flexible search
  let at_order_by = state.OrderArgs.order_by === "match_at"
  if (state.SearchQueryOptions.at_e_st || state.SearchQueryOptions.at_e_si) {
    at_order_by = true // Must always sort by this since it's semantic search
    available_filter_orders = ["match_at"]
    force_order_by = true
  } else {
    available_filter_orders.push("match_at")
  }
  const at_asc: boolean = state.OrderArgs.order !== "desc"
  if (state.SearchQueryOptions.at_query) {
    let n_at_enabled = 0
    if (state.SearchQueryOptions.at_e_path) {
      n_at_enabled++
    }
    if (state.SearchQueryOptions.at_e_txt) {
      n_at_enabled++
    }
    if (state.SearchQueryOptions.at_e_st) {
      n_at_enabled++
    }
    if (state.SearchQueryOptions.at_e_si) {
      n_at_enabled++
    }
    const at_filter: components["schemas"]["OrOperator"] = { or_: [] }
    let direction: "asc" | "desc" = at_asc ? "asc" : "desc"
    // If more than one filter is enabled,
    // We have to flip the direction since RRF will be used to sort
    if (n_at_enabled > 1) {
      direction = direction === "asc" ? "desc" : "asc"
    }
    const sortArgs: Omit<components["schemas"]["MatchText"], "match_text"> =
      at_order_by
        ? {
            order_by: true,
            direction,
            priority: 100,
            row_n_direction: "asc",
            // Only use row_n if more than one AT filter is enabled
            row_n: n_at_enabled > 1 ? true : false,
          }
        : {
            order_by: false,
            direction: "asc",
            priority: 0,
            row_n_direction: "asc",
            row_n: false,
          }

    const matchPath: components["schemas"]["MatchPath"] = {
      ...sortArgs,
      rrf: at_order_by ? state.ATPathRRF : undefined,
      match_path: {
        ...state.ATMatchPath,
        match: state.SearchQueryOptions.at_query,
        raw_fts5_match: state.SearchQueryOptions.at_fts5,
      },
    }
    if (state.SearchQueryOptions.at_e_path) {
      at_filter.or_.push(matchPath)
    }
    const matchText: components["schemas"]["MatchText"] = {
      ...sortArgs,
      rrf: at_order_by ? state.ATTextRRF : undefined,
      match_text: {
        ...state.ATMatchText,
        match: state.SearchQueryOptions.at_query,
        raw_fts5_match: state.SearchQueryOptions.at_fts5,
      },
    }
    if (state.SearchQueryOptions.at_e_txt) {
      at_filter.or_.push(matchText)
    }
    const searchSemanticImage: components["schemas"]["SemanticImageSearch"] = {
      ...sortArgs,
      rrf: at_order_by ? state.ATSemanticImageRRF : undefined,
      image_embeddings: {
        ...state.ATSemanticImage,
        query: state.SearchQueryOptions.at_query,
        embed: state.EmbedArgs,
      },
    }
    if (
      state.SearchQueryOptions.at_e_si &&
      state.ATSemanticImage.model.length > 0
    ) {
      at_filter.or_.push(searchSemanticImage)
    }
    const searchSemanticText: components["schemas"]["SemanticTextSearch"] = {
      ...sortArgs,
      rrf: at_order_by ? state.ATSemanticTextRRF : undefined,
      text_embeddings: {
        ...state.ATSemanticText,
        query: state.SearchQueryOptions.at_query,
        src_text: sourceFilters(state.ATSourceText),
        embed: state.EmbedArgs,
      },
    }
    if (
      state.SearchQueryOptions.at_e_st &&
      state.ATSemanticText.model.length > 0
    ) {
      at_filter.or_.push(searchSemanticText)
    }
    if (at_filter.or_.length > 0) {
      queryFilters.and_.push(at_filter)
      if (at_order_by) {
        actual_order_by = "match_at"
      }
    }
  }
  // Item Similarity Search
  const sort_iss = true // Must always sort by this since it's semantic search
  const iss_match_asc: boolean = state.OrderArgs.order !== "desc"
  if (
    state.SearchQueryOptions.e_iss &&
    state.ItemSimilarity.target.length > 0 &&
    state.ItemSimilarity.model.length > 0
  ) {
    let src_text = sourceFilters(state.ItemSimilarityTextSource)
    if (state.ItemSimilarity.distance_function === "COSINE") {
      if (!state.ItemSimilarity.clip_xmodal) {
        src_text = null
      }
    }
    const searchItemSimilarity: components["schemas"]["SimilarTo"] = {
      order_by: sort_iss,
      direction: iss_match_asc ? "asc" : "desc",
      priority: 150,
      row_n_direction: "asc",
      row_n: false,
      similar_to: {
        ...state.ItemSimilarity,
        src_text,
      },
    }
    queryFilters.and_.push(searchItemSimilarity)
    if (sort_iss) {
      actual_order_by = "search_item_similarity"
      force_order_by = true
    }
    available_filter_orders = ["search_item_similarity"]
  }
  const query: components["schemas"]["PQLQuery"] = {
    query: queryFilters,
    order_by: [
      {
        order_by: getOrderBy(state),
        order: state.OrderArgs.order,
        priority: 0,
      },
    ],
    select: [
      "sha256",
      "path",
      "last_modified",
      "type",
      "width",
      "height",
      "blurhash",
    ],
    entity: "file",

    page: state.OrderArgs.page,
    page_size: state.OrderArgs.page_size,
    count: true,
    results: true,
    check_path: false,
  }
  return [query, { actual_order_by, available_filter_orders, force_order_by }]
}

export function getOrderBy(state: KeymapComponents): orderByType {
  const current_order_by = state.OrderArgs.order_by
  const def: orderByType = "last_modified"

  if (current_order_by === null) {
    return def
  }

  const disallowedOrders = [
    "bookmark_time",
    "match_at",
    "match_text",
    "match_path",
    "match_tags_confidence",
    "search_semantic_text",
    "search_semantic_image",
    "search_item_similarity",
  ] as const

  if (
    disallowedOrders.includes(
      current_order_by as (typeof disallowedOrders)[number]
    )
  ) {
    return def
  }

  return current_order_by as orderByType
}

function sourceFilters(source: components["schemas"]["SourceArgs"]) {
  // If none of the filters are enabled, return null
  if (source.confidence_weight && source.confidence_weight !== 0) {
    return source
  }
  if (
    source.language_confidence_weight &&
    source.language_confidence_weight !== 0
  ) {
    return source
  }
  if (source.languages && source.languages.length > 0) {
    return source
  }
  if (source.max_length && source.max_length > 0) {
    return source
  }
  if (source.min_length && source.min_length > 0) {
    return source
  }
  if (source.min_language_confidence && source.min_language_confidence > 0) {
    return source
  }
  if (source.min_confidence && source.min_confidence > 0) {
    return source
  }
  if (source.setters && source.setters.length > 0) {
    return source
  }
  return null
}

export function sbSimilarityQueryFromState(state: SimilaritySideBarComponents) {
  const query: components["schemas"]["PQLQuery"] = {
    query: null,
    page: 1,
    page_size: 10,
    order_by: [
      {
        order_by: "last_modified",
        order: null,
        priority: 0,
      },
    ],
    select: [
      "sha256",
      "path",
      "last_modified",
      "type",
      "width",
      "height",
      "blurhash",
    ],
    entity: "file",
    count: false,
    results: true,
    check_path: false,
  }
  const clip: (
    target: string,
    modelFallback: string
  ) => components["schemas"]["PQLQuery"] = (
    target: string,
    modelFallback: string
  ) => ({
    ...query,
    page: state.PageArgs.page_clip,
    page_size: state.PageArgs.page_size_clip,
    query: {
      and_: [
        {
          order_by: true,
          direction: "asc",
          priority: 150,
          row_n_direction: "asc",
          row_n: false,
          similar_to: {
            ...state.CLIPSimilarity,
            target,
            model:
              state.CLIPSimilarity.model.length > 0
                ? state.CLIPSimilarity.model
                : modelFallback,
            distance_function: "COSINE",
            src_text: state.CLIPSimilarity.clip_xmodal
              ? sourceFilters(state.CLIPTextSource)
              : null,
          },
        },
      ],
    },
  })
  const text: (
    target: string,
    modelFallback: string
  ) => components["schemas"]["PQLQuery"] = (
    target: string,
    modelFallback: string
  ) => ({
    ...query,
    page: state.PageArgs.page_text,
    page_size: state.PageArgs.page_size_text,
    query: {
      and_: [
        {
          order_by: true,
          direction: "asc",
          priority: 150,
          row_n_direction: "asc",
          row_n: false,
          similar_to: {
            ...state.TextSimilarity,
            target,
            model:
              state.TextSimilarity.model.length > 0
                ? state.TextSimilarity.model
                : modelFallback,
            clip_xmodal: false,
            xmodal_i2i: true,
            xmodal_t2t: true,
            distance_function: "L2",
            src_text: sourceFilters(state.TextSource),
          },
        },
      ],
    },
  })
  return { clip, text }
}
