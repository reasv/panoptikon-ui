import createFetchClient from "openapi-fetch"
import { headers } from "next/headers"
import type { paths } from "@/lib/panoptikon"
import { ClientConfig, deriveClientConfig } from "@/lib/clientConfig"

// Server-only module. The repo doesn't depend on the `server-only` marker
// package, but the next/headers import serves the same purpose: importing
// this file from a client component fails the build. Keep it that way —
// the policy token below must never reach client bundles or rendered
// output.
//
// The panoptikon gateway stamps every request it proxies to the UI with
// x-panoptikon-policy: a short-lived HMAC token naming the policy it
// matched for the original browser request. Echoing it verbatim on SSR API
// calls makes the gateway apply that requester's policy instead of
// whatever the UI server's own listener/host would match — SSR acts with
// the browser request's authority, not the UI process's network position.
// A forged, tampered, expired, or absent echo safely falls back to
// listener/host matching on the gateway side.
const POLICY_TOKEN_HEADER = "x-panoptikon-policy"

export const serverFetchClient = createFetchClient<paths>({
  baseUrl: process.env.PANOPTIKON_API_URL || "http://127.0.0.1:6342",
  fetch: fetch,
  cache: "no-cache",
})

serverFetchClient.use({
  async onRequest({ request }) {
    // headers() (async in Next 15) reads the incoming request's headers and
    // forces dynamic rendering. That is intended: responses vary by policy,
    // so policy-scoped pages must never be statically cached.
    const token = (await headers()).get(POLICY_TOKEN_HEADER)
    if (token) {
      request.headers.set(POLICY_TOKEN_HEADER, token)
    }
    return request
  },
})

// Server-side client-config fetch (token-echoed, so it reflects the
// original requester's policy). Returns null on any failure: the config is
// cosmetic for rendering decisions (what to hide, where to redirect) and
// the gateway enforces the actual policy regardless, so a page render must
// not break when the gateway is unreachable (e.g. bare `next dev`).
export async function getServerClientConfig(): Promise<ClientConfig | null> {
  // Touch the incoming request's headers BEFORE the try: during build-time
  // prerendering this throws Next's dynamic-usage marker, which must
  // propagate — it is what flags the calling page as dynamic (ƒ) instead of
  // letting it be statically baked with a missing config. The catch below
  // must only swallow real fetch failures, never that marker.
  await headers()
  try {
    const { data, error } = await serverFetchClient.GET("/api/client-config")
    if (!data || error) {
      return null
    }
    return deriveClientConfig(data)
  } catch {
    return null
  }
}
