import { create } from "zustand"
import { components } from "../panoptikon"

interface SelectionState {
  selected: components["schemas"]["FileSearchResult"] | null
  setItem: (item: components["schemas"]["FileSearchResult"]) => void
  getSelected: () => components["schemas"]["FileSearchResult"] | null
}

export const useItemSelection = create<SelectionState>((set, get) => ({
  selected: null,
  setItem: (item: components["schemas"]["FileSearchResult"]) =>
    set({ selected: item }),
  getSelected: () => get().selected,
}))
