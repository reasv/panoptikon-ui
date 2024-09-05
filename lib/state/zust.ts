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
