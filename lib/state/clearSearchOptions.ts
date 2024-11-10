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
  searchTypes: boolean
  setSearchTypes: (searchTypes: boolean) => void
}

export const useSearchClearSettings = create(
  persist<ClearSearchState>(
    (set) => ({
      searchTypes: true,
      setSearchTypes: (searchTypes: boolean) => set({ searchTypes }),
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
