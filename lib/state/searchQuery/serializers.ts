import { createSerializer } from "nuqs/server"
import * as def from "nuqs/server"
import {
  OrderArgsType,
  orderParamsKeyMap,
  tagFiltersKeyMap,
  fileFiltersKeyMap,
  pathTextFiltersKeyMap,
  extractedTextFiltersKeyMap,
  bookmarksFilterKeyMap,
  extractedTextEmbeddingsFiltersKeyMap,
  imageEmbeddingsFiltersKeyMap,
  queryOptionsKeyMap,
} from "./searchQueryKeyMaps"
import { createScopedSerializer } from "../nuqsScopedWrappers/scopedSerializer"
import { ReadonlyURLSearchParams } from "next/navigation"

export const serializers = {
  orderArgs: createSerializer(orderParamsKeyMap(def)),
  queryOptions: createSerializer(queryOptionsKeyMap(def)),
  tagFilters: createScopedSerializer("tag", tagFiltersKeyMap(def)),
  fileFilters: createScopedSerializer("file", fileFiltersKeyMap(def)),
  pathTextFilters: createScopedSerializer("path", pathTextFiltersKeyMap(def)),
  extractedTextFilters: createScopedSerializer(
    "et",
    extractedTextFiltersKeyMap(def)
  ),
  bookmarksFilter: createScopedSerializer("bm", bookmarksFilterKeyMap(def)),
  extractedTextEmbeddingsFilters: createScopedSerializer(
    "te",
    extractedTextEmbeddingsFiltersKeyMap(def)
  ),
  imageEmbeddingsFilters: createScopedSerializer(
    "ie",
    imageEmbeddingsFiltersKeyMap(def)
  ),
  anyTextPathTextFilters: createScopedSerializer(
    "at.path",
    pathTextFiltersKeyMap(def)
  ),
  anyTextExtractedTextFilters: createScopedSerializer(
    "at.et",
    extractedTextFiltersKeyMap(def)
  ),
}

export const getSearchPageURL = (
  base: ReadonlyURLSearchParams | URLSearchParams,
  newPage: number
) => {
  const queryParams = new URLSearchParams(base)
  serializers.orderArgs(queryParams, {
    page: newPage,
  })
}
