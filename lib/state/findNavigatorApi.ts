"use client"
import { create } from "zustand"
import type {
  OrderArgsType,
  orderByType,
} from "@/lib/state/searchQuery/searchQueryKeyMaps"

export interface FindNavigationData {
  folder: string
  page: number
  index: number
  order_by: orderByType
  order: OrderArgsType["order"]
  page_size: number
}

// The find-in-folder machinery, published by the ONE FindNavigator the
// search page mounts. FindButton is mounted per grid cell, per pin and per
// strip item; giving each instance its own URL-state hooks (a full
// useResetSearchQueryState plus four more families) made every mounted
// button a subscriber of ~27 nuqs hook families — which turned every URL
// write on the page into hundreds of re-rendered hook instances and
// getSnapshot checks (the sidebar-toggle jank). The buttons instead call
// through this handle at interaction time; same idiom as
// usePinboardBoardApi (one stable object, mutated every render, registered
// while mounted).
export interface FindNavigatorApi {
  getNavigationData(
    id: number | string,
    id_type: "file_id" | "sha256",
    path: string
  ): Promise<FindNavigationData | undefined>
  buildLink(data: FindNavigationData): string
  navigate(data: FindNavigationData): Promise<void>
}

interface FindNavigatorState {
  api: FindNavigatorApi | null
  // Bumped when the state a prefetched link was built from (ordering,
  // selected DBs) changes, so buttons drop their stale hrefs — the
  // dependency list the buttons' own link-reset effect used to carry.
  linkEpoch: number
  register: (api: FindNavigatorApi) => void
  unregister: (api: FindNavigatorApi) => void
  bumpLinkEpoch: () => void
}

export const useFindNavigatorApi = create<FindNavigatorState>()((set) => ({
  api: null,
  linkEpoch: 0,
  register: (api) => set({ api }),
  // Identity-guarded so a remounting navigator registering before the old
  // one's unmount cleanup runs can't get its registration wiped
  unregister: (api) => set((s) => (s.api === api ? { api: null } : {})),
  bumpLinkEpoch: () => set((s) => ({ linkEpoch: s.linkEpoch + 1 })),
}))
