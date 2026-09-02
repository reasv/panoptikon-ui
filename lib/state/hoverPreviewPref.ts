/**
 * WHETHER a video cell previews on hover, and how far it may go to do it
 * (docs/video-hover-preview-implementation.md V5–V8).
 *
 * THREE LAYERS, resolved in one direction only. The SERVER publishes what this
 * policy and this deployment allow (`hover_preview` in `/api/client-config`,
 * already the conjunction of the policy override, the server default and the
 * transcode capability — V8). The BROWSER preference below can only ever turn
 * one of those off: a preference is a request not to spend the user's
 * bandwidth and their machine's decoder, never a way around a policy. So
 * `resolveHoverPreview` is an AND, and a server that reports nothing at all
 * (`null` — an older Server, or one without the feature) resolves to both off,
 * which is exactly today's grid.
 *
 * NEVER THE URL, for the reason lib/state/animatePref.ts gives at length: the
 * URL records what a search IS, and a link shared with someone else must not
 * reach into how their machine spends its network. localStorage, like the
 * animate preference this is modelled on line for line.
 *
 * Import-free apart from the box mechanism, on purpose and for the reason
 * lib/state/animatePref.ts gives: every decision here is arithmetic over a
 * stored object, and scripts/videopreview.test.mjs executes it under plain
 * node. The DOM is touched only from inside the box functions, so importing
 * this module starts nothing.
 */
import { createValueBox } from "./valueBox"

/**
 * The two rungs, as one answer. `direct` is rung 0 (mount the ORIGINAL file,
 * which this browser can already decode); `transcode` is rung 1 (ask the
 * server for a 16 s preview encode of one it cannot). They are independent
 * facts on the wire — a policy may allow the first and deny the second — even
 * though the control that writes the preference offers only the three
 * combinations that make sense to a person (see `HoverPreviewChoice`).
 */
export interface HoverPreviewCapability {
  direct: boolean
  transcode: boolean
}

/**
 * The FOUR possible answers, interned.
 *
 * Identity matters here in a way it does not for an ordinary pure function:
 * the resolved capability is handed to hundreds of memoized grid cards as a
 * prop, and a freshly-built object per render would defeat that memo for every
 * visible card on every scroll frame — the exact per-frame re-execution
 * `React.memo` on `SearchResultImage` exists to stop. Four frozen constants
 * mean the prop moves only when the ANSWER moves.
 */
export const HOVER_PREVIEW_OFF: HoverPreviewCapability = Object.freeze({
  direct: false,
  transcode: false,
})
export const HOVER_PREVIEW_DIRECT: HoverPreviewCapability = Object.freeze({
  direct: true,
  transcode: false,
})
export const HOVER_PREVIEW_ALL: HoverPreviewCapability = Object.freeze({
  direct: true,
  transcode: true,
})
/**
 * Reachable only from a wire value that says so (a deployment that allows the
 * preview encode but not the direct mount). Nothing in the UI writes it.
 */
export const HOVER_PREVIEW_TRANSCODE_ONLY: HoverPreviewCapability = Object.freeze({
  direct: false,
  transcode: true,
})

/** The interned constant for a pair of booleans. */
export function hoverPreviewCapability(
  direct: boolean,
  transcode: boolean
): HoverPreviewCapability {
  if (direct) return transcode ? HOVER_PREVIEW_ALL : HOVER_PREVIEW_DIRECT
  return transcode ? HOVER_PREVIEW_TRANSCODE_ONLY : HOVER_PREVIEW_OFF
}

/**
 * The stored shape. An ABSENT slot follows the server, which is not the same
 * as `true`: it means the user has not said, so a later change to the server's
 * default (or to a policy) reaches them. Only `false` is a decision this side
 * records — the preference can only subtract (see the module doc).
 */
export interface HoverPreviewPref {
  direct?: boolean
  transcode?: boolean
}

export const HOVER_PREVIEW_PREF_STORAGE_KEY = "panoptikon.hoverPreviewPref"

/** What a browser with nothing stored reads. */
export const DEFAULT_HOVER_PREVIEW_PREF: HoverPreviewPref = {}

