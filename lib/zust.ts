import { create } from "zustand"
import { components } from "./panoptikon"
import { createJSONStorage, persist } from "zustand/middleware"
import { persistLocalStorage, compactUrlOnlyStorage } from "./store"

interface Database {
  index_db: string | null
  user_data_db: string | null
  setIndexDB: (db: string | null) => void
  setUserDataDB: (db: string | null) => void
  getDBs: () => { index_db: string | null; user_data_db: string | null }
}

const dbStorageOptions = {
  name: "db",
  storage: createJSONStorage<Database>(() => compactUrlOnlyStorage),
}
export const initialDBOpts = {
  index_db: null,
  user_data_db: null,
}
export const useDatabase = create(
  persist<Database>(
    (set, get) => ({
      index_db: null,
      user_data_db: null,
      setIndexDB: (db: string | null) => set({ index_db: db }),
      setUserDataDB: (db: string | null) => set({ user_data_db: db }),
      getDBs: () => {
        return {
          index_db: get().index_db,
          user_data_db: get().user_data_db,
        }
      },
    }),
    dbStorageOptions
  )
)

const nsStorageOptions = {
  name: "nsOpts",
  storage: createJSONStorage<BookmarkNs>(() => persistLocalStorage),
}
interface BookmarkNs {
  namespace: string
  setBookmarks: (ns: string) => void
}

export const useBookmarkNs = create(
  persist<BookmarkNs>(
    (set) => ({
      namespace: "default",
      setBookmarks: (ns: string) => set({ namespace: ns }),
    }),
    nsStorageOptions
  )
)

interface BookmarksCustom {
  namespaces: string[]
  addNs: (ns: string) => void
}

export const useBookmarkCustomNs = create<BookmarksCustom>((set) => ({
  namespaces: [],
  addNs: (ns: string) =>
    set((state) => ({ namespaces: [...state.namespaces, ns] })),
}))

