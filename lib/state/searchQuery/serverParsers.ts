import def, { createSearchParamsCache } from "nuqs/server"
import { components } from "@/lib/panoptikon"

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
  SearchQueryOptions,
  ATExtractedTextFilter,
  ATPathTextFilter,
  KeymapComponents,
} from "./searchQueryKeyMaps"

import { createScopedSearchParamsCache } from "../nuqsScopedWrappers/scopedQueryParamsCache"
type SearchParams = Record<string, string | string[] | undefined>

const caches = {
  orderArgs: createSearchParamsCache(orderParamsKeyMap(def as any)),
  queryOptions: createSearchParamsCache(queryOptionsKeyMap(def as any)),
}

export function getOrderArgsCache(params: SearchParams): OrderArgsType {
  return caches.orderArgs.parse(params)
}
export function getQueryOptionsCache(params: SearchParams): SearchQueryOptions {
  return caches.queryOptions.parse(params)
}

const scopedCaches = {
  tagFilters: createScopedSearchParamsCache(
    "tag",
    tagFiltersKeyMap(def as any)
  ),
  fileFilters: createScopedSearchParamsCache(
    "file",
    fileFiltersKeyMap(def as any)
  ),
  pathTextFilters: createScopedSearchParamsCache(
    "path",
    pathTextFiltersKeyMap(def as any)
  ),
  extractedTextFilters: createScopedSearchParamsCache(
    "et",
    extractedTextFiltersKeyMap(def as any)
  ),
  bookmarksFilter: createScopedSearchParamsCache(
    "bm",
    bookmarksFilterKeyMap(def as any)
  ),
  extractedTextEmbeddingsFilters: createScopedSearchParamsCache(
    "te",
    extractedTextEmbeddingsFiltersKeyMap(def as any)
  ),
  imageEmbeddingsFilters: createScopedSearchParamsCache(
    "ie",
    imageEmbeddingsFiltersKeyMap(def as any)
  ),
  anyTextPathTextFilters: createScopedSearchParamsCache(
    "at.path",
    pathTextFiltersKeyMap(def as any)
  ),
  anyTextExtractedTextFilters: createScopedSearchParamsCache(
    "at.et",
    extractedTextFiltersKeyMap(def as any)
  ),
}

export function getTagFiltersCache(
  params: SearchParams
): KeymapComponents["QueryTagFilters"] {
  return scopedCaches.tagFilters.parse(params)
}

export function getFileFiltersCache(
  params: SearchParams
): KeymapComponents["FileFilters"] {
  return scopedCaches.fileFilters.parse(params)
}

export function getPathTextFiltersCache(
  params: SearchParams
): KeymapComponents["PathTextFilter"] {
  return scopedCaches.pathTextFilters.parse(params)
}

export function getExtractedTextFiltersCache(
  params: SearchParams
): KeymapComponents["ExtractedTextFilter"] {
  return scopedCaches.extractedTextFilters.parse(params)
}

export function getBookmarksFilterCache(
  params: SearchParams
): KeymapComponents["BookmarksFilter"] {
  return scopedCaches.bookmarksFilter.parse(params)
}

export function getExtractedTextEmbeddingsFiltersCache(
  params: SearchParams
): KeymapComponents["ExtractedTextEmbeddingsFilter"] {
  return scopedCaches.extractedTextEmbeddingsFilters.parse(params)
}

export function getImageEmbeddingsFiltersCache(
  params: SearchParams
): KeymapComponents["ImageEmbeddingFilter"] {
  return scopedCaches.imageEmbeddingsFilters.parse(params)
}

export function getAnyTextPathTextFiltersCache(
  params: SearchParams
): ATPathTextFilter {
  return scopedCaches.anyTextPathTextFilters.parse(params)
}

export function getAnyTextExtractedTextFiltersCache(
  params: SearchParams
): ATExtractedTextFilter {
  return scopedCaches.anyTextExtractedTextFilters.parse(params)
}