/**
 * The three positions the toggle offers (A6), which are the only combinations
 * worth a control: no previews at all; previews of files this browser can
 * already play; and those plus a server-side encode for the ones it cannot.
 * "transcode but not direct" is expressible on the wire and is not a thing a
 * person would ask for.
 */
export type HoverPreviewChoice = "off" | "originals" | "all"

/**
 * THE RESOLUTION (V5 ∧ V6 ∧ V7), and the only place the three layers meet.
 *
 * `server` null is "this Server does not have the feature" — both rungs off,
 * and that is also what holds while `/api/client-config` is in flight, so a
 * loading page never mounts a `<video>` it may not be allowed to.
 *
 * A preference slot can only turn a rung OFF: `pref.direct === false` denies
 * it, and anything else (absent, `true`, a hand-edited string the parser
 * dropped) follows the server. That asymmetry is the whole rule — see the
 * module doc.
 */
export function resolveHoverPreview(
  server: HoverPreviewCapability | null | undefined,
  pref: HoverPreviewPref
): HoverPreviewCapability {
  if (!server) return HOVER_PREVIEW_OFF
  const direct = server.direct && pref.direct !== false
  const transcode = server.transcode && pref.transcode !== false
  return hoverPreviewCapability(direct, transcode)
}

/**
 * Which segment of the control is lit, for an already-resolved answer.
 *
 * The EFFECTIVE value, not the stored one, on the same rule the animate
 * toggle follows (D4): the control describes the grid the user is looking at.
 * A stored "all" against a policy that denies the encode reads "Originals",
 * and the "All" segment is disabled beside it rather than lit and inert.
 */
export function hoverPreviewChoice(
  resolved: HoverPreviewCapability
): HoverPreviewChoice {
  if (!resolved.direct && !resolved.transcode) return "off"
  return resolved.transcode ? "all" : "originals"
}

/**
 * The toggle's write. BOTH slots move, unlike the animate preference's
 * per-range write, and for a structural reason rather than a stylistic one:
 * the three positions are points on ONE scale, so leaving the other slot on
 * whatever it happened to hold would make "Originals" mean two different
 * things depending on what was picked before it.
 *
 * A SLOT IS ONLY WRITTEN FOR A RUNG THE SERVER ACTUALLY OFFERED, and that is
 * the whole reason `capability` is a parameter rather than an afterthought.
 * On a server where the encode rung is denied, the control already SHOWS
 * "Originals" as the effective answer, so clicking it is a visual no-op — and
 * a write of `transcode: false` there would silently record a decision the
 * user never made, in a slot they had no control to express it with ("All" is
 * disabled beside it). If that server later allowed the encode — hardware
 * installed, `hover_preview = "on"`, a policy relaxed — they would never get
 * it, with nothing on screen to say why. So a rung the server did not offer
 * leaves its slot ABSENT (and clears a stale one), which is the state that
 * means "follow the server".
 *
 * For a rung that WAS offered the slot is written either way, `true` included:
 * that looks redundant against a resolution treating absent and `true` alike,
 * and is not — it is how "the user asked for this" is distinguishable from
 * "the user has not said", and the reason nothing here needs a fourth state.
 */
export function withHoverPreviewSlot(
  pref: HoverPreviewPref,
  choice: HoverPreviewChoice,
  capability: HoverPreviewCapability | null | undefined
): HoverPreviewPref {
  const next: HoverPreviewPref = { ...pref }
  writeOfferedSlot(next, "direct", choice !== "off", capability?.direct)
  writeOfferedSlot(next, "transcode", choice === "all", capability?.transcode)
  return next
}

/** One slot of the write above: recorded when offered, cleared when not. */
function writeOfferedSlot(
  pref: HoverPreviewPref,
  slot: keyof HoverPreviewPref,
  value: boolean,
  offered: boolean | undefined
): void {
  if (offered) pref[slot] = value
  else delete pref[slot]
}

