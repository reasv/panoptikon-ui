import { createSerializer } from "nuqs/server"
import * as def from "nuqs/server"
import {
  OrderArgsType,
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
  itemSimilarityKeyMap,
  rrfKeyMap,
  similaritySBPageArgsKeyMap,
} from "./searchQueryKeyMaps"
import { createScopedSerializer } from "../nuqsScopedWrappers/scopedSerializer"
import { ReadonlyURLSearchParams } from "next/navigation"

export const serializers = {
  embedArgs: createSerializer(embedArgsKeyMap(def)),
  orderArgs: createSerializer(orderParamsKeyMap(def)),
  queryOptions: createSerializer(queryOptionsKeyMap(def)),
  matchTags: createScopedSerializer("tag", tagFiltersKeyMap(def)),
  fileFilters: createScopedSerializer("file", fileFiltersKeyMap(def)),
  matchPath: createScopedSerializer("path", matchPathKeyMap(def)),
  matchText: createScopedSerializer("txt", matchTextKeyMap(def)),
  inBookmarks: createScopedSerializer("bm", inBookmarksKeyMap(def)),
  semanticTextSearch: createScopedSerializer(
    "st",
    semanticTextSearchKeyMap(def)
  ),
  semanticTextSource: createScopedSerializer("st.src", sourceTextKeyMap(def)),
  semanticImageSearch: createScopedSerializer(
    "si",
    semanticImageSearchKeyMap(def)
  ),
  itemSimilaritySearch: createScopedSerializer(
    "iss",
    itemSimilarityKeyMap(def)
  ),
  itemSimilarityTextSource: createScopedSerializer(
    "iss.src",
    sourceTextKeyMap(def)
  ),
  atMatchPath: createScopedSerializer("at.path", matchPathKeyMap(def)),
  atTextRRF: createScopedSerializer("at.txt.rrf", rrfKeyMap(def)),
  atPathRRF: createScopedSerializer("at.path.rrf", rrfKeyMap(def)),
  atSemanticTextRRF: createScopedSerializer("at.st.rrf", rrfKeyMap(def)),
  atSemanticImageRRF: createScopedSerializer("at.si.rrf", rrfKeyMap(def)),
  atMatchText: createScopedSerializer("at.txt", matchTextKeyMap(def)),
  atSemanticText: createScopedSerializer(
    "at.st",
    semanticTextSearchKeyMap(def)
  ),
  atSemanticTextSource: createScopedSerializer(
    "at.st.src",
    sourceTextKeyMap(def)
  ),
  atSemanticImage: createScopedSerializer(
    "at.si",
    semanticImageSearchKeyMap(def)
  ),
}

export const getSearchPageURL = (
  base: ReadonlyURLSearchParams | URLSearchParams,
  newPage: number
) => {
  const queryParams = new URLSearchParams(base)
  return serializers.orderArgs(queryParams, {
    page: newPage,
  })
}

// Similarity sidebar
export const sbSimilaritySerializers = {
  CLIPSimilarity: createScopedSerializer(
    "sb.iss.clip",
    itemSimilarityKeyMap(def)
  ),
  CLIPTextSource: createScopedSerializer(
    "sb.iss.clip.src",
    sourceTextKeyMap(def)
  ),
  TextSimilarity: createScopedSerializer(
    "sb.iss.txt",
    itemSimilarityKeyMap(def)
  ),
  TextSource: createScopedSerializer("sb.iss.txt.src", sourceTextKeyMap(def)),
  PageArgs: createScopedSerializer("sb.iss", similaritySBPageArgsKeyMap(def)),
}
