import { createJSONStorage, persist } from "zustand/middleware"
import { persistLocalStorage } from "./store"
import { create } from "zustand"

interface LastSelectedModels {
  imageEmbedding: string | null
  textEmbedding: string | null
  audioEmbedding: string | null
  setLastSelectedModel: (
    type: "image" | "text" | "audio",
    model: string
  ) => void
  getLastSelectedModel: (type: "image" | "text" | "audio") => string | null
}
const storage = {
  name: "lastSelectedModels",
  storage: createJSONStorage<LastSelectedModels>(() => persistLocalStorage),
}
export const useLastModelSelection = create(
  persist<LastSelectedModels>(
    (set, get) => ({
      imageEmbedding: null,
      textEmbedding: null,
      audioEmbedding: null,
      setLastSelectedModel: (
        type: "image" | "text" | "audio",
        model: string
      ) => {
        if (type === "image") {
          set((state) => ({
            imageEmbedding: model,
            textEmbedding: state.textEmbedding,
          }))
        } else if (type === "text") {
          set((state) => ({
            imageEmbedding: state.imageEmbedding,
            textEmbedding: model,
          }))
        } else {
          set((state) => ({
            imageEmbedding: state.imageEmbedding,
            textEmbedding: state.textEmbedding,
            audioEmbedding: model,
          }))
        }
      },
      getLastSelectedModel: (type: "image" | "text" | "audio") =>
        type === "image"
          ? get().imageEmbedding
          : type === "text"
          ? get().textEmbedding
          : get().audioEmbedding,
    }),
    storage
  )
)
