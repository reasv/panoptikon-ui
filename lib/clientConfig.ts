// Type-only, all of them. `@/lib/panoptikon` is a .d.ts, so a VALUE import of
// it is a runtime module the node test scripts cannot resolve (the rule
// lib/videoTranscode.ts documents) — and with them all erased this module has
// NO runtime imports at all, which is what lets scripts/displayloop.test.mjs
// and scripts/videopreview.test.mjs execute `deriveClientConfig` under plain
// node.
import type { components } from "@/lib/panoptikon"
import type { AnimatedFloor, DisplayLoopTrigger } from "@/lib/thumbnailTier"
import type { HoverPreviewCapability } from "@/lib/state/hoverPreviewPref"

// The gateway's GET /api/client-config response: the name of the policy that
// matched the request, capability booleans derived from that policy's
// ruleset, and the policy's free-form [policies.client] TOML table verbatim.
export type ClientConfigResponse = components["schemas"]["ClientConfigResponse"] & {
  desktop_managed?: boolean
  desktop_shell_available?: boolean
}

// The derived shape the UI actually consumes. Computed by deriveClientConfig
// in exactly one place, shared by the client hook (lib/useClientConfig.ts)
// and server components (lib/serverApi.ts), so the two can't drift.
export interface ClientConfig {
  disableBackendOpen: boolean
  restrictedMode: boolean
  searchThrottleMs: number
  homeRedirect: string | null
  desktopManaged: boolean
  desktopShellAvailable: boolean
  relayEnabled: boolean
  pinboardSearchEnabled: boolean
  videoTranscodeEnabled: boolean
  videoComposeEnabled: boolean
  /**
   * The raw floor an animated item must clear before the scan stores an H.264
   * loop for it, verbatim from the server (`animated_floor`). Grid cells decide
   * `<img>` vs `<video>` against it; it is deliberately NOT duplicated as a
   * constant on this side, so a backend change to the floor reaches the client
   * on the next config fetch.
   *
   * Null when the server does not report one — an older Server than the one
   * that ships the loop pipeline. Every consumer reads null as "no loops
   * exist", which is exactly right for such a server and is also the state
   * while the config request is still in flight.
   */
  animatedFloor: AnimatedFloor | null
  /**
   * The bounds past which the DISPLAY size of an animated item is an H.264
   * loop rather than a picture (`display_loop_trigger`), verbatim from the
   * server. The gallery's large view decides `<video>` vs `<img>` against it
   * from row data alone — no wasted request, no error latch.
   *
   * Null when the server does not report one, which covers a Server older than
   * the display-loop pipeline, a deployment where it is off, and the window
   * while the config request is in flight. Every consumer reads null as "the
   * display size is always an image", i.e. today's element.
   */
  displayLoopTrigger: DisplayLoopTrigger | null
  /**
   * What THIS POLICY and this deployment allow a hovered video cell to do
   * (`hover_preview`, docs/video-hover-preview-implementation.md V8): the
   * server's own conjunction of the policy override, the `[transcode]`
   * default, the transcode capability and the preset filter. The UI never
   * re-derives it — it only ever subtracts the browser preference from it
   * (lib/state/hoverPreviewPref.ts `resolveHoverPreview`).
   *
   * Null when the server reports nothing usable: a Server older than the
   * feature, and the window while the config request is in flight. Both read
   * as "no previews", which is exactly today's grid.
   */
  hoverPreview: HoverPreviewCapability | null
}

