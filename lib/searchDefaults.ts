// Creation defaults for the search view's presentation parameters.
//
// Search state lives entirely in query parameters, and their nuqs codec
// defaults (the withDefault values in state/gallery.ts and
// state/searchQuery/searchQueryKeyMaps.ts) define what an ABSENT parameter
// means in every search URL ever shared — they are frozen wire format and
// can never change without silently re-rendering existing links in a
// different mode. Opinionated defaults therefore live HERE instead, as a
// second layer that applies exactly once, when a search SESSION is created
// (the search page loading with none of `vm`, `page`, `page_size`, `top`,
// `gi` present — see MultiSearchView's stamping effect): every parameter
// whose effective default differs from its codec default is stamped into
// the URL as an explicit parameter, in one tick. From then on the URL is
// self-describing — future changes to these defaults never touch it, and a
// link renders identically on a machine with different user defaults,
// because this layer NEVER participates in URL parsing.
//
// Two sub-layers: the developer defaults below (free to change per
// version), overridden by user defaults saved to localStorage from the mode
// toggle's menu ("Save current view as default"). A user default equal to
// the codec default simply stamps nothing — blank already means that, which
// is why a user who has saved nothing gets byte-identical URLs to the ones
// they got before this layer existed.

import type { ViewMode } from "./state/gallery"

export type SearchDefaultableKey = "vm" | "page_size"

export const SEARCH_DEFAULTABLE_KEYS: SearchDefaultableKey[] = [
  "vm",
  "page_size",
]

/** Every defaultable parameter, resolved to a value. */
export interface ResolvedSearchDefaults {
  vm: ViewMode
  page_size: number
}

interface DefaultableParam<K extends SearchDefaultableKey> {
  // Must equal the codec's withDefault for the same URL key — frozen forever
  codecDefault: ResolvedSearchDefaults[K]
  // What a newly created search session starts with (before user overrides)
  creationDefault: ResolvedSearchDefaults[K]
  // How the parameter is named in the "saved as default" summary, so adding
  // a key to the registry updates that sentence too. Use the control's own
  // on-screen label where it has one, capitalized exactly as the UI shows
  // it: the sentence sends the user looking for these controls, and a name
  // that appears nowhere in the UI sends them looking for nothing.
  label: string
}

export const SEARCH_DEFAULTABLE_PARAMS: {
  [K in SearchDefaultableKey]: DefaultableParam<K>
} = {
  // The paged/scroll toggle in the results header. Its only on-screen name
  // is its tooltip ("Switch to scroll browsing"), hence the label naming
  // what it controls in the same words.
  //
  // "pages" THIS RELEASE — scroll ships opt-in, saved by the user through
  // the toggle's menu. Making scroll the product default later is this one
  // line and nothing else: it cannot affect a single existing URL, because
  // the codec default above it stays "pages" forever.
  vm: { codecDefault: "pages", creationDefault: "pages", label: "Browsing Mode" },
  // The sidebar's Page Size slider (components/sidebar/base/PageSizeControl)
  page_size: { codecDefault: 10, creationDefault: 10, label: "Page Size" },
}

// The parameter names for the defaults-saved toast, in registry order.
export function searchDefaultableLabels(): string[] {
  return SEARCH_DEFAULTABLE_KEYS.map((key) => SEARCH_DEFAULTABLE_PARAMS[key].label)
}

const STORAGE_KEY = "searchUserDefaults"

export type SearchUserDefaults = Partial<ResolvedSearchDefaults>

// The bounds the Page Size control itself enforces (MIN/MAX_PAGE_SIZE).
// Restated rather than imported: that module is a React component and this
// one is deliberately import-free, and these are the bounds of what may be
// STAMPED, which is a URL question rather than a slider question.
const MIN_PAGE_SIZE = 1
const MAX_PAGE_SIZE = 10000

