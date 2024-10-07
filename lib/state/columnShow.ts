import { createJSONStorage, persist } from "zustand/middleware"
import { persistLocalStorage } from "./store"
import { create } from "zustand"
import { VisibilityState } from "@tanstack/react-table"

interface TableState {
  columnVisibility: VisibilityState
  setColumnVisibility: (key: string, visibility: VisibilityState) => void
}

interface TableStore {
  tables: Record<string, TableState>
  setTableVisibility: (key: string, visibility: VisibilityState) => void
}
const storage = {
  name: "tablecolumnstate",
  storage: createJSONStorage<TableStore>(() => persistLocalStorage),
}
export const useTableStore = create(
  persist<TableStore>(
    (set) => ({
      tables: {},
      setTableVisibility: (storageKey, visibility) =>
        set((state) => ({
          tables: {
            ...state.tables,
            [storageKey]: {
              ...state.tables[storageKey],
              columnVisibility: visibility,
            },
          },
        })),
    }),
    storage
  )
)

// Selector to get the column visibility for a specific table identified by storageKey
export const useColumnVisibility = (
  storageKey: string,
  defaultValues?: VisibilityState
) =>
  useTableStore((state) => {
    const columnVisibility = state.tables[storageKey]?.columnVisibility || {}
    // Merge the default values with the stored columnVisibility
    return {
      ...defaultValues,
      ...columnVisibility,
    }
  })
