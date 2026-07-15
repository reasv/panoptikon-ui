export type RelayHealth = {
  protocol: string
  version: string
  pairing: boolean
  relay_id: string
}

export type RelaySession = RelayHealth & {
  relayURL: string
  instanceId?: string
  credential?: string
}

let discovery: Promise<RelaySession | null> | null = null
let discoveredAt = 0

export function discoverRelay(): Promise<RelaySession | null> {
  if (discovery && Date.now() - discoveredAt < 5000) return discovery
  discoveredAt = Date.now()
  discovery = (async () => {
    for (const port of [17600, 17601]) {
      const relayURL = `http://127.0.0.1:${port}`
      try {
        const response = await fetch(`${relayURL}/v1/health`, { cache: "no-store", signal: AbortSignal.timeout(700) })
        if (!response.ok) continue
        const health = await response.json() as RelayHealth
        if (health.protocol !== "panoptikon-relay-v1" || !health.relay_id) continue
        const pairing = await fetch(`/api/relay/pairings/${health.relay_id}`, { cache: "no-store" })
        if (pairing.ok) {
          const saved = await pairing.json()
          return { ...health, relayURL, instanceId: saved.instance_id, credential: saved.credential }
        }
        return { ...health, relayURL }
      } catch { /* Relay is optional; absence must leave the UI unchanged. */ }
    }
    return null
  })()
  return discovery
}

export async function pairRelay(session: RelaySession, roots: string[]): Promise<RelaySession> {
  const response = await fetch(`${session.relayURL}/v1/pairing/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: window.location.origin,
      origin: window.location.origin,
      server_url: window.location.origin,
      roots,
    }),
  })
  if (!response.ok) throw new Error("The local Relay could not start pairing")
  const { request_id } = await response.json()
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    const statusResponse = await fetch(`${session.relayURL}/v1/pairing/${request_id}`, { cache: "no-store" })
    if (!statusResponse.ok) throw new Error("Relay pairing expired or was cancelled")
    const status = await statusResponse.json()
    if (status.status === "rejected") throw new Error("Relay pairing was rejected")
    if (status.status === "approved") {
      const save = await fetch(`/api/relay/pairings/${session.relay_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instance_id: status.instance_id, credential: status.credential }),
      })
      if (!save.ok) throw new Error("The Panoptikon endpoint could not save this pairing")
      return { ...session, instanceId: status.instance_id, credential: status.credential }
    }
  }
  throw new Error("Relay pairing timed out")
}

export async function relayAction(session: RelaySession, action: "open_file" | "reveal_in_folder", path: string) {
  const run = () => fetch(`${session.relayURL}/v1/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.credential}` },
    body: JSON.stringify({ action, path }),
  })
  let response = await run()
  if (response.status === 409) {
    const body = await response.json().catch(() => null)
    if (body?.error?.code === "mapping_required") {
      const deadline = Date.now() + 5 * 60_000
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 1500))
        response = await run()
        if (response.ok) return
        if (response.status !== 409) break
      }
    }
  }
  if (!response.ok) throw new Error(`Local Relay action failed (${response.status})`)
}
