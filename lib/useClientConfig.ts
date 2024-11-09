import { QueryClient, useQuery } from "@tanstack/react-query"
import { ClientConfig } from "../app/config/route"

const fetchClientConfig = async (): Promise<ClientConfig> => {
  const response = await fetch("/config")
  if (!response.ok) throw new Error("Failed to fetch client config")
  return response.json()
}

export const useClientConfig = () => {
  return useQuery({
    queryKey: ["clientConfig"],
    queryFn: fetchClientConfig,
  })
}
export async function prefetchClientConfig(queryClient: QueryClient) {
  // Prefetch the client config
  await queryClient.prefetchQuery({
    queryKey: ["clientConfig"],
    queryFn: fetchClientConfig,
  })
  return queryClient
}
