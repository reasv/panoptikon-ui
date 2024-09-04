import def, { Options } from "nuqs"
import { components } from "@/lib/panoptikon"

import { useQueryStates, useQueryState } from "nuqs"
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
} from "./searchQueryKeyMaps"
import { useScopedQueryStates } from "../scopedQueryStates"

type Nullable<T> = {
  [K in keyof T]: T[K] | null
}

type UpdaterFn<T> = (old: T) => Partial<Nullable<T>>

type SetFn<T> = (
  values: Partial<Nullable<T>> | UpdaterFn<T>,
  options?: Options
) => Promise<URLSearchParams>

export function useOrderArgs(): [OrderArgsType, SetFn<OrderArgsType>] {
  const [state, set] = useQueryStates(orderParamsKeyMap(def as any))
  return [state, set] as [OrderArgsType, SetFn<OrderArgsType>]
}

export function useTagFilter(): [
  components["schemas"]["QueryTagFilters"],
  SetFn<components["schemas"]["QueryTagFilters"]>
] {
  const [state, set] = useScopedQueryStates("tag", tagFiltersKeyMap(def as any))
  return [state, set] as const
}

export function useFileFilters(): [
  components["schemas"]["FileFilters"],
  SetFn<components["schemas"]["FileFilters"]>
] {
  const [state, set] = useScopedQueryStates(
    "file",
    fileFiltersKeyMap(def as any)
  )
  return [state, set] as const
}

export function usePathTextFilters(): [
  components["schemas"]["PathTextFilter"],
  SetFn<components["schemas"]["PathTextFilter"]>
] {
  const [state, set] = useScopedQueryStates(
    "path",
    pathTextFiltersKeyMap(def as any)
  )
  return [state, set] as const
}

export function useExtractedTextFilters(): [
  components["schemas"]["ExtractedTextFilter"],
  SetFn<components["schemas"]["ExtractedTextFilter"]>
] {
  const [state, set] = useScopedQueryStates(
    "et",
    extractedTextFiltersKeyMap(def as any)
  )
  return [state, set] as const
}

export function useBookmarksFilter(): [
  components["schemas"]["BookmarksFilter"],
  SetFn<components["schemas"]["BookmarksFilter"]>
] {
  const [state, set] = useScopedQueryStates(
    "bm",
    bookmarksFilterKeyMap(def as any)
  )
  return [state, set] as const
}

export function useExtractedTextEmbeddingsFilters(): [
  components["schemas"]["ExtractedTextEmbeddingsFilter"],
  SetFn<components["schemas"]["ExtractedTextEmbeddingsFilter"]>
] {
  const [state, set] = useScopedQueryStates(
    "te",
    extractedTextEmbeddingsFiltersKeyMap(def as any)
  )
  return [state, set] as const
}

export function useImageEmbeddingsFilters(): [
  components["schemas"]["ImageEmbeddingFilter"],
  SetFn<components["schemas"]["ImageEmbeddingFilter"]>
] {
  const [state, set] = useScopedQueryStates(
    "ie",
    imageEmbeddingsFiltersKeyMap(def as any)
  )
  return [state, set] as const
}

export function useQueryOptions(): [
  SearchQueryOptions,
  SetFn<SearchQueryOptions>
] {
  const [state, set] = useQueryStates(queryOptionsKeyMap(def as any))
  return [state, set] as const
}

export function useAnyTextPathTextFilters(): [
  ATPathTextFilter,
  SetFn<ATPathTextFilter>
] {
  const [state, set] = useScopedQueryStates(
    "at.path",
    pathTextFiltersKeyMap(def as any)
  )
  return [state, set] as const
}

export function useAnyTextExtractedTextFilters(): [
  ATExtractedTextFilter,
  SetFn<ATExtractedTextFilter>
] {
  const [state, set] = useScopedQueryStates(
    "at.et",
    extractedTextFiltersKeyMap(def as any)
  )
  return [state, set] as const
}
