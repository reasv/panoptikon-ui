import { redirect } from "next/navigation";
import { getServerClientConfig } from "@/lib/serverApi";

export default async function Home() {
  // The site root has no page of its own: it sends everyone to Search. The
  // getting-started guide that used to live here is shown by the search page
  // itself, and only while the selected index is empty (see
  // components/EmptyIndexPanel.tsx) — which is also the only time it is
  // useful, and the only way it reaches users who open /search directly.
  //
  // `home_redirect` is a [policies.client] convention key (gateway config,
  // see the gateway README) that can still point the root somewhere else.
  // Fetched server-side with the policy token echoed, so it is the original
  // requester's policy that decides. Misconfigured targets — non-paths,
  // protocol-relative "//..." URLs, or "/" itself (which would redirect this
  // page to itself in a loop) — are normalized away to null in
  // deriveClientConfig (lib/clientConfig.ts), and null (or an unreachable
  // config) falls back to Search.
  const clientConfig = await getServerClientConfig()
  redirect(clientConfig?.homeRedirect ?? "/search")
}
