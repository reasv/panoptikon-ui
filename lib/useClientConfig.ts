import { useQuery } from "@tanstack/react-query"
import {
  ClientConfig,
  ClientConfigResponse,
  deriveClientConfig,
} from "./clientConfig"

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
