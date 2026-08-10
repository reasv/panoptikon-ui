import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { persistLocalStorage } from "./store"

// The verb occupying the collapsed corner slot of the grid overlay's file
// action cluster: whichever of the four actions was used last, anywhere.
// Persisted so a "copy, copy, copy…" (or "open, open, open…") session
// survives a reload with its one-click verb intact.
export type FileActionVerb = "copy" | "open" | "folder" | "download"

interface LastFileAction {
  verb: FileActionVerb
  setVerb: (verb: FileActionVerb) => void
}

export const useLastFileAction = create(
  persist<LastFileAction>(
    (set) => ({
      verb: "copy",
      setVerb: (verb: FileActionVerb) => set({ verb }),
    }),
    {
      name: "fileActionVerb",
      storage: createJSONStorage<LastFileAction>(() => persistLocalStorage),
    }
  )
)
