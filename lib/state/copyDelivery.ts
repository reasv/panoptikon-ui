import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { persistLocalStorage } from "./store"

// "Copy, don't download": the mode the video download surfaces run in. Off, a
// row saves the finished rendition as a file; on, it puts the file itself on
// the clipboard (the desktop Relay's copy verb, or the server host's own
// clipboard) so it can be pasted straight into a chat client or an upload
// form.
//
// Stored GLOBALLY rather than per surface, so every menu that offers the
// verb agrees about which one it is offering: the player's download control,
// the gallery overlay and a pin's context menu are three doorways into one
// preference, and a per-doorway flag would let them disagree about what the
// next press does.
//
// When copy is UNAVAILABLE (no paired relay with the copy feature, and a
// policy with backend-open actions disabled) the stored value stays exactly
// where the user left it and the surfaces simply render download verbs. The
// preference is not a claim that copying works here — it is what to do when
// it does, so a session on a restricted policy must not silently erase it.
interface CopyDelivery {
  copyInstead: boolean
  setCopyInstead: (copyInstead: boolean) => void
}

export const useCopyDelivery = create(
  persist<CopyDelivery>(
    (set) => ({
      copyInstead: false,
      setCopyInstead: (copyInstead: boolean) => set({ copyInstead }),
    }),
    {
      name: "copyDontDownload",
      storage: createJSONStorage<CopyDelivery>(() => persistLocalStorage),
    }
  )
)
