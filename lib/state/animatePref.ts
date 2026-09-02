/**
 * WHEN animated grid cells animate: the user's preference, per cell-size range
 * (docs/grid-hover-animate-implementation.md D2–D5).
 *
 * TWO RANGES, ONE SLOT EACH. A screenful of thirty 150px cells all animating
 * is a different picture from six 500px ones doing it, so the default differs
 * by range — hover-only below `SMALL_CELL_THRESHOLD_PX`, always above it — and
 * the preference records the two independently. An absent slot tracks the
 * default rather than freezing it, which is what lets the default keep moving
 * with the OS's reduced-motion setting (D5) and with a later product decision.
 *
 * NEVER THE URL, and that is a rule rather than an implementation choice: the
 * URL records what a search IS, and a link shared with someone else must not
 * reach into how their machine plays animations. It is also outside the
 * save-as-default machinery (lib/searchDefaults.ts) for the same reason — that
 * layer stamps values INTO urls. localStorage, like the file-action verb and
 * the size slider's page lock.
 *
 * Import-free apart from the box mechanism and the threshold, on purpose and
 * for the reason lib/scrollMode.ts gives: every decision below is pure
 * arithmetic over a stored object, and scripts/hoveranimate.test.mjs executes
 * it under plain node. The DOM is touched only from inside functions, so
 * importing this module starts nothing.
 */
import { isSmallCell } from "../gridCellSize"
import { type AnimateMode } from "../thumbnailTier"
import { createValueBox } from "./valueBox"

/** Which range a cell of a given width falls in. */
export type CellRange = "above" | "below"

/**
 * The stored shape. `true` = always animate, `false` = on hover, ABSENT = the
 * default for that range. Three states, not two, because "the user has not
 * said" and "the user said the same thing the default says" have to stay
 * distinguishable — otherwise the reduced-motion default (D5) could never
 * apply to someone who had once flipped the toggle back.
 */
export interface AnimatePref {
  above?: boolean
  below?: boolean
}

/** Everything the resolution below needs, published as one snapshot. */
export interface AnimateSettings {
  pref: AnimatePref
  /** The OS's `prefers-reduced-motion: reduce`. */
  reduceMotion: boolean
}

export const ANIMATE_PREF_STORAGE_KEY = "panoptikon.gridAnimatePref"

/** What a surface with no stored preference and no reduced-motion reads. */
export const DEFAULT_ANIMATE_SETTINGS: AnimateSettings = {
  pref: {},
  reduceMotion: false,
}

/** The range a cell of `cssWidth` belongs to — one comparison (D1). */
export function cellRange(cssWidth: number | null | undefined): CellRange {
  return isSmallCell(cssWidth) ? "below" : "above"
}

/**
 * The default for a range, which is what an absent slot resolves to.
 *
 * Reduced motion outranks the size rule and makes BOTH ranges hover-only (D5):
 * the user has asked their system not to animate things at them, and a grid
 * that starts thirty loops on arrival is exactly what that setting is about.
 * An explicit slot still wins over it — see `resolveAnimateMode` — because a
 * preference set in this app is a more specific answer than an OS-wide one.
 */
export function defaultAnimateMode(
  range: CellRange,
  reduceMotion: boolean
): AnimateMode {
  if (reduceMotion) return "hover"
  return range === "below" ? "hover" : "always"
}

/** The effective mode for a range: the slot if set, else the default. */
export function resolveAnimateMode(
  settings: AnimateSettings,
  range: CellRange
): AnimateMode {
  const slot = settings.pref[range]
  if (slot === undefined) return defaultAnimateMode(range, settings.reduceMotion)
  return slot ? "always" : "hover"
}

/**
 * The toggle's write (D4): ONE range's slot moves, the other is carried over
 * untouched. The control shows the effective value for the range currently
 * laid out, so a write from it can only ever mean that range — and crossing
 * the threshold afterwards must land on whatever the other range says, not on
 * a value that followed the pointer across.
 */
export function withAnimateSlot(
  pref: AnimatePref,
  range: CellRange,
  always: boolean
): AnimatePref {
  return { ...pref, [range]: always }
}

