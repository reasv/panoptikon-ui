import { persist } from "zustand/middleware"
import { create } from "zustand"
import { Database } from "@sqlite.org/sqlite-wasm"

interface SQLiteInstanceState {
  db: Database | null
  loading: boolean
  setDb: (db: Database | null) => void
  setLoading: (loading: boolean) => void
}

export const useSQLiteInstanceStore = create<SQLiteInstanceState>((set) => ({
  db: null,
  loading: false,
  setDb: (db) => set({ db }),
  setLoading: (loading) => set({ loading }),
}))
