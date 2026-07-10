// Single-slot safety stash for the version browser: when the user swaps a
// dirty (unsaved) board state for a stored version, the dirty layout is
// stashed here so it stays selectable in the version list. One slot per
// board, most recent wins; cleared by Save (which makes the ambiguity
// moot). sessionStorage: survives the panel closing and a tab reload, but
// doesn't leak into the database or across tabs.

const KEY_PREFIX = "pinboard-stash:"

export interface PinboardStash {
  layout: string[]
  time: number
}

function key(pinboardId: number): string {
  return `${KEY_PREFIX}${pinboardId}`
}

export function readStash(pinboardId: number): PinboardStash | null {
  try {
    const raw = sessionStorage.getItem(key(pinboardId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.layout)) return null
    return parsed as PinboardStash
  } catch {
    return null
  }
}

export function writeStash(pinboardId: number, layout: string[]): void {
  try {
    sessionStorage.setItem(
      key(pinboardId),
      JSON.stringify({ layout, time: Date.now() } satisfies PinboardStash)
    )
  } catch {
    // Quota or privacy-mode failure: the stash is a best-effort net;
    // browser back still recovers the state.
  }
}

export function clearStash(pinboardId: number): void {
  try {
    sessionStorage.removeItem(key(pinboardId))
  } catch {
    // ignore
  }
}
