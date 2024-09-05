import { createScopedSearchParamsCache } from "../nuqsScopedWrappers/scopedQueryParamsCache"
import { SearchParams } from "../searchQuery/serverParsers"
import { similarityQueryFromState } from "./similarityQuery"
import {
  similarityQueryOptionsKeymap,
  similarityQuerySourceKeymap,
} from "./similarityQueryKeyMaps"
import * as def from "nuqs"

export const similarityCaches = {
  similarityOptions: createScopedSearchParamsCache(
    "is",
    similarityQueryOptionsKeymap(def as any)
  ),
  similaritySource: createScopedSearchParamsCache(
    "is.src",
    similarityQuerySourceKeymap(def as any)
  ),
}

export function getSimilarityQueryCache(params: SearchParams) {
  return similarityQueryFromState({
    similarityOptions: similarityCaches.similarityOptions.parse(params),
    similaritySource: similarityCaches.similaritySource.parse(params),
  })
}
export function getSimilarityOptionsCache(params: SearchParams) {
  return similarityCaches.similarityOptions.parse(params)
}