// [policies.client] keys are free-form; these are the by-convention keys the
// UI recognizes (see the gateway README's client-config section):
// - search_throttle_ms (number): search-as-you-type coalescing window; 0
//   disables throttling entirely.
// - disable_backend_open (bool): degrade Open File / Show in Folder even if
//   the ruleset would technically allow /api/open/*.
// - home_redirect (string path, e.g. "/search"): send the landing page ("/")
//   there instead of showing the getting-started guide; absent = no redirect.
//   Guarded by normalizeHomeRedirect below: non-path and self ("/") targets
//   are dropped (treated as unset).
// Unknown keys are passthrough and simply ignored here.
export function deriveClientConfig(response: ClientConfigResponse): ClientConfig {
  const client = (response.client ?? {}) as Record<string, unknown>
  const capabilities = response.capabilities
  const throttle = client["search_throttle_ms"]
  return {
    // Backend-open is off when the policy says so explicitly, or when the
    // ruleset would reject POST /api/open/* anyway (the button would 403).
    disableBackendOpen:
      client["disable_backend_open"] === true ||
      capabilities.open_files === false,
    // "Restricted" as far as the UI cares: scan/job management is off, so
    // hide the scan drawer and job-related navigation.
    restrictedMode: capabilities.scan_jobs === false,
    searchThrottleMs: typeof throttle === "number" ? throttle : 500,
    homeRedirect: normalizeHomeRedirect(client["home_redirect"]),
    desktopManaged: response.desktop_managed === true,
    desktopShellAvailable: response.desktop_shell_available === true,
    relayEnabled: client["relay_enabled"] !== false,
    // The ruleset lets this policy *read* the pinboard library and search it.
    // Consumers that fetch board data unprompted (the grid's Library tab)
    // gate on it so a policy without board access never fires a request it
    // would 403. Deliberately not the `pinboards` capability: that one probes
    // a write (POST /api/pinboards), so a read-only-boards policy would lose
    // the Library tab even though both of its requests would succeed.
    pinboardSearchEnabled: capabilities.pinboard_search !== false,
    // Probed off POST /api/video/transcode, so this is "may this client ask
    // for a new encode", not "may it play one" — a policy that serves cached
    // artifacts but denies conversions still reports false here. The
    // playability ladder (lib/videoPlayability.ts) uses it to decide whether
    // an unplayable file gets a play affordance at all; it never suppresses
    // NATIVE playability, so a browser that decodes the file itself is
    // unaffected by a policy that forbids transcoding.
    videoTranscodeEnabled: capabilities.video_transcode !== false,
    // Probed off POST /api/video/compose, which is a SEPARATE route from the
    // single-file transcode and separately rule-able: composing N inputs is
    // strictly heavier work, so a policy may well allow clips and deny
    // mosaics. The animated pinboard rows gate on this one and never on
    // `video_transcode` — they post here, and a client that read the other
    // capability would offer rows whose press 403s.
    videoComposeEnabled: capabilities.video_compose !== false,
    // NOT a `[policies.client]` key and not capability-derived: the floor is a
    // property of what the scan wrote, identical for every policy, so it rides
    // at the top level of the response and is passed through as-is.
    animatedFloor: normalizeAnimatedFloor(response.animated_floor),
    // Top-level for the same reason as the floor above: it is a property of
    // what the scan wrote, identical for every policy.
    displayLoopTrigger: normalizeDisplayLoopTrigger(response.display_loop_trigger),
    // Top-level, but unlike the two above it is POLICY-DEPENDENT: it is the
    // server's resolved answer for the request that fetched this config, so a
    // restricted policy and an unrestricted one see different values at the
    // same URL. Normalized all-or-nothing, exactly as the two bounds objects
    // are and for the same reason (see `wireBooleans`).
    hoverPreview: normalizeHoverPreview(response.hover_preview),
  }
}

/**
 * ALL-OR-NOTHING, and that is the whole rule these two bounds objects are read
 * under: read `keys` off `obj`, and answer `null` unless EVERY one of them is a
 * finite, non-negative number.
 *
 * A missing member is not a bound that simply never fires — it is a bound the
 * server IS applying and this client cannot see, so guessing would put a
 * `<video>` where image bytes are, or the reverse. Everything short of complete
 * reads as "not reported", which every consumer answers with today's `<img>`.
 *
 * The generated types say these are numbers, but the value crosses the wire
 * from a Server whose version the client does not pin — and one older than the
 * field sends nothing at all — so the guard is the contract rather than
 * ceremony.
 *
 * Returns the values in `keys` order, for the caller to name.
 */
