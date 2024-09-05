import { components } from "@/lib/panoptikon"
import {
  SimilarityQueryState,
  SimilarityQueryType,
} from "./similarityQueryKeyMaps"

export function similarityQueryFromState(
  state: SimilarityQueryState
): components["schemas"]["SimilarItemsRequest"] {
  return {
    ...{
      ...state.similarityOptions,
      item: undefined,
      type: undefined,
    },
    src_text:
      state.similarityOptions.type === SimilarityQueryType.textEmbedding ||
      state.similarityOptions.clip_xmodal
        ? state.similaritySource
        : undefined,
  }
}
