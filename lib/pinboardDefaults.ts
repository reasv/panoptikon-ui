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

export type PinboardDefaultableKey = "pba" | "pbc" | "psc" | "pg" | "pbp"

export const PINBOARD_DEFAULTABLE_KEYS: PinboardDefaultableKey[] = [
  "pba",
  "pbc",
  "psc",
  "pg",
  "pbp",
]

interface DefaultableFlag {
  // Must equal the codec's withDefault in state/gallery.ts — frozen forever
  codecDefault: boolean
  // What a newly created board starts with (before user overrides)
  creationDefault: boolean
  // How the flag is named in the "settings saved as default" summary, so
  // adding a key to the registry updates that sentence too. Use the
  // control's own on-screen label, capitalized exactly as the menu shows
  // it: the sentence sends the user looking for these switches, and a name
  // that appears nowhere in the UI sends them looking for nothing.
  label: string
}

// New boards start with auto-layout + auto-crop ON: without them a fresh
// board is an unlaid-out pile, and the always-visible wand toggle is the
// discoverable off-switch for users who want manual control (arranging an
// item by hand also switches it off, see the board's gesture handling).
export const PINBOARD_DEFAULTABLE_FLAGS: Record<
  PinboardDefaultableKey,
  DefaultableFlag
> = {
  // auto-layout
  pba: { codecDefault: false, creationDefault: true, label: "Auto-Layout" },
  // auto-crop to cells
  pbc: {
    codecDefault: false,
    creationDefault: true,
    label: "Auto-Crop to Cells",
  },
  // selection-verb crop (a toolbar icon toggle, so it has no menu label of
  // its own — named for what it does, in the same Title Case as the rest)
  psc: { codecDefault: true, creationDefault: true, label: "Selection Crop" },
  // grid background
  pg: { codecDefault: false, creationDefault: false, label: "Show Grid" },
  // proportional grid
  pbp: {
    codecDefault: false,
    creationDefault: false,
    label: "Scale With Window",
  },
}

// The flag names for the defaults-saved toast, in registry order.
export function defaultableFlagLabels(): string[] {
  return PINBOARD_DEFAULTABLE_KEYS.map(
    (key) => PINBOARD_DEFAULTABLE_FLAGS[key].label
  )
}

const STORAGE_KEY = "pinboardUserDefaults"

// Gravity is a creation default too, but it is NOT a defaultable flag: it
// lives in the layout param's grid token (see pinboardGrid.ts), not in a URL
// parameter and not in pinboards.flags. So it rides the same localStorage
// payload as a lone extra key, and the first-pin edge stamps it by
// serializing the initial token with "~f" instead of by writing a parameter.
export interface PinboardUserDefaults
  extends Partial<Record<PinboardDefaultableKey, boolean>> {
  gravity?: boolean
}

// What a newly created board starts with when the user saved no default:
// gravity on is the behavior every board has had until now.
export const GRAVITY_CREATION_DEFAULT = true

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

// The stored-flags sanitizer plus the token-backed gravity key. Kept
// separate from sanitizeBoardFlags on purpose: that one also guards the
// board flags the gateway stores, where gravity has no business appearing.
// Absence is tolerated everywhere — payloads written before gravity existed
// simply resolve it to its creation default.
export function sanitizeUserDefaults(value: unknown): PinboardUserDefaults {
  const flags = sanitizeBoardFlags(value)
  if (!flags) return {}
  const gravity = (value as Record<string, unknown>).gravity
  return typeof gravity === "boolean" ? { ...flags, gravity } : flags
}

export function loadUserDefaults(): PinboardUserDefaults {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return sanitizeUserDefaults(JSON.parse(raw))
  } catch {
    return {}
  }
}

export function saveUserDefaults(
  values: Record<PinboardDefaultableKey, boolean> & { gravity: boolean }
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
> & { gravity: boolean } {
  const user = loadUserDefaults()
  const out = {} as Record<PinboardDefaultableKey, boolean> & {
    gravity: boolean
  }
  for (const key of PINBOARD_DEFAULTABLE_KEYS) {
    out[key] = user[key] ?? PINBOARD_DEFAULTABLE_FLAGS[key].creationDefault
  }
  out.gravity = user.gravity ?? GRAVITY_CREATION_DEFAULT
  return out
}
