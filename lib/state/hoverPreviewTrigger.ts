/**
 * WHERE THE POINTER HAS TO BE for a video cell to start previewing
 * (docs/video-hover-preview-implementation.md T1).
 *
 * A SEPARATE PREFERENCE FROM `hoverPreviewPref`, and the split is the point.
 * That one is a three-layer negotiation with the server about what a preview
 * may COST (a policy can deny a rung, and the browser can only subtract from
 * what is offered). This one is about GESTURE, and the server has no say in
 * where a pointer must rest: it is one string, it never appears in
 * `/api/client-config`, and it never appears in the URL — a link shared with
 * someone else must not reach into how their pointer works
 * (lib/state/animatePref.ts states the rule at length).
 *
 * WHY THE DEFAULT IS THE BUTTON. An animated image already looks like a
 * thumbnail-sized loop, so playing it on a rest costs nothing visible and
 * reverses instantly. A video preview is a PROCESS — a request, sometimes a
 * server-side job with its name on screen — and a cursor comes to rest on a
 * card for a dozen reasons that are not "show me this": reaching for a corner
 * button, a pause in scrolling, an item the user is not even looking at. The
 * trigger has to ask for the same intent the process deserves, and the target
 * for that intent is already drawn on the cell: the play badge.
 *
 * Import-free apart from the box mechanism, on purpose and for the reason
 * lib/state/animatePref.ts gives: every decision here is arithmetic over a
 * stored string, and scripts/previewtrigger.test.mjs executes it under plain
 * node. The DOM is touched only from inside the box functions, so importing
 * this module starts nothing.
 */
import { createValueBox } from "./valueBox"

/**
 * `"card"` — the arm fires after 200 ms of rest anywhere on the card (T2, the
 * behaviour that shipped first). `"button"` — the play badge is the target: it
 * takes the same 200 ms arm, then a countdown ring, and a click on it skips
 * the countdown (T3).
 */
export type HoverPreviewTrigger = "card" | "button"

export const HOVER_PREVIEW_TRIGGER_STORAGE_KEY = "panoptikon.hoverPreviewTrigger"

/** What a browser with nothing stored reads (T1). */
export const DEFAULT_HOVER_PREVIEW_TRIGGER: HoverPreviewTrigger = "button"

/**
 * Read a stored value back. Anything unusable — absent, a hand-edited string,
 * a value from a future version — reads as the DEFAULT rather than as an
 * error: there are only two answers and one of them is always correct enough
 * to render a grid with.
 */
export function parseHoverPreviewTrigger(
  raw: string | null | undefined
): HoverPreviewTrigger {
  return raw === "card" || raw === "button" ? raw : DEFAULT_HOVER_PREVIEW_TRIGGER
}

/**
 * THE SENTENCE ABOVE "VIDEO PREVIEWS" IN THE POPOVER (T8), which follows this
 * setting rather than describing one gesture forever: the row underneath is
 * about what a preview may cost, and a user who has moved the trigger would
 * otherwise read a description of a gesture their grid no longer has.
 *
 * Here rather than in the control because it is a pure function of the
 * preference and scripts/previewtrigger.test.mjs pins both strings — the whole
 * point of the amendment is that these two sentences cannot drift apart.
 */
export function hoverPreviewLead(trigger: HoverPreviewTrigger): string {
  return trigger === "card"
    ? "Play a video by resting the pointer on its card."
    : "Play a video by resting on its play button, or clicking it."
}

/** The name of this setting's segments, in the order the control shows them. */
export const HOVER_PREVIEW_TRIGGER_LABELS: ReadonlyArray<
  readonly [HoverPreviewTrigger, string]
> = Object.freeze([
  ["card", "Card"] as const,
  ["button", "Play button"] as const,
])

/**
 * WHAT THE CURRENT CHOICE DOES, in a sentence — the line under the control,
 * on the same rule its neighbours follow: it describes the lit segment and
 * never recites the whole menu.
 */
export function hoverPreviewTriggerHint(trigger: HoverPreviewTrigger): string {
  return trigger === "card"
    ? "Resting anywhere on a video card starts its preview."
    : "Resting on the play button fills its ring and then starts the preview; clicking it starts at once."
}

// ---------------------------------------------------------------------------
// The runtime box
// ---------------------------------------------------------------------------

/**
 * The mechanism is lib/state/valueBox.ts, and the reasoning is
 * lib/state/animatePref.ts's verbatim: a MODULE SINGLETON, because this value
 * belongs to the browser profile rather than to a mount, cross-tab sync wants
 * one listener per document, and on the server the box never leaves the
 * default — which is also what `getServerHoverPreviewTrigger` returns, so
 * every request renders the markup the client hydrates with.
 *
 * The value is a string, so the default identity comparison is already the
 * right one and no custom equality is needed here.
 */
const box = createValueBox<HoverPreviewTrigger>(DEFAULT_HOVER_PREVIEW_TRIGGER)

let bound = false

function readStored(): HoverPreviewTrigger {
  try {
    return parseHoverPreviewTrigger(
      window.localStorage.getItem(HOVER_PREVIEW_TRIGGER_STORAGE_KEY)
    )
  } catch {
    // A browser with site data blocked throws on the ACCESSOR, not on the
    // read — so this catch is what makes the setting degrade to its default
    // there instead of crashing the grid.
    return DEFAULT_HOVER_PREVIEW_TRIGGER
  }
}

/** Bound ONCE per document and never released — animatePref.ts's rule. */
function bind(): void {
  if (bound || typeof window === "undefined") return
  bound = true
  window.addEventListener("storage", (event) => {
    // `key` is null for a whole-store clear, which is a change to ours too;
    // any other key is somebody else's and bails.
    if (event.key !== null && event.key !== HOVER_PREVIEW_TRIGGER_STORAGE_KEY) {
      return
    }
    box.set(readStored())
  })
  box.set(readStored())
}

export function subscribeHoverPreviewTrigger(onChange: () => void): () => void {
  const unsubscribe = box.subscribe(onChange)
  bind()
  return unsubscribe
}

export function getHoverPreviewTrigger(): HoverPreviewTrigger {
  return box.get()
}

/** The SSR snapshot: the same value the box starts on. */
export function getServerHoverPreviewTrigger(): HoverPreviewTrigger {
  return DEFAULT_HOVER_PREVIEW_TRIGGER
}

/**
 * Write the choice and publish it. The local publish is not belt-and-braces:
 * `storage` events fire in OTHER documents only, so the tab that wrote is the
 * one tab that would never hear about it.
 *
 * The default is STORED like any other choice rather than removed, unlike the
 * cost preference next door: absent there means "follow the server", which is
 * a third state this setting does not have — there is nothing for the server
 * to say about a gesture, so "card" and "button" are the whole space.
 */
export function setHoverPreviewTrigger(trigger: HoverPreviewTrigger): void {
  try {
    window.localStorage.setItem(HOVER_PREVIEW_TRIGGER_STORAGE_KEY, trigger)
  } catch {
    // Storage refused (private mode, blocked site data). The preference still
    // applies for this session — publishing it is what the user asked for, and
    // failing to persist is not a reason to also ignore them.
  }
  box.set(trigger)
}
