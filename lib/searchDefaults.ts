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
//
// What the registry below actually covers, exactly: the resolution
// (effectiveCreationDefaultsFrom), the stamp derived from it (creationStamp)
// and the defaults-saved toast (describeStoredDefaults) all iterate
// SEARCH_DEFAULTABLE_KEYS, so a key added there is resolved, stamped and
// named with no further edits. Two things are NOT derived and must be
// updated by hand: SESSION_PARAM_KEYS below (a stampable key that does not
// block stamping would be overwritten on the next load of a URL carrying it
// — scripts/scrollmode.test.mjs asserts the containment), and the
// per-setter dispatch in the stamping effect (app/search/SearchPage.tsx),
// where each key needs its own nuqs setter call. That dispatch is
// irreducibly manual: the setters are hooks, one per parameter, and this
// module is deliberately import-free.

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

/**
 * The defaults-saved toast's subject: every key that was actually STORED,
 * named and shown with the value that was stored for it — "Browsing Mode:
 * scroll, Page Size: 100", in registry order.
 *
 * Built from saveUserDefaults' return value rather than from the gesture,
 * because sanitizeSearchDefaults can drop or clamp what the user tried to
 * save (a `?page_size=0` view means "no LIMIT" and stores no page size at
 * all; a hand-typed 20000 stores as 10000). A toast that named the gesture
 * would promise a default that no future session will ever get.
 */
export function describeStoredDefaults(stored: SearchUserDefaults): string {
  return SEARCH_DEFAULTABLE_KEYS
    .filter((key) => stored[key] !== undefined)
    .map((key) => `${SEARCH_DEFAULTABLE_PARAMS[key].label}: ${stored[key]}`)
    .join(", ")
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

/**
 * Saves, and returns WHAT WAS SAVED: the sanitized record, which is not
 * always what was passed in (see describeStoredDefaults). The caller's toast
 * is built from this return value, so the sentence the user reads is the
 * stored reality rather than the gesture they made.
 */
export function saveUserDefaults(
  values: ResolvedSearchDefaults
): SearchUserDefaults {
  const stored = sanitizeSearchDefaults(values)
  if (typeof window === "undefined") return stored
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // Storage full or blocked: defaults just don't persist
  }
  return stored
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
  for (const key of SEARCH_DEFAULTABLE_KEYS) {
    if (resolved[key] !== SEARCH_DEFAULTABLE_PARAMS[key].codecDefault) {
      // `key` is a union here, so TypeScript computes the write type of
      // stamp[key] as the intersection of the two property types and cannot
      // see that both sides land on the same K. One localized cast, over an
      // assignment whose correctness the loop's own types establish.
      stamp[key] = resolved[key] as never
    }
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

/**
 * Whether a load creates a search session — the one predicate both callers
 * in app/search/SearchPage.tsx use (the mount-time snapshot and the live
 * `window.location.search` re-check just before stamping).
 *
 * PRESENCE, never value: `?page=0` and `?top=0` are parameters the URL
 * carries, so they are not a fresh session and they block stamping, exactly
 * like `?page=3`. Anything that reasoned about the value would have to
 * decide what a zero means, and every such URL was written by something —
 * a share, a Back, a mode switch — that already stated its presentation.
 *
 * Typed structurally so both a URLSearchParams and Next's read-only
 * ReadonlyURLSearchParams satisfy it without this module importing either.
 */
export function isFreshSession(params: { has(key: string): boolean }): boolean {
  return !SESSION_PARAM_KEYS.some((key) => params.has(key))
}
