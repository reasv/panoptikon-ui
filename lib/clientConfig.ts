import { components } from "@/lib/panoptikon"

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
    desktopManaged:
      response.desktop_managed === true || client["desktop"] === true,
    desktopShellAvailable: response.desktop_shell_available === true,
  }
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
