import * as def from "nuqs/server"
import { createSearchParamsCache } from "nuqs/server"
import {
  orderParamsKeyMap,
  tagFiltersKeyMap,
  fileFiltersKeyMap,
  matchPathKeyMap,
  matchTextKeyMap,
  inBookmarksKeyMap,
  semanticTextSearchKeyMap,
  semanticImageSearchKeyMap,
  queryOptionsKeyMap,
  embedArgsKeyMap,
  sourceTextKeyMap,
  SearchQueryOptions,
  ATMatchText,
  ATMatchPath,
  KeymapComponents,
  itemSimilarityKeyMap,
  rrfKeyMap,
  SimilaritySideBarComponents,
  similaritySBPageArgsKeyMap,
} from "./searchQueryKeyMaps"

import { createScopedSearchParamsCache } from "../nuqsScopedWrappers/scopedQueryParamsCache"
import { queryFromState, sbSimilarityQueryFromState } from "./searchQuery"
import { get } from "http"
export type SearchParams = Record<string, string | string[] | undefined>

const caches = {
  orderArgs: createSearchParamsCache(orderParamsKeyMap(def as any)),
  queryOptions: createSearchParamsCache(queryOptionsKeyMap(def as any)),
  embedArgs: createSearchParamsCache(embedArgsKeyMap(def as any)),
}

export function getOrderArgsCache(
  params: SearchParams
): KeymapComponents["OrderArgs"] {
  return caches.orderArgs.parse(params)
}

export function getQueryOptionsCache(params: SearchParams): SearchQueryOptions {
  return caches.queryOptions.parse(params)
}

export function getEmbedArgsCache(
  params: SearchParams
): KeymapComponents["EmbedArgs"] {
  return caches.embedArgs.parse(params)
}

const scopedCaches = {
  matchTags: createScopedSearchParamsCache("tag", tagFiltersKeyMap(def as any)),
  fileFilters: createScopedSearchParamsCache(
    "file",
    fileFiltersKeyMap(def as any)
  ),
  matchPath: createScopedSearchParamsCache("path", matchPathKeyMap(def as any)),
  matchText: createScopedSearchParamsCache("txt", matchTextKeyMap(def as any)),
  inBookmarks: createScopedSearchParamsCache(
    "bm",
    inBookmarksKeyMap(def as any)
  ),
  semanticTextSearch: createScopedSearchParamsCache(
    "st",
    semanticTextSearchKeyMap(def as any)
  ),
  semanticTextSource: createScopedSearchParamsCache(
    "st.src",
    sourceTextKeyMap(def as any)
  ),
  semanticImageSearch: createScopedSearchParamsCache(
    "si",
    semanticImageSearchKeyMap(def as any)
  ),
  atMatchPath: createScopedSearchParamsCache(
    "at.path",
    matchPathKeyMap(def as any)
  ),
  atMatchText: createScopedSearchParamsCache(
    "at.txt",
    matchTextKeyMap(def as any)
  ),
  atTextRRF: createScopedSearchParamsCache("at.txt.rrf", rrfKeyMap(def as any)),
  atPathRRF: createScopedSearchParamsCache(
    "at.path.rrf",
    rrfKeyMap(def as any)
  ),
  atSemanticTextRRF: createScopedSearchParamsCache(
    "at.st.rrf",
    rrfKeyMap(def as any)
  ),
  atSemanticImageRRF: createScopedSearchParamsCache(
    "at.si.rrf",
    rrfKeyMap(def as any)
  ),
  atSemanticText: createScopedSearchParamsCache(
    "at.st",
    semanticTextSearchKeyMap(def as any)
  ),
  atSemanticTextSource: createScopedSearchParamsCache(
    "at.st.src",
    sourceTextKeyMap(def as any)
  ),
  atSemanticImage: createScopedSearchParamsCache(
    "at.si",
    semanticImageSearchKeyMap(def as any)
  ),
  itemSimilarity: createScopedSearchParamsCache(
    "iss",
    itemSimilarityKeyMap(def as any)
  ),
  itemSimilarityTextSource: createScopedSearchParamsCache(
    "iss.src",
    sourceTextKeyMap(def as any)
  ),
}

export function getMatchTagsCache(
  params: SearchParams
): KeymapComponents["MatchTags"] {
  return scopedCaches.matchTags.parse(params)
}

export function getFileFiltersCache(
  params: SearchParams
): KeymapComponents["FileFilters"] {
  return scopedCaches.fileFilters.parse(params)
}

export function getMatchPathCache(
  params: SearchParams
): KeymapComponents["MatchPath"] {
  return scopedCaches.matchPath.parse(params)
}

export function getMatchTextCache(
  params: SearchParams
): KeymapComponents["MatchText"] {
  return scopedCaches.matchText.parse(params)
}

export function getInBookmarksCache(
  params: SearchParams
): KeymapComponents["InBookmarks"] {
  return scopedCaches.inBookmarks.parse(params)
}