/**
 * Read a stored value back. Anything unusable — absent, unparseable, the wrong
 * shape, a hand-edited string — reads as "nothing stored", i.e. both ranges on
 * their defaults, which is a correct page rather than a broken one.
 */
export function parseAnimatePref(raw: string | null | undefined): AnimatePref {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof parsed !== "object" || parsed === null) return {}
  const record = parsed as Record<string, unknown>
  const pref: AnimatePref = {}
  if (typeof record.above === "boolean") pref.above = record.above
  if (typeof record.below === "boolean") pref.below = record.below
  return pref
}

// ---------------------------------------------------------------------------
// The runtime box
// ---------------------------------------------------------------------------

/**
 * The mechanism is lib/state/valueBox.ts. The custom equality is what keeps
 * the snapshot's identity stable across a `storage` event that changed
 * nothing (another tab writing an unrelated key notifies us too — the event
 * carries no useful filter for a key we can only compare by name), which is
 * what makes it a valid `useSyncExternalStore` snapshot.
 *
 * A MODULE SINGLETON, unlike the derived-page and grid-metrics boxes, and the
 * exception is deliberate: this value belongs to the BROWSER PROFILE rather
 * than to a mount, cross-tab sync needs one listener per document rather than
 * one per component, and the SSR hazard those two warn about does not apply —
 * on the server the box never leaves `DEFAULT_ANIMATE_SETTINGS`, which is also
 * what `getServerAnimateSettings` returns, so every request renders the same
 * markup the client hydrates with.
 */
const settings = createValueBox<AnimateSettings>(
  DEFAULT_ANIMATE_SETTINGS,
  (a, b) =>
    a.reduceMotion === b.reduceMotion &&
    a.pref.above === b.pref.above &&
    a.pref.below === b.pref.below
)

let bound = false

function readStored(): AnimatePref {
  try {
    return parseAnimatePref(window.localStorage.getItem(ANIMATE_PREF_STORAGE_KEY))
  } catch {
    // A browser with site data blocked throws on the ACCESSOR, not on the read
    // — so this catch is what makes the whole feature degrade to its defaults
    // there instead of crashing the grid.
    return {}
  }
}

/**
 * Bound ONCE per document and never released: two listeners for the lifetime
 * of the page, against a preference that any surface may ask about at any
 * time. Refcounting them would buy nothing and would re-read the store on
 * every grid mount.
 */
function bind(): void {
  if (bound || typeof window === "undefined") return
  bound = true
  const media = window.matchMedia("(prefers-reduced-motion: reduce)")
  const publish = () => {
    settings.set({ pref: readStored(), reduceMotion: media.matches })
  }
  media.addEventListener("change", publish)
  // Cross-tab sync (D3). `key` is null for a whole-store clear, which is a
  // change to ours too; any other key is somebody else's and bails.
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== ANIMATE_PREF_STORAGE_KEY) return
    publish()
  })
  publish()
}

/**
 * Subscribe to the effective settings, binding the document listeners on the
 * first subscriber. The first snapshot a component renders is therefore the
 * default and the stored value lands in the commit after it — which is exactly
 * what hydration needs, since the server cannot know either value.
 */
export function subscribeAnimateSettings(onChange: () => void): () => void {
  const unsubscribe = settings.subscribe(onChange)
  bind()
  return unsubscribe
}

export function getAnimateSettings(): AnimateSettings {
  return settings.get()
}

/** The SSR snapshot: the same object the box starts on. */
export function getServerAnimateSettings(): AnimateSettings {
  return DEFAULT_ANIMATE_SETTINGS
}

/**
 * Write one range's slot (D4) and publish it. The local publish is not
 * belt-and-braces: `storage` events fire in OTHER documents only, so the tab
 * that wrote is the one tab that would never hear about it.
 */
export function setAnimateSlot(range: CellRange, always: boolean): void {
  const current = settings.get()
  const pref = withAnimateSlot(current.pref, range, always)
  try {
    window.localStorage.setItem(ANIMATE_PREF_STORAGE_KEY, JSON.stringify(pref))
  } catch {
    // Storage refused (private mode, blocked site data). The preference still
    // applies for this session — publishing it is what the user asked for, and
    // failing to persist is not a reason to also ignore them.
  }
  settings.set({ pref, reduceMotion: current.reduceMotion })
}