// Only allowlisted keys with in-domain values survive, so stale or
// hand-edited localStorage cannot stamp junk into a URL — the discipline
// sanitizeBoardFlags applies to the board flags. `vm` must be exactly one of
// the codec's two enum members (anything else would parse back as "pages"
// while sitting in the URL as noise), and `page_size` must be an integer in
// the control's own range (a fractional or absurd size is a request the
// backend would answer badly, stamped into every URL of the session).
export function sanitizeSearchDefaults(value: unknown): SearchUserDefaults {
  if (typeof value !== "object" || value === null) return {}
  const source = value as Record<string, unknown>
  const out: SearchUserDefaults = {}
  const vm = source.vm
  if (vm === "pages" || vm === "scroll") out.vm = vm
  const pageSize = source.page_size
  if (typeof pageSize === "number" && Number.isFinite(pageSize)) {
    const floored = Math.floor(pageSize)
    if (floored >= MIN_PAGE_SIZE) {
      out.page_size = Math.min(floored, MAX_PAGE_SIZE)
    }
  }
  return out
}

export function loadUserDefaults(): SearchUserDefaults {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return sanitizeSearchDefaults(JSON.parse(raw))
  } catch {
    return {}
  }
}

export function saveUserDefaults(values: ResolvedSearchDefaults): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(sanitizeSearchDefaults(values))
    )
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

// The pure half of effectiveCreationDefaults: user defaults in, resolved
// values out. Split out so the resolution and the stamp derived from it can
// be tested without a localStorage — the storage access is the only part
// that needs a browser, and it is the part with no logic in it.
export function effectiveCreationDefaultsFrom(
  user: SearchUserDefaults
): ResolvedSearchDefaults {
  return {
    vm: user.vm ?? SEARCH_DEFAULTABLE_PARAMS.vm.creationDefault,
    page_size:
      user.page_size ?? SEARCH_DEFAULTABLE_PARAMS.page_size.creationDefault,
  }
}

/** The values a search session created right now would start with. */
export function effectiveCreationDefaults(): ResolvedSearchDefaults {
  return effectiveCreationDefaultsFrom(loadUserDefaults())
}

/**
 * What a fresh session must WRITE: the resolved defaults, minus everything
 * a blank URL already means.
 *
 * Absence is the codec default, so stamping a codec-default value would add
 * a parameter that says what the URL already said — noise in every link the
 * session produces, and (for `vm`) a parameter nuqs would strip on the next
 * write anyway (clearOnDefault). With the shipped creation defaults equal to
 * the codec defaults, a user who has saved nothing therefore stamps NOTHING
 * and their URLs are byte-identical to what they were before this layer
 * existed — the property scripts/scrollmode.test.mjs asserts.
 */
export function creationStamp(
  resolved: ResolvedSearchDefaults
): SearchUserDefaults {
  const stamp: SearchUserDefaults = {}
  if (resolved.vm !== SEARCH_DEFAULTABLE_PARAMS.vm.codecDefault) {
    stamp.vm = resolved.vm
  }
  if (resolved.page_size !== SEARCH_DEFAULTABLE_PARAMS.page_size.codecDefault) {
    stamp.page_size = resolved.page_size
  }
  return stamp
}

/**
 * The URL parameters a session-creating load must not stamp over.
 *
 * Any of them present means the URL is a bookmark, a share or a navigation
 * and already carries its own presentation — `?page=3` with no `vm` is a
 * legacy paginated link and must stay one. Filter parameters (`tag.*`,
 * `at.*`, …) deliberately do NOT appear here: a shared filter link with no
 * presentation parameters gets the recipient's presentation preferences,
 * which is a presentation-only difference over an identical result set
 * (design §7).
 *
 * URL keys as literals — `top` is `GRID_SCROLL_ANCHOR_KEY`
 * (lib/state/gridScroll.ts) — because this module is deliberately
 * import-free: every function in it is pure, which is what lets
 * scripts/scrollmode.test.mjs execute them under plain node, and the state
 * modules that own the keys drag in nuqs and React.
 */
export const SESSION_PARAM_KEYS = ["vm", "page", "page_size", "top", "gi"]