const instantSearchStorageOptions = {
  name: "instantSearch",
  storage: createJSONStorage<InstantSearchState>(() => persistLocalStorage),
}
interface InstantSearchState {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

export const useInstantSearch = create(
  persist<InstantSearchState>(
    (set) => ({
      enabled: true,
      setEnabled: (enabled: boolean) => set({ enabled }),
    }),
    instantSearchStorageOptions
  )
)
interface AnyTextSettings {
  query: string
  raw_fts5_match: boolean
  enable_path_filter: boolean
  enable_et_filter: boolean
  path_filter: components["schemas"]["PathTextFilter"]
  et_filter: components["schemas"]["ExtractedTextFilter"]
}

export interface SearchQueryStateState {
  enable_search: boolean
  order_args: components["schemas"]["OrderParams"]
  any_text: AnyTextSettings
  bookmarks: components["schemas"]["BookmarksFilter"]
}
interface SearchQueryState {
  enable_search: boolean
  order_args: components["schemas"]["OrderParams"]
  any_text: AnyTextSettings
  bookmarks: components["schemas"]["BookmarksFilter"]
  setInitialState: (state: SearchQueryStateState) => void
  setBookmarkFilterEnabled: (value: boolean) => void
  setBookmarkFilterNs: (ns: string[]) => void
  setRawFts5Match: (value: boolean) => void
  setAnyTextQuery: (query: string) => void
  setAnyTextPathFilterEnabled: (value: boolean) => void
  setAnyTextPathFilterFilenameOnly: (value: boolean) => void
  setAnyTextETFilterEnabled: (value: boolean) => void
  setAnyTextETFilterTargets: (value: string[]) => void
  setAnyTextETFilterLanguages: (value: string[]) => void
  setAnyTextETFilterMinConfidence: (value: number) => void
  setAnyTextETFilterMinLanguageConfidence: (value: number) => void
  setPage: (page: number) => void
  getSearchQuery: () => components["schemas"]["SearchQuery"]
  setEnableSearch: (value: boolean) => void
}
const queryStorageOptions = {
  name: "query",
  storage: createJSONStorage<SearchQueryState>(() => compactUrlOnlyStorage),
}

export const initialSearchQueryState: SearchQueryStateState = {
  enable_search: true,
  order_args: {
    order_by: "last_modified",
    order: null,
    page: 1,
    page_size: 9,
  },
  any_text: {
    query: "",
    raw_fts5_match: false,
    enable_path_filter: true,
    enable_et_filter: true,
    path_filter: {
      query: "",
      only_match_filename: false,
      raw_fts5_match: false,
    },
    et_filter: {
      query: "",
      raw_fts5_match: false,
    },
  },
  bookmarks: {
    restrict_to_bookmarks: false,
    namespaces: [],
    user: "user",
    include_wildcard: true,
  },
}
export const useSearchQuery = create(
  persist<SearchQueryState>(
    (set, get) => ({
      ...initialSearchQueryState,
      setInitialState: (state: SearchQueryStateState) => {
        set(state)
      },
      setAnyTextETFilterLanguages: (value: string[]) => {
        set((state) => {
          return {
            ...state,
            any_text: {
              ...state.any_text,
              et_filter: {
                ...state.any_text.et_filter,
                languages: [...value],
              },
            },
          }
        })
      },
      setAnyTextETFilterMinConfidence: (value: number) => {
        set((state) => {
          return {
            ...state,
            any_text: {
              ...state.any_text,
              et_filter: {
                ...state.any_text.et_filter,
                min_confidence: value,
              },
            },
          }
        })
      },
      setAnyTextETFilterMinLanguageConfidence: (value: number) => {
        set((state) => {
          return {
            ...state,
            any_text: {
              ...state.any_text,
              et_filter: {
                ...state.any_text.et_filter,
                min_language_confidence: value,
              },
            },
          }
        })
      },
      setAnyTextETFilterTargets: (value: string[]) => {
        set((state) => {
          return {
            ...state,
            any_text: {
              ...state.any_text,
              et_filter: {
                ...state.any_text.et_filter,
                targets: [...value],
              },
            },
          }
        })
      },
      setAnyTextPathFilterEnabled: (value: boolean) => {
        set((state) => {
          return {
            ...state,
            any_text: {
              ...state.any_text,
              enable_path_filter: value,
            },
          }
        })
      },
      setAnyTextETFilterEnabled: (value: boolean) => {
        set((state) => {
          return {
            ...state,
            any_text: {
              ...state.any_text,
              enable_et_filter: value,
            },
          }
        })
      },
      setAnyTextPathFilterFilenameOnly: (value: boolean) => {
        set((state) => {
          return {
            ...state,
            any_text: {
              ...state.any_text,
              path_filter: {
                ...state.any_text.path_filter,
                only_match_filename: value,
              },
            },
          }
        })
      },
      setBookmarkFilterEnabled: (value: boolean) => {
        set((state) => {
          return {
            ...state,
            bookmarks: {
              ...state.bookmarks,
              restrict_to_bookmarks: value,
            },
          }
        })
      },
      setBookmarkFilterNs: (ns: string[]) => {
        set((state) => {
          return {
            ...state,
            bookmarks: {
              ...state.bookmarks,
              namespaces: [...ns],
            },
          }
        })
      },
      getSearchQuery: () => {
        return queryFromState(get())
      },
      setEnableSearch: (value: boolean) => {
        set({ enable_search: value })
      },
      setRawFts5Match: (value: boolean) => {
        get().setPage(1)
        set((state) => {
          return {
            ...state,
            any_text: {
              ...state.any_text,
              raw_fts5_match: value,
            },
          }
        })
      },
      setPage: (page: number) =>
        set((state) => {
          return {
            ...state,
            order_args: {
              ...state.order_args,
              page,
            },
          }
        }),
      setAnyTextQuery: (query_string: string) => {
        get().setPage(1)
        set((state) => {
          return {
            ...state,
            any_text: {
              ...state.any_text,
              query: query_string,
            },
          }
        })
      },
    }),
    queryStorageOptions
  )
)

export function queryFromState(
  state: SearchQueryState | SearchQueryStateState
) {
  const query: components["schemas"]["SearchQuery"] = {
    order_args: state.order_args,
    count: true,
    check_path: true,
    query: {
      filters: {
        any_text: {},
      },
    },
  }
  if (state.any_text.query) {
    if (state.any_text.enable_path_filter) {
      query.query!.filters!.any_text!.path = state.any_text.path_filter
      query.query!.filters!.any_text!.path.query = state.any_text.query
      query.query!.filters!.any_text!.path.raw_fts5_match =
        state.any_text.raw_fts5_match
    }
    if (state.any_text.enable_et_filter) {
      query.query!.filters!.any_text!.extracted_text = state.any_text.et_filter
      query.query!.filters!.any_text!.extracted_text.query =
        state.any_text.query
      query.query!.filters!.any_text!.extracted_text.raw_fts5_match =
        state.any_text.raw_fts5_match
    }
  }
  if (state.bookmarks.restrict_to_bookmarks) {
    query.query!.filters!.bookmarks = state.bookmarks
  }

  return query
}
