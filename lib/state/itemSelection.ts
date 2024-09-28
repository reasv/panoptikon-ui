import { create } from "zustand"
import { components } from "../panoptikon"
import { itemEquals } from "@/components/OpenFileDetails"

interface SelectionState {
  selected: SearchResult | null
  setItem: (item: SearchResult) => void
  getSelected: () => SearchResult | null
}

export const useItemSelection = create<SelectionState>((set, get) => ({
  selected: null,
  setItem: (item: SearchResult) => {
    const prev = get().selected
    if (prev && itemEquals(prev, item)) return
    set({ selected: item })
  },
  getSelected: () => get().selected,
}))
