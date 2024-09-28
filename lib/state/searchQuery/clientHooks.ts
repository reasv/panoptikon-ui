import { Options, useQueryState } from "nuqs"
import * as def from "nuqs"

import { useQueryStates } from "nuqs"
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
  SearchQueryOptions,
  ATMatchText,
  ATMatchPath,
  AnyTextFilterOptions,
  KeymapComponents,
  embedArgsKeyMap,
  ATSemanticText,
  ATSourceText,
  sourceTextKeyMap,
  ATSemanticImage,
  itemSimilarityKeyMap,
  rrfKeyMap,
  SimilaritySideBarComponents,
  similaritySBPageArgsKeyMap,
} from "./searchQueryKeyMaps"
import { useScopedQueryStates } from "../nuqsScopedWrappers/scopedQueryStates"
import {
  getOrderBy,
  queryFromState,
  sbSimilarityQueryFromState,
} from "./searchQuery"

export type Nullable<T> = {
  [K in keyof T]: T[K] | null
}

type UpdaterFn<T> = (old: T) => Partial<Nullable<T>>

export type SetFn<T> = (
  values: Partial<Nullable<T>> | UpdaterFn<T> | null,
  options?: Options
) => Promise<URLSearchParams>

export function useOrderArgs(): [
  KeymapComponents["OrderArgs"],
  SetFn<KeymapComponents["OrderArgs"]>
] {
  const [state, set] = useQueryStates(orderParamsKeyMap(def as any))
  return [state, set] as [
    KeymapComponents["OrderArgs"],
    SetFn<KeymapComponents["OrderArgs"]>
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

export function useMatchTags(): [
  KeymapComponents["MatchTags"],
  SetFn<KeymapComponents["MatchTags"]>
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

export function useMatchPath(): [
  KeymapComponents["MatchPath"],
  SetFn<KeymapComponents["MatchPath"]>
] {
  const [state, set] = useScopedQueryStates("path", matchPathKeyMap(def as any))
  return [state, set] as const
}

export function useMatchText(): [
  KeymapComponents["MatchText"],
  SetFn<KeymapComponents["MatchText"]>
] {
  const [state, set] = useScopedQueryStates("txt", matchTextKeyMap(def as any))
  return [state, set] as const
}

export function useBookmarksFilter(): [
  KeymapComponents["InBookmarks"],
  SetFn<KeymapComponents["InBookmarks"]>
] {
  const [state, set] = useScopedQueryStates("bm", inBookmarksKeyMap(def as any))
  return [state, set] as const
}

export function useSemanticTextSearch(): [
  KeymapComponents["SemanticTextSearch"],
  SetFn<KeymapComponents["SemanticTextSearch"]>
] {
  const [state, set] = useScopedQueryStates(
    "st",
    semanticTextSearchKeyMap(def as any)
  )
  return [state, set] as const
}
export function useSemanticTextSource(): [
  KeymapComponents["SemanticTextSource"],
  SetFn<KeymapComponents["SemanticTextSource"]>
] {
  const [state, set] = useScopedQueryStates(
    "st.src",
    sourceTextKeyMap(def as any)
  )
  return [state, set] as const
}

export function useSemanticImageSearch(): [
  KeymapComponents["SemanticImageSearch"],
  SetFn<KeymapComponents["SemanticImageSearch"]>
] {
  const [state, set] = useScopedQueryStates(
    "si",
    semanticImageSearchKeyMap(def as any)
  )
  return [state, set] as const
}

export function useATMatchPath(): [ATMatchPath, SetFn<ATMatchPath>] {
  const [state, set] = useScopedQueryStates(
    "at.path",
    matchPathKeyMap(def as any)
  )
  return [state, set] as const
}

export function useATMatchText(): [ATMatchText, SetFn<ATMatchText>] {
  const [state, set] = useScopedQueryStates(
    "at.txt",
    matchTextKeyMap(def as any)
  )
  return [state, set] as const
}

export function useATSemanticText(): [ATSemanticText, SetFn<ATSemanticText>] {
  const [state, set] = useScopedQueryStates(
    "at.st",
    semanticTextSearchKeyMap(def as any)
  )
  return [state, set] as const
}

export function useATSemanticTextSrc(): [ATSourceText, SetFn<ATSourceText>] {
  const [state, set] = useScopedQueryStates(
    "at.st.src",
    sourceTextKeyMap(def as any)
  )
  return [state, set] as const
}
export function useATSemanticImage(): [
  ATSemanticImage,
  SetFn<ATSemanticImage>
] {
  const [state, set] = useScopedQueryStates(
    "at.si",
    semanticImageSearchKeyMap(def as any)
  )
  return [state, set] as const
}

export function useATTextRRF(): [
  KeymapComponents["ATTextRRF"],
  SetFn<KeymapComponents["ATTextRRF"]>
] {
  const [state, set] = useScopedQueryStates("at.txt.rrf", rrfKeyMap(def as any))
  return [state, set] as const
}

export function useATPathRRF(): [
  KeymapComponents["ATPathRRF"],
  SetFn<KeymapComponents["ATPathRRF"]>
] {
  const [state, set] = useScopedQueryStates(
    "at.path.rrf",
    rrfKeyMap(def as any)
  )
  return [state, set] as const
}

export function useATSemanticTextRRF(): [
  KeymapComponents["ATSemanticTextRRF"],
  SetFn<KeymapComponents["ATSemanticTextRRF"]>
] {
  const [state, set] = useScopedQueryStates("at.st.rrf", rrfKeyMap(def as any))
  return [state, set] as const
}

export function useATSemanticImageRRF(): [
  KeymapComponents["ATSemanticImageRRF"],
  SetFn<KeymapComponents["ATSemanticImageRRF"]>
] {
  const [state, set] = useScopedQueryStates("at.si.rrf", rrfKeyMap(def as any))
  return [state, set] as const
}

export function useItemSimilaritySearch(): [
  KeymapComponents["ItemSimilarity"],
  SetFn<KeymapComponents["ItemSimilarity"]>
] {
  const [state, set] = useScopedQueryStates(
    "iss",
    itemSimilarityKeyMap(def as any)
  )
  return [state, set] as const
}

export function useItemSimilarityTextSource(): [
  KeymapComponents["SemanticTextSource"],
  SetFn<KeymapComponents["SemanticTextSource"]>
] {
  const [state, set] = useScopedQueryStates(
    "iss.src",
    sourceTextKeyMap(def as any)
  )
  return [state, set] as const
}

export function useATOptions(): AnyTextFilterOptions {
  const [options, setOptions] = useQueryOptions()
  const [pathTextFilters, setPathTextFilters] = useATMatchPath()
  const [etFilters, setEtFilters] = useATMatchText()
  return {
    query: options.at_query,
    raw_fts5_match: options.at_fts5,
    enable_path_filter: options.at_e_path,
    enable_txt_filter: options.at_e_txt,
    path_filter: pathTextFilters,
    txt_filter: etFilters,
  }
}

export const useSearchQueryState = () => {
  const keymapComponents: KeymapComponents = {
    EmbedArgs: useEmbedArgs()[0],
    MatchText: useMatchText()[0],
    MatchPath: useMatchPath()[0],
    OrderArgs: useOrderArgs()[0],
    MatchTags: useMatchTags()[0],
    FileFilters: useFileFilters()[0],
    InBookmarks: useBookmarksFilter()[0],
    SemanticTextSearch: useSemanticTextSearch()[0],
    SemanticTextSource: useSemanticTextSource()[0],
    SemanticImageSearch: useSemanticImageSearch()[0],
    SearchQueryOptions: useQueryOptions()[0],
    ATMatchText: useATMatchText()[0],
    ATTextRRF: useATTextRRF()[0],
    ATMatchPath: useATMatchPath()[0],
    ATPathRRF: useATPathRRF()[0],
    ATSemanticText: useATSemanticText()[0],
    ATSemanticTextRRF: useATSemanticTextRRF()[0],
    ATSourceText: useATSemanticTextSrc()[0],
    ATSemanticImage: useATSemanticImage()[0],
    ATSemanticImageRRF: useATSemanticImageRRF()[0],
    ItemSimilarity: useItemSimilaritySearch()[0],
    ItemSimilarityTextSource: useItemSimilarityTextSource()[0],
  }
  return keymapComponents
}

export const useSearchQuery = () => {
  return queryFromState(useSearchQueryState())[0]
}

export const useOrderBy = () => {
  const state = useSearchQueryState()
  return { order_by: getOrderBy(state), meta: queryFromState(state)[1] }
}

export const useResetSearchQueryState = () => {
  const setters = [
    useMatchText()[1],
    useMatchText()[1],
    useMatchPath()[1],
    useOrderArgs()[1],
    useMatchTags()[1],
    useFileFilters()[1],
    useBookmarksFilter()[1],
    useSemanticTextSearch()[1],
    useSemanticImageSearch()[1],
    useQueryOptions()[1],
    useATMatchText()[1],
    useATMatchPath()[1],
    useATSemanticText()[1],
    useATSemanticTextSrc()[1],
    useATSemanticImage()[1],
    useEmbedArgs()[1],
    useSemanticTextSource()[1],
    useItemSimilaritySearch()[1],
    useItemSimilarityTextSource()[1],
    useATTextRRF()[1],
    useATPathRRF()[1],
    useATSemanticTextRRF()[1],
    useATSemanticImageRRF()[1],
  ]
  return () => {
    for (const setter of setters) {
      // @ts-ignore
      setter(null, { history: "push" }) // @ts-ignore
    }
  }
}

// Similarity sidebar
export function useSBClipSimilarity(): [
  SimilaritySideBarComponents["CLIPSimilarity"],
  SetFn<SimilaritySideBarComponents["CLIPSimilarity"]>
] {
  const [state, set] = useScopedQueryStates(
    "sb.iss.clip",
    itemSimilarityKeyMap(def as any)
  )
  return [state, set] as const
}

export function useSBClipSimilarityTextSrc(): [
  SimilaritySideBarComponents["CLIPTextSource"],
  SetFn<SimilaritySideBarComponents["CLIPTextSource"]>
] {
  const [state, set] = useScopedQueryStates(
    "sb.iss.clip.src",
    sourceTextKeyMap(def as any)
  )
  return [state, set] as const
}

export function useSBTextSimilarity(): [
  SimilaritySideBarComponents["TextSimilarity"],
  SetFn<SimilaritySideBarComponents["TextSimilarity"]>
] {
  const [state, set] = useScopedQueryStates(
    "sb.iss.txt",
    itemSimilarityKeyMap(def as any)
  )
  return [state, set] as const
}

export function useSBTextSimilarityTextSrc(): [
  SimilaritySideBarComponents["TextSource"],
  SetFn<SimilaritySideBarComponents["TextSource"]>
] {
  const [state, set] = useScopedQueryStates(
    "sb.iss.txt.src",
    sourceTextKeyMap(def as any)
  )
  return [state, set] as const
}

export function useSBSimilarityPageArgs(): [
  SimilaritySideBarComponents["PageArgs"],
  SetFn<SimilaritySideBarComponents["PageArgs"]>
] {
  const [state, set] = useScopedQueryStates(
    "sb.iss",
    similaritySBPageArgsKeyMap(def as any)
  )
  return [state, set] as const
}

export const useSBResetSimilarityOptions = () => {
  const setters = [
    useSBClipSimilarity()[1],
    useSBClipSimilarityTextSrc()[1],
    useSBTextSimilarity()[1],
    useSBTextSimilarityTextSrc()[1],
    useSBSimilarityPageArgs()[1],
  ]
  return () => {
    for (const setter of setters) {
      // @ts-ignore
      setter(null, { history: "replace" }) // @ts-ignore
    }
  }
}
export const useSBSimilarityQueryState = () => {
  const keymapComponents: SimilaritySideBarComponents = {
    CLIPSimilarity: useSBClipSimilarity()[0],
    CLIPTextSource: useSBClipSimilarityTextSrc()[0],
    TextSimilarity: useSBTextSimilarity()[0],
    TextSource: useSBTextSimilarityTextSrc()[0],
    PageArgs: useSBSimilarityPageArgs()[0],
  }
  return keymapComponents
}
export const useSBSimilarityQuery = () => {
  return sbSimilarityQueryFromState(useSBSimilarityQueryState())
}
