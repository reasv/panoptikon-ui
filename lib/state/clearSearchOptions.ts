import { createJSONStorage, persist } from "zustand/middleware"
import { persistLocalStorage } from "./store"
import { create } from "zustand"

const clearSearchStorageOptions = {
  name: "clearSearchOptions",
  storage: createJSONStorage<ClearSearchState>(() => persistLocalStorage),
}
interface ClearSearchState {
  pageSize: boolean
  setPageSize: (pageSize: boolean) => void
  orderBy: boolean
  setOrderBy: (orderBy: boolean) => void
  modelCache: boolean
  setModelCache: (modelCache: boolean) => void
}

export const useSearchClearSettings = create(
  persist<ClearSearchState>(
    (set) => ({
      pageSize: true,
      setPageSize: (pageSize: boolean) => set({ pageSize }),
      orderBy: true,
      setOrderBy: (orderBy: boolean) => set({ orderBy }),
      modelCache: false,
      setModelCache: (modelCache: boolean) => set({ modelCache }),
    }),
    clearSearchStorageOptions
  )
)
