import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { persistLocalStorage } from "./store"

// The size slider's page-size LOCK (docs/search-scroll-mode-design.md §9).
//
// By default a cell-size commit co-writes `page_size` so the screen-to-items
// ratio survives the change — smaller cells mean more of them on screen, and a
// page that no longer fills the viewport (or overflows it by four screenfuls)
// is the thing the user did not ask for. The lock decouples the two for
// someone who has picked a page size deliberately.
//
// A PREFERENCE, not URL state, and the distinction is the point: the URL
// records the OUTCOME (a cell width and a page size, both explicit), while
// this only decides what a future drag writes. Putting it in the URL would
// mean a shared link changed how the recipient's slider behaves, which is not
// something a link should carry. localStorage, like the file-action verb and
// the search creation defaults.
interface CellSizePageLock {
  /** True = a cell-size commit leaves `page_size` alone. */
  locked: boolean
  setLocked: (locked: boolean) => void
}

export const useCellSizePageLock = create(
  persist<CellSizePageLock>(
    (set) => ({
      locked: false,
      setLocked: (locked: boolean) => set({ locked }),
    }),
    {
      name: "gridCellSizePageLock",
      storage: createJSONStorage<CellSizePageLock>(() => persistLocalStorage),
    }
  )
)
