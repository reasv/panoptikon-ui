import { createJSONStorage, persist } from "zustand/middleware"
import { persistLocalStorage } from "./store"
import { create } from "zustand"

interface LastSelectedModels {
  imageEmbedding: string | null
  textEmbedding: string | null
  setLastSelectedModel: (type: "image" | "text", model: string) => void
  getLastSelectedModel: (type: "image" | "text") => string | null
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
      setLastSelectedModel: (type: "image" | "text", model: string) => {
        if (type === "image") {
          set((state) => ({
            imageEmbedding: model,
            textEmbedding: state.textEmbedding,
          }))
        } else {
          set((state) => ({
            imageEmbedding: state.imageEmbedding,
            textEmbedding: model,
          }))
        }
      },
      getLastSelectedModel: (type: "image" | "text") =>
        type === "image" ? get().imageEmbedding : get().textEmbedding,
    }),
    storage
  )
)
