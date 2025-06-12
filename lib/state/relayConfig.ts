import { createJSONStorage, persist } from "zustand/middleware"
import { persistLocalStorage } from "./store"
import { create } from "zustand"
import { useEffect, useState } from "react"

// Define the shape of the state, where keys are strings and values are booleans.
interface RelayConfigState {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  relayURL: string
  setRelayURL: (url: string) => void
  apiKey: string
  setApiKey: (key: string) => void
}

const relayConfigStateStorage = {
  name: "relayConfigState",
  storage: createJSONStorage<RelayConfigState>(() => persistLocalStorage),
}

export const useRelayConfigState = create(
  persist<RelayConfigState>(
    (set, get) => ({
      enabled: false,
      setEnabled: (enabled: boolean) => set({ enabled }),
      relayURL: "http://127.0.0.1:17600",
      setRelayURL: (url: string) => set({ relayURL: url }),
      apiKey: "",
      setApiKey: (key: string) => set({ apiKey: key }),
    }),
    relayConfigStateStorage
  )
)
