import { createJSONStorage, persist } from "zustand/middleware"
import { persistLocalStorage } from "./store"
import { create } from "zustand"

const tagCompletionStorageOptions = {
  name: "tagCompletion",
  storage: createJSONStorage<TagCompletionState>(() => persistLocalStorage),
}
interface TagCompletionState {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

export const useTagCompletionSettings = create(
  persist<TagCompletionState>(
    (set) => ({
      enabled: true,
      setEnabled: (enabled: boolean) => set({ enabled }),
    }),
    tagCompletionStorageOptions
  )
)
