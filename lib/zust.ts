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

interface StringStore {
  strings: string[]
  add: (p: string) => void
  remove: (p: string) => void
}

export const useCustomPaths = create<StringStore>((set) => ({
  strings: [],
  add: (p: string) => set((state) => ({ strings: [...state.strings, p] })),
  remove: (p: string) => {
    set((state) => {
      const paths = state.strings.filter((path) => path !== p)
      return { strings: paths }
    })
  },
}))
export const useCustomMimes = create<StringStore>((set) => ({
  strings: [],
  add: (p: string) => set((state) => ({ strings: [...state.strings, p] })),
  remove: (p: string) => {
    set((state) => {
      const paths = state.strings.filter((path) => path !== p)
      return { strings: paths }
    })
  },
}))

interface AdvancedOptionsState {
  isOpen: boolean
  toggle: () => void
  setOpened: (value: boolean) => void
}

export const useAdvancedOptions = create<AdvancedOptionsState>((set) => ({
  isOpen: false,
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  setOpened: (value: boolean) => set({ isOpen: value }),
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
  paths: string[]
  types: string[]
  e_path: boolean
  e_types: boolean
}
interface SearchQueryState {
  enable_search: boolean
  order_args: components["schemas"]["OrderParams"]
  any_text: AnyTextSettings
  bookmarks: components["schemas"]["BookmarksFilter"]
  paths: string[]
  types: string[]
  e_path: boolean
  e_types: boolean
  setInitialState: (state: SearchQueryStateState) => void
  setOrderBy: (
    order_by:
      | "last_modified"
      | "path"
      | "rank_fts"
      | "rank_path_fts"
      | "time_added"
      | "rank_any_text"
      | "text_vec_distance"
      | "image_vec_distance"
      | null
  ) => void
  setOrder: (order: "asc" | "desc" | null | undefined) => void
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
  getIsAnyTextEnabled: () => boolean
  setPageSize: (size: number) => void
  setPaths: (paths: string[]) => void
  setTypes: (types: string[]) => void
  setEnablePaths: (value: boolean) => void
  setEnableTypes: (value: boolean) => void
  getOrderBy: () =>
    | "last_modified"
    | "path"
    | "rank_fts"
    | "rank_path_fts"
    | "time_added"
    | "rank_any_text"
    | "text_vec_distance"
    | "image_vec_distance"
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
  paths: [],
  types: [],
  e_path: false,
  e_types: false,
}
export const useSearchQuery = create(
  persist<SearchQueryState>(
    (set, get) => ({
      ...initialSearchQueryState,
      setInitialState: (state: SearchQueryStateState) => {
        set(state)
      },
      setEnablePaths: (value: boolean) => {
        set((state) => {
          return {
            ...state,
            e_path: value,
          }
        })
      },
      setEnableTypes: (value: boolean) => {
        set((state) => {
          return {
            ...state,
            e_types: value,
          }
        })
      },
      setPaths: (paths: string[]) => {
        set((state) => {
          return {
            ...state,
            paths: paths,
          }
        })
      },
      setTypes: (types: string[]) => {
        set((state) => {
          return {
            ...state,
            types: types,
          }
        })
      },
      setPageSize: (size: number) => {
        set((state) => {
          return {
            ...state,
            order_args: {
              ...state.order_args,
              page_size: size,
            },
          }
        })
      },
      getOrderBy: () => getOrderBy(get()),
      getIsAnyTextEnabled: () => getIsAnyTextEnabled(get()),
      setOrderBy: (
        order_by:
          | "last_modified"
          | "path"
          | "rank_fts"
          | "rank_path_fts"
          | "time_added"
          | "rank_any_text"
          | "text_vec_distance"
          | "image_vec_distance"
          | null
      ) => {
        get().setPage(1)
        set((state) => {
          return {
            ...state,
            order_args: {
              ...state.order_args,
              order_by,
            },
          }
        })
      },
      setOrder: (order: "asc" | "desc" | null | undefined) => {
        get().setPage(1)
        set((state) => {
          return {
            ...state,
            order_args: {
              ...state.order_args,
              order,
            },
          }
        })
      },
      setAnyTextETFilterLanguages: (value: string[]) => {
        get().setPage(1)
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
        get().setPage(1)
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
        get().setPage(1)
        set((state) => {
          return {
            ...state,
            any_text: {
              ...state.any_text,
              et_filter: {
                ...state.any_text.et_filter,
                language_min_confidence: value,
              },
            },
          }
        })
      },
      setAnyTextETFilterTargets: (value: string[]) => {
        get().setPage(1)
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
        get().setPage(1)
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
        get().setPage(1)
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
        get().setPage(1)
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
        get().setPage(1)
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
        get().setPage(1)
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

function getIsPathPrefixEnabled(
  state: SearchQueryState | SearchQueryStateState
) {
  return state.paths.length > 0 && state.e_path
}

function getIsTypePrefixEnabled(
  state: SearchQueryState | SearchQueryStateState
) {
  return state.types.length > 0 && state.e_types
}

function getIsAnyTextEnabled(state: SearchQueryState | SearchQueryStateState) {
  return (
    (state.any_text.enable_et_filter || state.any_text.enable_path_filter) &&
    state.any_text.query !== ""
  )
}
function getOrderBy(state: SearchQueryState | SearchQueryStateState) {
  const current_order_by = state.order_args.order_by
  if (current_order_by === null) {
    return "last_modified"
  }
  if (current_order_by === "rank_any_text") {
    if (!getIsAnyTextEnabled(state)) {
      return "last_modified"
    }
  }
  if (current_order_by === "time_added") {
    if (!state.bookmarks.restrict_to_bookmarks) {
      return "last_modified"
    }
  }
  return current_order_by
}
export function queryFromState(
  state: SearchQueryState | SearchQueryStateState
): components["schemas"]["SearchQuery"] {
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
  if (getIsPathPrefixEnabled(state)) {
    query.query!.filters!.files = {
      include_path_prefixes: state.paths,
    }
  }
  if (getIsTypePrefixEnabled(state)) {
    query.query!.filters!.files = {
      ...query.query!.filters!.files,
      item_types: state.types,
    }
  }
  query.order_args!.order_by = getOrderBy(state)
  return query
}
