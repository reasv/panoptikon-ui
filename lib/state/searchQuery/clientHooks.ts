import { Options, useQueryState } from "nuqs"
import * as def from "nuqs"

import { useQueryStates } from "nuqs"
import {
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
  AnyTextFilterOptions,
  KeymapComponents,
  embedArgsKeyMap,
} from "./searchQueryKeyMaps"
import { useScopedQueryStates } from "../nuqsScopedWrappers/scopedQueryStates"
import { getOrderBy, queryFromState } from "./searchQuery"

export type Nullable<T> = {
  [K in keyof T]: T[K] | null
}

type UpdaterFn<T> = (old: T) => Partial<Nullable<T>>

export type SetFn<T> = (
  values: Partial<Nullable<T>> | UpdaterFn<T> | null,
  options?: Options
) => Promise<URLSearchParams>

export function useOrderArgs(): [
  KeymapComponents["OrderParams"],
  SetFn<KeymapComponents["OrderParams"]>
] {
  const [state, set] = useQueryStates(orderParamsKeyMap(def as any))
  return [state, set] as [
    KeymapComponents["OrderParams"],
    SetFn<KeymapComponents["OrderParams"]>
  ]
}

export function useEmbedArgs(): [
  KeymapComponents["EmbedArgs"],
  SetFn<KeymapComponents["EmbedArgs"]>
] {
  const [state, set] = useQueryStates(embedArgsKeyMap(def as any))
  return [state, set] as [
    KeymapComponents["EmbedArgs"],
    SetFn<KeymapComponents["EmbedArgs"]>
  ]
}

export function useSearchPage(): [number, SetFn<number>] {
  const [state, set] = useQueryState("page", orderParamsKeyMap(def as any).page)
  return [state, set] as const
}

export function useQueryOptions(): [
  SearchQueryOptions,
  SetFn<SearchQueryOptions>
] {
  const [state, set] = useQueryStates(queryOptionsKeyMap(def as any))
  return [state, set] as const
}

export function useTagFilter(): [
  KeymapComponents["QueryTagFilters"],
  SetFn<KeymapComponents["QueryTagFilters"]>
] {
  const [state, set] = useScopedQueryStates("tag", tagFiltersKeyMap(def as any))
  return [state, set] as const
}

export function useFileFilters(): [
  KeymapComponents["FileFilters"],
  SetFn<KeymapComponents["FileFilters"]>
] {
  const [state, set] = useScopedQueryStates(
    "file",
    fileFiltersKeyMap(def as any)
  )
  return [state, set] as const
}

export function usePathTextFilters(): [
  KeymapComponents["PathTextFilter"],
  SetFn<KeymapComponents["PathTextFilter"]>
] {
  const [state, set] = useScopedQueryStates(
    "path",
    pathTextFiltersKeyMap(def as any)
  )
  return [state, set] as const
}

export function useExtractedTextFilters(): [
  KeymapComponents["ExtractedTextFilter"],
  SetFn<KeymapComponents["ExtractedTextFilter"]>
] {
  const [state, set] = useScopedQueryStates(
    "et",
    extractedTextFiltersKeyMap(def as any)
  )
  return [state, set] as const
}

export function useBookmarksFilter(): [
  KeymapComponents["BookmarksFilter"],
  SetFn<KeymapComponents["BookmarksFilter"]>
] {
  const [state, set] = useScopedQueryStates(
    "bm",
    bookmarksFilterKeyMap(def as any)
  )
  return [state, set] as const
}

export function useExtractedTextEmbeddingsFilters(): [
  KeymapComponents["ExtractedTextEmbeddingsFilter"],
  SetFn<KeymapComponents["ExtractedTextEmbeddingsFilter"]>
] {
  const [state, set] = useScopedQueryStates(
    "te",
    extractedTextEmbeddingsFiltersKeyMap(def as any)
  )
  return [state, set] as const
}

export function useImageEmbeddingsFilters(): [
  KeymapComponents["ImageEmbeddingFilter"],
  SetFn<KeymapComponents["ImageEmbeddingFilter"]>
] {
  const [state, set] = useScopedQueryStates(
    "ie",
    imageEmbeddingsFiltersKeyMap(def as any)
  )
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

export function useAnyTextFilterOptions(): AnyTextFilterOptions {
  const [options, setOptions] = useQueryOptions()
  const [pathTextFilters, setPathTextFilters] = useAnyTextPathTextFilters()
  const [etFilters, setEtFilters] = useAnyTextExtractedTextFilters()
  return {
    query: options.at_query,
    raw_fts5_match: options.at_fts5,
    enable_path_filter: options.at_e_path,
    enable_et_filter: options.at_e_et,
    path_filter: pathTextFilters,
    et_filter: etFilters,
  }
}

export const useSearchQueryState = () => {
  const keymapComponents: KeymapComponents = {
    EmbedArgs: useEmbedArgs()[0],
    ExtractedTextFilter: useExtractedTextFilters()[0],
    PathTextFilter: usePathTextFilters()[0],
    OrderParams: useOrderArgs()[0],
    QueryTagFilters: useTagFilter()[0],
    FileFilters: useFileFilters()[0],
    BookmarksFilter: useBookmarksFilter()[0],
    ExtractedTextEmbeddingsFilter: useExtractedTextEmbeddingsFilters()[0],
    ImageEmbeddingFilter: useImageEmbeddingsFilters()[0],
    SearchQueryOptions: useQueryOptions()[0],
    ATExtractedTextFilter: useAnyTextExtractedTextFilters()[0],
    ATPathTextFilter: useAnyTextPathTextFilters()[0],
  }
  return keymapComponents
}

export const useSearchQuery = () => {
  return queryFromState(useSearchQueryState())
}

export const useOrderBy = () => {
  return getOrderBy(useSearchQueryState())
}

export const useResetSearchQueryState = () => {
  const setters = [
    useExtractedTextFilters()[1],
    useExtractedTextFilters()[1],
    usePathTextFilters()[1],
    useOrderArgs()[1],
    useTagFilter()[1],
    useFileFilters()[1],
    useBookmarksFilter()[1],
    useExtractedTextEmbeddingsFilters()[1],
    useImageEmbeddingsFilters()[1],
    useQueryOptions()[1],
    useAnyTextExtractedTextFilters()[1],
    useAnyTextPathTextFilters()[1],
  ]
  return () => {
    for (const setter of setters) {
      setter(null)
    }
  }
}
