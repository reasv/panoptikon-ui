import { useQuery } from "@tanstack/react-query"
import {
  ClientConfig,
  ClientConfigResponse,
  deriveClientConfig,
} from "./clientConfig"
import type { AnimatedFloor } from "./thumbnailTier"

// Client-side counterpart of lib/serverApi.ts's getServerClientConfig: a
// same-origin fetch, so in production the gateway (which serves
// /api/client-config itself, policy-scoped and Cache-Control: no-store)
// answers for whatever policy matched the browser; in dev the
// next.config.mjs rewrite forwards it to PANOPTIKON_API_URL.
const fetchClientConfig = async (): Promise<ClientConfig> => {
  const response = await fetch("/api/client-config", { cache: "no-store" })
  if (!response.ok) throw new Error("Failed to fetch client config")
  return deriveClientConfig((await response.json()) as ClientConfigResponse)
}

export const useClientConfig = () => {
  return useQuery({
    queryKey: ["clientConfig"],
    queryFn: fetchClientConfig,
  })
}

// Whether this policy lets the client ask for a transcode. STRICT true: while
// the config is still in flight the answer is "no", so a loading page never
// offers a play button whose press would fire a 403-able POST. The cost is
// that an unplayable item's play affordance appears a moment late — which is
// exactly what the pre-transcode build showed for its whole lifetime.
export const useVideoTranscodeEnabled = (): boolean =>
  useClientConfig().data?.videoTranscodeEnabled === true

// Whether this policy lets the client ask for a COMPOSITION (the animated
// pinboard save). Strict true for the same reason, and deliberately a
// different capability from the one above: the two routes are separately
// rule-able, and a policy that grants clips but not mosaics must hide exactly
// the rows that post to /api/video/compose.
export const useVideoComposeEnabled = (): boolean =>
  useClientConfig().data?.videoComposeEnabled === true

// The animated raw floor a grid host tests its rows against to decide which
// cells render a <video> (lib/thumbnailTier.ts). Null while the config is in
// flight, and null against a Server that predates the loop pipeline; both read
// as "no loops exist", so cells stay on today's <img> path until the real
// numbers arrive.
//
// Read ONCE PER HOST, next to the tier choice, and passed down — never per
// cell. It is a react-query subscription, i.e. exactly the kind of per-card
// subscription F1 removed, and the value is the same for every card on the
// page. `data` keeps a stable identity between refetches that change nothing,
// so passing the object down does not break the cells' memo.
export const useAnimatedFloor = (): AnimatedFloor | null =>
  useClientConfig().data?.animatedFloor ?? null