function wireNumbers(
  obj: unknown,
  keys: readonly string[]
): number[] | null {
  if (!obj || typeof obj !== "object") return null
  const record = obj as Record<string, unknown>
  const values: number[] = []
  for (const key of keys) {
    const value = record[key]
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return null
    }
    values.push(value)
  }
  return values
}

/**
 * The same all-or-nothing rule as `wireNumbers`, for a record of BOOLEANS.
 *
 * A half-reported capability is not a rung that quietly stays off — it is a
 * rung whose answer this client cannot see, and guessing either way is a
 * request the policy may refuse or a preview the user was entitled to and did
 * not get. Everything short of complete reads as "not reported", which every
 * consumer answers with today's still cell.
 */
function wireBooleans(obj: unknown, keys: readonly string[]): boolean[] | null {
  if (!obj || typeof obj !== "object") return null
  const record = obj as Record<string, unknown>
  const values: boolean[] = []
  for (const key of keys) {
    const value = record[key]
    if (typeof value !== "boolean") return null
    values.push(value)
  }
  return values
}

/** One wire member as a finite, non-negative number, or null. */
function wireNumber(obj: unknown, key: string): number | null {
  const values = wireNumbers(obj, [key])
  return values ? values[0] : null
}

/**
 * `hover_preview` as the two rungs, or null.
 *
 * STILL NORMALIZED NOW THAT THE GENERATED TYPE CARRIES THE FIELD, on the rule
 * `wireNumbers` states for the two bounds objects: the value crosses the wire
 * from a Server whose version this client does not pin, and one older than the
 * hover-preview package sends nothing at all. The generated type says what the
 * CURRENT server promises, not what arrived.
 *
 * A plain object rather than one of lib/state/hoverPreviewPref.ts's interned
 * constants, and that is what keeps this module free of RUNTIME imports (see
 * its header): the value never reaches a memoized card from here — the hook
 * resolves it against the browser preference first, and that resolution is
 * what returns an interned answer.
 */
function normalizeHoverPreview(
  hoverPreview: unknown
): HoverPreviewCapability | null {
  // ALL FOUR MEMBERS OR NOTHING. A cap this client cannot read is the case
  // that matters: with `max_bytes` missing there is no number to measure a
  // file against, and both own-bytes rungs would either be refused outright or
  // pull whatever the file happens to weigh — which is the defect the cap
  // exists to fix.
  const flags = wireBooleans(hoverPreview, ["direct", "trim", "transcode"])
  if (!flags) return null
  const maxBytes = wireNumber(hoverPreview, "max_bytes")
  if (maxBytes === null) return null
  const [direct, trim, transcode] = flags
  return { direct, trim, transcode, maxBytes }
}

function normalizeDisplayLoopTrigger(
  trigger: ClientConfigResponse["display_loop_trigger"]
): DisplayLoopTrigger | null {
  const values = wireNumbers(trigger, ["max_bytes", "max_short_side", "max_pixels"])
  if (!values) return null
  const [maxBytes, maxShortSide, maxPixels] = values
  return { maxBytes, maxShortSide, maxPixels }
}

function normalizeAnimatedFloor(
  floor: ClientConfigResponse["animated_floor"] | undefined
): AnimatedFloor | null {
  const values = wireNumbers(floor, ["max_file_size", "max_side"])
  if (!values) return null
  const [maxFileSize, maxSide] = values
  return { maxFileSize, maxSide }
}

// Guard for home_redirect. The value is operator-controlled TOML, so this is
// not a security boundary — it just catches misconfigurations cheaply:
// - only same-app paths: must start with "/" but not "//" (browsers treat
//   "//host" as protocol-relative, i.e. an accidental external redirect);
// - never "/": the landing page redirecting to itself would loop forever.
// Anything rejected behaves exactly like an unset home_redirect.
function normalizeHomeRedirect(value: unknown): string | null {
  if (typeof value !== "string") return null
  const path = value.trim()
  if (!path.startsWith("/") || path.startsWith("//")) return null
  // Self-target: "/" (with or without query/hash) still lands on this page.
  const pathOnly = path.split(/[?#]/, 1)[0]
  if (pathOnly === "/") return null
  return path
}