/**
 * Read a stored value back. Anything unusable — absent, unparseable, the wrong
 * shape, a hand-edited string — reads as "nothing stored", i.e. both rungs
 * following the server, which is a correct page rather than a broken one.
 */
export function parseHoverPreviewPref(
  raw: string | null | undefined
): HoverPreviewPref {
  if (!raw) return DEFAULT_HOVER_PREVIEW_PREF
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_HOVER_PREVIEW_PREF
  }
  if (typeof parsed !== "object" || parsed === null) {
    return DEFAULT_HOVER_PREVIEW_PREF
  }
  const record = parsed as Record<string, unknown>
  const pref: HoverPreviewPref = {}
  if (typeof record.direct === "boolean") pref.direct = record.direct
  if (typeof record.transcode === "boolean") pref.transcode = record.transcode
  return pref
}

// ---------------------------------------------------------------------------
// The runtime box
// ---------------------------------------------------------------------------

/**
 * The mechanism is lib/state/valueBox.ts, and the reasoning is
 * lib/state/animatePref.ts's verbatim: a MODULE SINGLETON, because this value
 * belongs to the browser profile rather than to a mount, cross-tab sync wants
 * one listener per document, and on the server the box never leaves the
 * default — which is also what `getServerHoverPreviewPref` returns, so every
 * request renders the markup the client hydrates with.
 *
 * The custom equality keeps the snapshot's identity stable across a `storage`
 * event that changed nothing (another tab writing an unrelated key notifies us
 * too), which is what makes it a valid `useSyncExternalStore` snapshot.
 */
const box = createValueBox<HoverPreviewPref>(
  DEFAULT_HOVER_PREVIEW_PREF,
  (a, b) => a.direct === b.direct && a.transcode === b.transcode
)

let bound = false

function readStored(): HoverPreviewPref {
  try {
    return parseHoverPreviewPref(
      window.localStorage.getItem(HOVER_PREVIEW_PREF_STORAGE_KEY)
    )
  } catch {
    // A browser with site data blocked throws on the ACCESSOR, not on the
    // read — so this catch is what makes the feature degrade to "follow the
    // server" there instead of crashing the grid.
    return DEFAULT_HOVER_PREVIEW_PREF
  }
}

/** Bound ONCE per document and never released — animatePref.ts's rule. */
function bind(): void {
  if (bound || typeof window === "undefined") return
  bound = true
  window.addEventListener("storage", (event) => {
    // `key` is null for a whole-store clear, which is a change to ours too;
    // any other key is somebody else's and bails.
    if (event.key !== null && event.key !== HOVER_PREVIEW_PREF_STORAGE_KEY) return
    box.set(readStored())
  })
  box.set(readStored())
}

export function subscribeHoverPreviewPref(onChange: () => void): () => void {
  const unsubscribe = box.subscribe(onChange)
  bind()
  return unsubscribe
}

export function getHoverPreviewPref(): HoverPreviewPref {
  return box.get()
}

/** The SSR snapshot: the same object the box starts on. */
export function getServerHoverPreviewPref(): HoverPreviewPref {
  return DEFAULT_HOVER_PREVIEW_PREF
}

/**
 * Write the choice and publish it. The local publish is not belt-and-braces:
 * `storage` events fire in OTHER documents only, so the tab that wrote is the
 * one tab that would never hear about it.
 */
export function setHoverPreviewChoice(
  choice: HoverPreviewChoice,
  /**
   * WHAT THE SERVER OFFERS, handed in by the control that read it — see
   * `withHoverPreviewSlot`, which is where the rule lives. A caller with no
   * capability in hand records nothing, which is correct: there is no rung to
   * have an opinion about.
   */
  capability: HoverPreviewCapability | null | undefined
): void {
  const pref = withHoverPreviewSlot(box.get(), choice, capability)
  try {
    window.localStorage.setItem(
      HOVER_PREVIEW_PREF_STORAGE_KEY,
      JSON.stringify(pref)
    )
  } catch {
    // Storage refused (private mode, blocked site data). The preference still
    // applies for this session — publishing it is what the user asked for, and
    // failing to persist is not a reason to also ignore them.
  }
  box.set(pref)
}
