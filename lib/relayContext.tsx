"use client"

import { createContext, useContext } from "react"
import type { RelayShareFile, RelayShareOptions } from "@/lib/relayClient"

export type FileActionTarget = "relay" | "existing"

export type RelayContextValue = {
  detected: boolean
  paired: boolean
  pairing: boolean
  pairingPending: boolean
  // Paired AND the Relay advertises the copy_to_clipboard feature (§0.1). The
  // share button uses this to pick Copy over Download as its primary verb.
  canCopyFiles: boolean
  target: FileActionTarget
  setTarget: (target: FileActionTarget) => void
  pair: () => Promise<void>
  run: (action: "open_file" | "reveal_in_folder", path: string) => Promise<void>
  share: (file: RelayShareFile, options?: RelayShareOptions) => Promise<void>
  refresh: () => Promise<void>
}

export const inertRelayContext: RelayContextValue = {
  detected: false,
  paired: false,
  pairing: false,
  pairingPending: false,
  canCopyFiles: false,
  target: "existing",
  setTarget: () => {},
  pair: async () => {},
  run: async () => { throw new Error("Local Relay is unavailable") },
  share: async () => { throw new Error("Local Relay is unavailable") },
  refresh: async () => {},
}

export const RelayContext = createContext<RelayContextValue>(inertRelayContext)
export const useRelay = () => useContext(RelayContext)
