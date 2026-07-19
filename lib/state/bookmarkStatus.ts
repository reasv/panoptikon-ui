import { create } from "zustand"

// Per-item bookmark status, seeded in bulk from search responses (the
// backend's include_bookmarks enrichment) and updated locally by bookmark
// mutations. Grid buttons read from here instead of each firing their own
// status GET; the per-item query remains only as a fallback for items with
// no entry (e.g. pinboards, or after switching bookmark namespace).
//
// Keyed by user_data_db + namespace + sha256 so entries from one bookmark
// DB or namespace never answer for another.

interface BookmarkStatusState {
  statuses: Map<string, boolean>
  setMany: (entries: [string, boolean][]) => void
  setOne: (key: string, value: boolean) => void
}

export const bookmarkStatusKey = (
  userDataDb: string | null | undefined,
  namespace: string,
  sha256: string
) => `${userDataDb ?? ""}|${namespace}|${sha256}`

export const useBookmarkStatus = create<BookmarkStatusState>((set) => ({
  statuses: new Map(),
  setMany: (entries) =>
    set((state) => {
      const statuses = new Map(state.statuses)
      for (const [key, value] of entries) statuses.set(key, value)
      return { statuses }
    }),
  setOne: (key, value) =>
    set((state) => {
      if (state.statuses.get(key) === value) return state
      const statuses = new Map(state.statuses)
      statuses.set(key, value)
      return { statuses }
    }),
}))
