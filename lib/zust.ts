import { create } from "zustand"

interface Database {
  index_db: string | null
  user_data_db: string | null
  setIndexDB: (db: string) => void
  setUserDataDB: (db: string) => void
}

export const useDatabase = create<Database>((set) => ({
  index_db: null,
  user_data_db: null,
  setIndexDB: (db: string) => set({ index_db: db }),
  setUserDataDB: (db: string) => set({ user_data_db: db }),
}))

interface BookmarkNs {
  namespace: string
  setBookmarks: (ns: string) => void
}

export const useBookmarkNs = create<BookmarkNs>((set) => ({
  namespace: "default",
  setBookmarks: (ns: string) => set({ namespace: ns }),
}))
