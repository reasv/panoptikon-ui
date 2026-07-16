import { createJSONStorage, persist } from "zustand/middleware"
import { persistLocalStorage } from "./store"
import { create } from "zustand"
import { useCallback, useEffect, useState } from "react"

// Define the shape of the state, where keys are strings and values are booleans.
interface FilterContainerState {
  openStates: { [key: string]: boolean }
  setOpen: (key: string) => (open: boolean) => void
  getOpen: (key: string, defaultOpen?: boolean) => boolean
}

const filterContainerStorage = {
  name: "filterContainerState",
  storage: createJSONStorage<FilterContainerState>(() => persistLocalStorage),
}

export const useFilterContainerState = create(
  persist<FilterContainerState>(
    (set, get) => ({
      openStates: {}, // Initialize with an empty object to hold key-value pairs for open states.
      setOpen: (key: string) => (open: boolean) =>
        set((state) => ({
          openStates: { ...state.openStates, [key]: open },
        })),
      getOpen: (key: string, defaultOpen: boolean = true) => {
        const state = get().openStates
        return state[key] !== undefined ? state[key] : defaultOpen
      },
    }),
    filterContainerStorage
  )
)

// Custom hook to use the open state and setter function for a specific key with a default value
export const useFilterContainerOpen = (
  key: string,
  defaultOpen: boolean = true
) => {
  const [isExpanded, setIsExpanded] = useState(defaultOpen)
  const [hydrated, setHydrated] = useState(false)

  const storedIsExpanded = useFilterContainerState((state) =>
    state.getOpen(key, defaultOpen)
  )
  // Select the stable store function and bind the key locally: selecting
  // state.setOpen(key) would mint a new closure per snapshot read, which
  // zustand v5's uncached-snapshot check rejects during SSR hydration.
  const setOpenForKey = useFilterContainerState((state) => state.setOpen)
  const setOpen = useCallback(
    (open: boolean) => setOpenForKey(key)(open),
    [setOpenForKey, key]
  )

  // Synchronize with the stored state after the initial render
  useEffect(() => {
    setIsExpanded(storedIsExpanded)
    setHydrated(true)
  }, [storedIsExpanded])

  return [isExpanded, setOpen] as const
}