export function getSemanticTextSearchCache(
  params: SearchParams
): KeymapComponents["SemanticTextSearch"] {
  return scopedCaches.semanticTextSearch.parse(params)
}

export function getSemanticTextSourceCache(
  params: SearchParams
): KeymapComponents["SemanticTextSource"] {
  return scopedCaches.semanticTextSource.parse(params)
}

export function getSemanticImageSearchCache(
  params: SearchParams
): KeymapComponents["SemanticImageSearch"] {
  return scopedCaches.semanticImageSearch.parse(params)
}
export function getItemSimilaritySearchCache(
  params: SearchParams
): KeymapComponents["ItemSimilarity"] {
  return scopedCaches.itemSimilarity.parse(params)
}
export function getItemSimilarityTextSourceCache(
  params: SearchParams
): KeymapComponents["ItemSimilarityTextSource"] {
  return scopedCaches.itemSimilarityTextSource.parse(params)
}

export function getATMatchPathCache(params: SearchParams): ATMatchPath {
  return scopedCaches.atMatchPath.parse(params)
}

export function getATMatchTextCache(params: SearchParams): ATMatchText {
  return scopedCaches.atMatchText.parse(params)
}

export function getATSemanticTextCache(
  params: SearchParams
): KeymapComponents["ATSemanticText"] {
  return scopedCaches.atSemanticText.parse(params)
}

export function getATSemanticTextSourceCache(
  params: SearchParams
): KeymapComponents["ATSourceText"] {
  return scopedCaches.atSemanticTextSource.parse(params)
}

export function getATSemanticImageCache(
  params: SearchParams
): KeymapComponents["ATSemanticImage"] {
  return scopedCaches.atSemanticImage.parse(params)
}

export function getFullQueryCache(params: SearchParams): KeymapComponents {
  return {
    MatchText: getMatchTextCache(params),
    MatchPath: getMatchPathCache(params),
    OrderArgs: getOrderArgsCache(params),
    MatchTags: getMatchTagsCache(params),
    FileFilters: getFileFiltersCache(params),
    InBookmarks: getInBookmarksCache(params),
    SemanticTextSearch: getSemanticTextSearchCache(params),
    SemanticTextSource: getSemanticTextSourceCache(params),
    SemanticImageSearch: getSemanticImageSearchCache(params),
    SearchQueryOptions: getQueryOptionsCache(params),
    EmbedArgs: getEmbedArgsCache(params),
    ATMatchText: getATMatchTextCache(params),
    ATTextRRF: scopedCaches.atTextRRF.parse(params),
    ATMatchPath: getATMatchPathCache(params),
    ATPathRRF: scopedCaches.atPathRRF.parse(params),
    ATSemanticText: getATSemanticTextCache(params),
    ATSemanticTextRRF: scopedCaches.atSemanticTextRRF.parse(params),
    ATSemanticImage: getATSemanticImageCache(params),
    ATSemanticImageRRF: scopedCaches.atSemanticImageRRF.parse(params),
    ATSourceText: getATSemanticTextSourceCache(params),
    ItemSimilarity: getItemSimilaritySearchCache(params),
    ItemSimilarityTextSource: getItemSimilarityTextSourceCache(params),
  }
}

export function getSearchQueryCache(params: SearchParams) {
  return queryFromState(getFullQueryCache(params))[0]
}

// Similarity sidebar
const similaritySBCaches = {
  CLIPSimilarity: createScopedSearchParamsCache(
    "sb.iss.clip",
    itemSimilarityKeyMap(def as any)
  ),
  CLIPTextSource: createScopedSearchParamsCache(
    "sb.iss.clip.src",
    sourceTextKeyMap(def as any)
  ),
  TextSimilarity: createScopedSearchParamsCache(
    "sb.iss.txt",
    itemSimilarityKeyMap(def as any)
  ),
  TextSource: createScopedSearchParamsCache(
    "sb.iss.txt.src",
    sourceTextKeyMap(def as any)
  ),
  PageArgs: createScopedSearchParamsCache(
    "sb.iss",
    similaritySBPageArgsKeyMap(def as any)
  ),
}
export function getFullSimilaritySBQueryCache(
  params: SearchParams
): SimilaritySideBarComponents {
  return {
    CLIPSimilarity: similaritySBCaches.CLIPSimilarity.parse(params),
    CLIPTextSource: similaritySBCaches.CLIPTextSource.parse(params),
    TextSimilarity: similaritySBCaches.TextSimilarity.parse(params),
    TextSource: similaritySBCaches.TextSource.parse(params),
    PageArgs: similaritySBCaches.PageArgs.parse(params),
  }
}

export function getSimilaritySBQueryCache(params: SearchParams) {
  return sbSimilarityQueryFromState(getFullSimilaritySBQueryCache(params))
}
