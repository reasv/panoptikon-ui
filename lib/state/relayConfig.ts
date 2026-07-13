import { createJSONStorage, persist } from "zustand/middleware"
import { persistLocalStorage } from "./store"
import { create } from "zustand"

interface RelayV1State {
  enabled: boolean
  relayURL: string
  instanceId: string
  credential: string
  pairingRequestId: string
  setEnabled: (enabled: boolean) => void
  setRelayURL: (url: string) => void
  setPairingRequestId: (id: string) => void
  setPaired: (instanceId: string, credential: string) => void
  clearPairing: () => void
}

export const useRelayConfigState = create(
  persist<RelayV1State>(
    (set) => ({
      enabled: false,
      relayURL: "http://127.0.0.1:17600",
      instanceId: "",
      credential: "",
      pairingRequestId: "",
      setEnabled: (enabled) => set({ enabled }),
      setRelayURL: (relayURL) => set({ relayURL }),
      setPairingRequestId: (pairingRequestId) => set({ pairingRequestId }),
      setPaired: (instanceId, credential) => set({ instanceId, credential, pairingRequestId: "", enabled: true }),
      clearPairing: () => set({ instanceId: "", credential: "", pairingRequestId: "", enabled: false }),
    }),
    { name: "panoptikonRelayV1State", storage: createJSONStorage(() => persistLocalStorage) },
  ),
)
