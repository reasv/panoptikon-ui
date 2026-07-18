// Creation defaults for the pinboard's board flags.
//
// Board state lives entirely in query parameters, and their nuqs codec
// defaults (the withDefault values in state/gallery.ts) define what an
// ABSENT parameter means in every pinboard URL ever shared — they are
// frozen wire format and can never change without silently rewriting
// existing boards. Opinionated defaults therefore live HERE instead, as a
// second layer that applies exactly once, when the first pin creates a
// board (see usePinBoard): every flag whose effective default differs from
// its codec default is stamped into the URL as an explicit parameter, in
// the same tick as the record write that created the board. From then on
// the URL is self-describing — future changes to these defaults never
// touch it, and a link renders identically on a machine with different
// user defaults, because this layer NEVER participates in URL parsing.
//
// Two sub-layers: the developer defaults below (free to change per
// version), overridden by user defaults saved to localStorage from the
// board menu ("Save Current Settings as Default"). A user default equal to
// the codec default simply stamps nothing — blank already means that.

export type PinboardDefaultableKey = "pba" | "pbc" | "psc" | "pg"

export const PINBOARD_DEFAULTABLE_KEYS: PinboardDefaultableKey[] = [
  "pba",
  "pbc",
  "psc",
  "pg",
]

interface DefaultableFlag {
  // Must equal the codec's withDefault in state/gallery.ts — frozen forever
  codecDefault: boolean
  // What a newly created board starts with (before user overrides)
  creationDefault: boolean
}

// New boards start with auto-layout + auto-crop ON: without them a fresh
// board is an unlaid-out pile, and the always-visible wand toggle is the
// discoverable off-switch for users who want manual control (arranging an
// item by hand also switches it off, see the board's gesture handling).
export const PINBOARD_DEFAULTABLE_FLAGS: Record<
  PinboardDefaultableKey,
  DefaultableFlag
> = {
  pba: { codecDefault: false, creationDefault: true }, // auto-layout
  pbc: { codecDefault: false, creationDefault: true }, // auto-crop to cells
  psc: { codecDefault: true, creationDefault: true }, // selection-verb crop
  pg: { codecDefault: false, creationDefault: false }, // grid background
}

const STORAGE_KEY = "pinboardUserDefaults"

// Only allowlisted keys with boolean values survive, so neither stale
// localStorage nor junk in the database's stored board flags can stamp
// junk into the URL. Null when the value isn't an object at all.
export function sanitizeBoardFlags(
  value: unknown
): Partial<Record<PinboardDefaultableKey, boolean>> | null {
  if (typeof value !== "object" || value === null) return null
  const out: Partial<Record<PinboardDefaultableKey, boolean>> = {}
  for (const key of PINBOARD_DEFAULTABLE_KEYS) {
    const v = (value as Record<string, unknown>)[key]
    if (typeof v === "boolean") out[key] = v
  }
  return out
}

export function loadUserDefaults(): Partial<
  Record<PinboardDefaultableKey, boolean>
> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return sanitizeBoardFlags(JSON.parse(raw)) ?? {}
  } catch {
    return {}
  }
}

export function saveUserDefaults(
  values: Record<PinboardDefaultableKey, boolean>
): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(values))
  } catch {
    // Storage full or blocked: defaults just don't persist
  }
}

export function clearUserDefaults(): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

// The values a board created right now would start with
export function effectiveCreationDefaults(): Record<
  PinboardDefaultableKey,
  boolean
> {
  const user = loadUserDefaults()
  const out = {} as Record<PinboardDefaultableKey, boolean>
  for (const key of PINBOARD_DEFAULTABLE_KEYS) {
    out[key] = user[key] ?? PINBOARD_DEFAULTABLE_FLAGS[key].creationDefault
  }
  return out
}
