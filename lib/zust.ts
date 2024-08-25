import { create } from "zustand"
import { components, paths } from "./panoptikon"

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

interface AnyTextSettings {
  query: string
  raw_fts5_match: boolean
  enable_path_filter: true
  enable_et_filter: true
  path_filter: components["schemas"]["PathTextFilter"]
  et_filter: components["schemas"]["ExtractedTextFilter"]
}

interface SearchQueryState {
  enable_search: boolean
  user_enable_search: boolean
  order_args: components["schemas"]["OrderParams"]
  any_text: AnyTextSettings
  setRawFts5Match: (value: boolean) => void
  setAnyTextQuery: (query: string) => void
  setPage: (page: number) => void
  getSearchQuery: () => components["schemas"]["SearchQuery"]
  setEnableSearch: (value: boolean) => void
  setUserSearchEnabled: (value: boolean) => void
  getSearchEnabled: () => boolean
}

export const useSearchQuery = create<SearchQueryState>((set, get) => ({
  enable_search: true,
  user_enable_search: true,
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
  getSearchQuery: () => {
    const query: components["schemas"]["SearchQuery"] = {
      order_args: get().order_args,
      count: true,
      check_path: true,
      query: {
        filters: {
          any_text: {},
        },
      },
    }
    if (get().any_text.query) {
      if (get().any_text.enable_path_filter) {
        query.query!.filters!.any_text!.path = get().any_text.path_filter
        query.query!.filters!.any_text!.path.query = get().any_text.query
        query.query!.filters!.any_text!.path.raw_fts5_match =
          get().any_text.raw_fts5_match
      }
      if (get().any_text.enable_et_filter) {
        query.query!.filters!.any_text!.extracted_text =
          get().any_text.et_filter
        query.query!.filters!.any_text!.extracted_text.query =
          get().any_text.query
        query.query!.filters!.any_text!.extracted_text.raw_fts5_match =
          get().any_text.raw_fts5_match
      }
    }

    return query
  },
  getSearchEnabled: () => {
    return get().enable_search && get().user_enable_search
  },
  setUserSearchEnabled: (value: boolean) => {
    set({ user_enable_search: value })
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
}))
