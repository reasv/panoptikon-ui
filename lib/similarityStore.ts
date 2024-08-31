import { createJSONStorage, persist } from "zustand/middleware"
import { components } from "./panoptikon"
import { persistLocalStorage } from "./store"
import { create } from "zustand"

interface ImageSimilarityStateState {
  clipQuery: components["schemas"]["SimilarItemsRequest"]
  clipTextFilters: components["schemas"]["TextFilter"]
  textEmbeddingQuery: components["schemas"]["SimilarItemsRequest"]
  textEmbedTextFilters: components["schemas"]["TextFilter"]
}
interface ImageSimilarityState extends ImageSimilarityStateState {
  setTextEmbedTextFilters: (filter: components["schemas"]["TextFilter"]) => void
  setClipTextFilters: (filter: components["schemas"]["TextFilter"]) => void
  setTextEmbedQuery: (
    query: components["schemas"]["SimilarItemsRequest"]
  ) => void
  setClipQuery: (query: components["schemas"]["SimilarItemsRequest"]) => void
  getClipQuery: (
    fallback_setter: string
  ) => components["schemas"]["SimilarItemsRequest"]
  getTextEmbedQuery: (
    fallback_setter: string
  ) => components["schemas"]["SimilarItemsRequest"]
  resetAll: () => void
}
const imageSimilarityStorage = {
  name: "imageSimilarityOpts",
  storage: createJSONStorage<ImageSimilarityState>(() => persistLocalStorage),
}
const initialImageSimilarityState: ImageSimilarityStateState = {
  clipQuery: {
    setter_name: "",
    distance_aggregation: "AVG",
    src_confidence_weight: 0,
    src_language_confidence_weight: 0,
    clip_xmodal: false,
    xmodal_t2t: true,
    xmodal_i2i: true,
    limit: 6,
  },
  clipTextFilters: {
    setter_names: [],
    languages: [],
    min_confidence: 0,
    min_language_confidence: 0,
    min_length: 10,
  },
  textEmbeddingQuery: {
    setter_name: "",
    distance_aggregation: "AVG",
    src_confidence_weight: 0,
    src_language_confidence_weight: 0,
    clip_xmodal: false,
    xmodal_t2t: true,
    xmodal_i2i: true,
    limit: 6,
  },
  textEmbedTextFilters: {
    setter_names: [],
    languages: [],
    min_confidence: 0,
    min_language_confidence: 0,
    min_length: 10,
  },
}
export const useImageSimilarity = create(
  persist<ImageSimilarityState>(
    (set, get) => ({
      ...initialImageSimilarityState,
      setTextEmbedTextFilters: (filter) =>
        set({ textEmbedTextFilters: filter }),
      setClipTextFilters: (filter) => set({ clipTextFilters: filter }),
      setTextEmbedQuery: (query) => set({ textEmbeddingQuery: query }),
      setClipQuery: (query) => set({ clipQuery: query }),
      getClipQuery: (fallback_setter: string) => {
        const setter_name =
          get().clipQuery.setter_name.length > 0
            ? get().clipQuery.setter_name
            : fallback_setter
        return {
          ...get().clipQuery,
          setter_name: setter_name,
          src_text: get().clipQuery.clip_xmodal
            ? get().clipTextFilters
            : undefined,
        }
      },
      getTextEmbedQuery: (fallback_setter: string) => {
        const setter_name =
          get().textEmbeddingQuery.setter_name.length > 0
            ? get().textEmbeddingQuery.setter_name
            : fallback_setter
        return {
          ...get().textEmbeddingQuery,
          setter_name: setter_name,
          clip_xmodal: false,
          src_text: get().textEmbedTextFilters,
        }
      },
      resetAll: () => set(initialImageSimilarityState),
    }),
    imageSimilarityStorage
  )
)
