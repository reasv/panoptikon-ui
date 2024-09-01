import { create } from "zustand"
import { components } from "../panoptikon"
import { itemEquals } from "@/components/OpenFileDetails"

interface SelectionState {
  selected: components["schemas"]["FileSearchResult"] | null
  setItem: (item: components["schemas"]["FileSearchResult"]) => void
  getSelected: () => components["schemas"]["FileSearchResult"] | null
}

export const useItemSelection = create<SelectionState>((set, get) => ({
  selected: null,
  setItem: (item: components["schemas"]["FileSearchResult"]) => {
    const prev = get().selected
    if (prev && itemEquals(prev, item)) return
    set({ selected: item })
  },
  getSelected: () => get().selected,
}))
