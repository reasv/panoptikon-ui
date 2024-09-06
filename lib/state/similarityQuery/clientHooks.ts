import * as def from "nuqs"
import { useScopedQueryStates } from "../nuqsScopedWrappers/scopedQueryStates"
import {
  SimilarityQueryOptions,
  similarityQueryOptionsKeymap,
  SimilarityQuerySource,
  similarityQuerySourceKeymap,
} from "./similarityQueryKeyMaps"
import { SetFn } from "../searchQuery/clientHooks"
import { similarityQueryFromState } from "./similarityQuery"

export function useItemSimilarityOptions(): [
  SimilarityQueryOptions,
  SetFn<SimilarityQueryOptions>
] {
  const [state, set] = useScopedQueryStates(
    "is",
    similarityQueryOptionsKeymap(def as any)
  )
  return [state, set] as const
}

export function useItemSimilaritySource(): [
  SimilarityQuerySource,
  SetFn<SimilarityQuerySource>
] {
  const [state, set] = useScopedQueryStates(
    "is.src",
    similarityQuerySourceKeymap(def as any)
  )
  return [state, set] as const
}

export const useResetItemSimilarityFilter = () => {
  const [options, setOptions] = useItemSimilarityOptions()
  const setSource = useItemSimilaritySource()[1]
  // Cannot reset these values
  const old = {
    item: options.item,
    type: options.type,
    setter_name: options.setter_name,
  }
  return () => {
    setOptions(null)
    setSource(null)
    setOptions(old)
  }
}

export const useSimilarityQuery = () => {
  return similarityQueryFromState({
    similarityOptions: useItemSimilarityOptions()[0],
    similaritySource: useItemSimilaritySource()[0],
  })
}
