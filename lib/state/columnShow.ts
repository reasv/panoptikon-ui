import { createJSONStorage, persist } from "zustand/middleware"
import { persistLocalStorage } from "./store"
import { create } from "zustand"
import { useEffect, useState } from "react"
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
