import { components } from "@/lib/panoptikon"

// The gateway's GET /api/client-config response: the name of the policy that
// matched the request, capability booleans derived from that policy's
// ruleset, and the policy's free-form [policies.client] TOML table verbatim.
export type ClientConfigResponse = components["schemas"]["ClientConfigResponse"]

// The derived shape the UI actually consumes. Computed by deriveClientConfig
// in exactly one place, shared by the client hook (lib/useClientConfig.ts)
// and server components (lib/serverApi.ts), so the two can't drift.
export interface ClientConfig {
  disableBackendOpen: boolean
  restrictedMode: boolean
  searchThrottleMs: number
  homeRedirect: string | null
}

// [policies.client] keys are free-form; these are the by-convention keys the
// UI recognizes (see the gateway README's client-config section):
// - search_throttle_ms (number): search-as-you-type coalescing window; 0
//   disables throttling entirely.
// - disable_backend_open (bool): degrade Open File / Show in Folder even if
//   the ruleset would technically allow /api/open/*.
// - home_redirect (string path, e.g. "/search"): send the landing page ("/")
//   there instead of showing the getting-started guide; absent = no redirect.
// Unknown keys are passthrough and simply ignored here.
export function deriveClientConfig(response: ClientConfigResponse): ClientConfig {
  const client = (response.client ?? {}) as Record<string, unknown>
  const capabilities = response.capabilities
  const throttle = client["search_throttle_ms"]
  const homeRedirect = client["home_redirect"]
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
    homeRedirect: typeof homeRedirect === "string" ? homeRedirect : null,
  }
}
