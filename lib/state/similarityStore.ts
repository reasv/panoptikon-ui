import { createJSONStorage, persist } from "zustand/middleware"
import { components } from "../panoptikon"
import { persistLocalStorage } from "./store"
import { create } from "zustand"

interface ImageSimilarityStateState {
  clipQuery: components["schemas"]["SimilarItemsRequest"]
  textEmbeddingQuery: components["schemas"]["SimilarItemsRequest"]
}
interface ImageSimilarityState extends ImageSimilarityStateState {
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
    page_size: 6,
    page: 1,
    src_text: {
      setter_names: [],
      languages: [],
      min_confidence: 0,
      min_language_confidence: 0,
      min_length: 10,
    },
  },
  textEmbeddingQuery: {
    setter_name: "",
    distance_aggregation: "AVG",
    src_confidence_weight: 0,
    src_language_confidence_weight: 0,
    clip_xmodal: false,
    xmodal_t2t: true,
    xmodal_i2i: true,
    page_size: 6,
    page: 1,
    src_text: {
      setter_names: [],
      languages: [],
      min_confidence: 0,
      min_language_confidence: 0,
      min_length: 10,
    },
  },
}
export const useImageSimilarity = create(
  persist<ImageSimilarityState>(
    (set, get) => ({
      ...initialImageSimilarityState,
      setTextEmbedQuery: (query) => set({ textEmbeddingQuery: query }),
      setClipQuery: (query) => {
        set({
          clipQuery: {
            ...query,
            src_text: query.src_text || get().clipQuery.src_text,
          },
        })
      },
      getClipQuery: (fallback_setter: string) => {
        const setter_name =
          get().clipQuery.setter_name.length > 0
            ? get().clipQuery.setter_name
            : fallback_setter
        return {
          ...get().clipQuery,
          setter_name: setter_name,
          src_text: get().clipQuery.clip_xmodal
            ? get().clipQuery.src_text
            : null,
        }
      },
      getTextEmbedQuery: (fallback_setter: string) => {
        const setter_name =
          get().textEmbeddingQuery.setter_name.length > 0
            ? get().textEmbeddingQuery.setter_name
            : fallback_setter
        return {
          ...get().textEmbeddingQuery,
          distance_aggregation:
            get().textEmbeddingQuery.src_confidence_weight > 0 ||
            get().textEmbeddingQuery.src_language_confidence_weight > 0
              ? "AVG"
              : get().textEmbeddingQuery.distance_aggregation,
          setter_name: setter_name,
          clip_xmodal: false,
        }
      },
      resetAll: () => set(initialImageSimilarityState),
    }),
    imageSimilarityStorage
  )
)
