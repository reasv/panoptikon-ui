import { create } from "zustand"
import { components } from "../panoptikon"
import { createJSONStorage, persist } from "zustand/middleware"
import { persistLocalStorage } from "./store"

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

interface SearchLoading {
  loading: boolean
  setLoading: (loading: boolean) => void
}

export const useSearchLoading = create<SearchLoading>((set) => ({
  loading: false,
  setLoading: (loading: boolean) => set({ loading }),
}))

interface ItemDetailFiltersStateState {
  text_setters: string[]
  text_languages: string[]
  text_min_confidence: number
  min_language_confidence: number
  text_max_length: number
  tag_setters: string[]
  tag_namespaces: string[]
  tag_min_confidence: number
  tags_max_per_ns_setter: number
  metadata_setters: string[]
  metadata_min_confidence: number
}
interface ItemDetailFiltersState extends ItemDetailFiltersStateState {
  setTextSetters: (setters: string[]) => void
  setTextLanguages: (languages: string[]) => void
  setTextMaxLength: (length: number) => void
  setMinConfidence: (confidence: number) => void
  setMinLanguageConfidence: (confidence: number) => void
  resetFilters: () => void
  setTagSetters: (setters: string[]) => void
  setTagNamespaces: (namespaces: string[]) => void
  setTagMinConfidence: (confidence: number) => void
  setTagsMaxPerNsSetter: (max: number) => void
  setMetadataSetters: (setters: string[]) => void
  setMetadataMinConfidence: (confidence: number) => void
}
const itemFilterStorageOptions = {
  name: "detailFilters",
  storage: createJSONStorage<ItemDetailFiltersState>(() => persistLocalStorage),
}
export const initialDetailFilters = {
  text_setters: [],
  text_languages: [],
  text_min_confidence: 0,
  min_language_confidence: 0,
  text_max_length: 1000,
  tag_setters: [],
  tag_namespaces: [],
  tag_min_confidence: 0,
  tags_max_per_ns_setter: 10,
  metadata_setters: [],
  metadata_min_confidence: 0,
}

export const useDetailsPane = create(
  persist<ItemDetailFiltersState>(
    (set, get) => ({
      ...initialDetailFilters,
      setTagSetters: (setters: string[]) => set({ tag_setters: setters }),
      setTagNamespaces: (namespaces: string[]) =>
        set({ tag_namespaces: namespaces }),
      setTagMinConfidence: (confidence: number) =>
        set({ tag_min_confidence: confidence }),
      setTagsMaxPerNsSetter: (max: number) =>
        set({ tags_max_per_ns_setter: max }),
      resetFilters: () => set({ ...initialDetailFilters }),
      setTextSetters: (setters: string[]) => set({ text_setters: setters }),
      setTextLanguages: (languages: string[]) =>
        set({ text_languages: languages }),
      setMinConfidence: (confidence: number) =>
        set({ text_min_confidence: confidence }),
      setMinLanguageConfidence: (confidence: number) =>
        set({ min_language_confidence: confidence }),
      setTextMaxLength: (length: number) => set({ text_max_length: length }),
      setMetadataSetters: (setters: string[]) =>
        set({ metadata_setters: setters }),
      setMetadataMinConfidence: (confidence: number) =>
        set({ metadata_min_confidence: confidence }),
    }),
    itemFilterStorageOptions
  )
)

interface StringStore {
  strings: string[]
  add: (p: string) => void
  remove: (p: string) => void
}
const pathStorageOptions = {
  name: "customPaths",
  storage: createJSONStorage<StringStore>(() => persistLocalStorage),
}
export const useCustomPaths = create(
  persist<StringStore>(
    (set) => ({
      strings: [],
      add: (p: string) => set((state) => ({ strings: [...state.strings, p] })),
      remove: (p: string) => {
        set((state) => {
          const paths = state.strings.filter((path) => path !== p)
          return { strings: paths }
        })
      },
    }),
    pathStorageOptions
  )
)
const mimeStorageOptions = {
  name: "customMimes",
  storage: createJSONStorage<StringStore>(() => persistLocalStorage),
}
export const useCustomMimes = create(
  persist<StringStore>(
    (set) => ({
      strings: [],
      add: (p: string) => set((state) => ({ strings: [...state.strings, p] })),
      remove: (p: string) => {
        set((state) => {
          const paths = state.strings.filter((path) => path !== p)
          return { strings: paths }
        })
      },
    }),
    mimeStorageOptions
  )
)

const instantSearchStorageOptions = {
  name: "instantSearch",
  storage: createJSONStorage<InstantSearchState>(() => persistLocalStorage),
}
interface InstantSearchState {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  /**
   * Bumped by `commit()`. Only its changes are meaningful — see `commit`.
   */
  commitToken: number
  /**
   * Declare that the query state now in the URL is one to *run*, not one
   * being edited, so the update lock lets it through.
   *
   * The lock exists to stop a query firing while the user assembles it in the
   * sidebar. A surface that writes a whole query at once — a similarity swap,
   * a find-in-folder navigation — is not assembling anything: it is the
   * commit the lock is waiting for. Call this *after* awaiting the URL
   * writes, so the committed query is the one the search hook can already
   * see; committing first adopts the query being navigated away from.
   *
   * Not persisted with `enabled`, being per-session by nature — but it rides
   * in this store because it is meaningless apart from the lock.
   */
  commit: () => void
}

export const useInstantSearch = create(
  persist<InstantSearchState>(
    (set) => ({
      enabled: true,
      setEnabled: (enabled: boolean) => set({ enabled }),
      commitToken: 0,
      commit: () => set((state) => ({ commitToken: state.commitToken + 1 })),
    }),
    {
      ...instantSearchStorageOptions,
      // A restored token would be compared against a fresh render's and read
      // as a commit that never happened.
      partialize: (state) => ({ enabled: state.enabled }) as InstantSearchState,
    }
  )
)
