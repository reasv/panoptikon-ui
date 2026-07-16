"use client"

import { createContext, useContext } from "react"

export type FileActionTarget = "relay" | "existing"

export type RelayContextValue = {
  detected: boolean
  paired: boolean
  pairing: boolean
  pairingPending: boolean
  target: FileActionTarget
  setTarget: (target: FileActionTarget) => void
  pair: () => Promise<void>
  run: (action: "open_file" | "reveal_in_folder", path: string) => Promise<void>
  refresh: () => Promise<void>
}

export const inertRelayContext: RelayContextValue = {
  detected: false,
  paired: false,
  pairing: false,
  pairingPending: false,
  target: "existing",
  setTarget: () => {},
  pair: async () => {},
  run: async () => { throw new Error("Local Relay is unavailable") },
  refresh: async () => {},
}

export const RelayContext = createContext<RelayContextValue>(inertRelayContext)
export const useRelay = () => useContext(RelayContext)
