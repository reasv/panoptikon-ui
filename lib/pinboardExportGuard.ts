// One re-entrancy guard for every image export in the app.
//
// A second click while a composite is running would start a second
// full-resolution canvas and OOM the tab, and the surfaces that can fire
// one have multiplied: the board menus, the fullscreen bar, the selection
// toolbar, a pin's context menu. They are separate components — and Radix
// destroys a menu's component state on select — so the flag lives at module
// scope, outside all of them.

import { createMenuGuard } from "@/lib/menuGuard"

export const exportGuard = createMenuGuard()

/** True while any image export is in flight, anywhere in the app. */
export function useExporting(): boolean {
  return exportGuard.useBusy()
}
