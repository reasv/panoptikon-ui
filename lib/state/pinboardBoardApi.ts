"use client"
import { create } from "zustand"
import type { usePinboardLayoutActions } from "@/hooks/pinboardLayout"

// The mounted board's layout verbs, published for surfaces that live
// outside the board's subtree: the pinboard tab's chevron menu and the
// fullscreen bar. The board mutates ONE stable object every render (so
// values are always current) and registers/unregisters it on
// mount/unmount — subscribers re-render only when the board comes and
// goes, and read fresh values at the moment a menu opens.
export type PinboardBoardApi = Pick<
    ReturnType<typeof usePinboardLayoutActions>,
    | "changeLayout"
    | "fillViewport"
    | "fillViewportRows"
    | "justifyCurrentRows"
    | "autoCropToCells"
    | "clearAutoCrops"
    | "shiftLayout"
    | "mirrorLayout"
    | "rerollLayout"
    | "refitToView"
    | "reflowKeepProportions"
    | "growInPlace"
    | "hasLocks"
    | "hasAnchors"
> & {
    highWater: number
    isV1: boolean
    upgradeGrid: () => void
}

interface PinboardBoardApiState {
    api: PinboardBoardApi | null
    register: (api: PinboardBoardApi) => void
    unregister: (api: PinboardBoardApi) => void
}

export const usePinboardBoardApi = create<PinboardBoardApiState>()((set) => ({
    api: null,
    register: (api) => set({ api }),
    // Identity-guarded so a new board registering before the old one's
    // unmount cleanup runs (remounts) can't get its registration wiped
    unregister: (api) => set((s) => (s.api === api ? { api: null } : {})),
}))
