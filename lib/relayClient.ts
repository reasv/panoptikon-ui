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
  operationId?: string
  pairingStatus?: "pending" | "approved_unconfirmed" | "rejected"
}

type ServerPairing = { relay_id: string, instance_id: string, credential: string, operation_id?: string }
type ServerOperation = { relay_id: string, operation_id: string, expires_unix: number }

export class RelayRequestError extends Error {
  constructor(readonly status: number, readonly code?: string, message = "The local Relay request failed") {
    super(message)
  }
}

async function errorFor(response: Response, fallback: string) {
  const body = await response.json().catch(() => null)
  return new RelayRequestError(response.status, body?.error?.code, body?.error?.message ?? body?.detail ?? fallback)
}

export async function discoverRelayHealth(): Promise<RelaySession | null> {
  for (const port of [17600, 17601]) {
    const relayURL = `http://127.0.0.1:${port}`
    try {
      const response = await fetch(`${relayURL}/v1/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(700),
      })
      if (!response.ok) continue
      const health = await response.json() as RelayHealth
      if (health.protocol === "panoptikon-relay-v1" && health.relay_id) {
        return { ...health, relayURL }
      }
    } catch {
      // Relay is optional. Absence leaves existing file actions unchanged.
    }
  }
  return null
}

export async function serverPairing(relayId: string): Promise<ServerPairing | null> {
  const response = await fetch(`/api/relay/pairings/${relayId}`, { cache: "no-store" })
  if (response.status === 404) return null
  if (!response.ok) throw await errorFor(response, "Panoptikon could not read the Relay pairing")
  return response.json()
}

export async function serverOperation(relayId: string): Promise<ServerOperation | null> {
  const response = await fetch(`/api/relay/pairing-operations/${relayId}`, { cache: "no-store" })
  if (response.status === 404) return null
  if (!response.ok) throw await errorFor(response, "Panoptikon could not read the pairing operation")
  return response.json()
}

export async function beginServerOperation(relayId: string): Promise<ServerOperation> {
  const response = await fetch(`/api/relay/pairing-operations/${relayId}`, {
    method: "POST", cache: "no-store",
  })
  if (!response.ok) throw await errorFor(response, "Panoptikon could not start pairing")
  return response.json()
}

export async function createRelayOperation(session: RelaySession, operationId: string, roots: string[]) {
  const response = await fetch(`${session.relayURL}/v1/pairing/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation_id: operationId,
      name: window.location.origin,
      origin: window.location.origin,
      server_url: window.location.origin,
      roots,
    }),
  })
  if (!response.ok) throw await errorFor(response, "The local Relay could not start pairing")
}

export async function relayOperation(session: RelaySession, operationId: string) {
  const response = await fetch(`${session.relayURL}/v1/pairing/${operationId}`, { cache: "no-store" })
  if (response.status === 404 || response.status === 410) return null
  if (!response.ok) throw await errorFor(response, "The Relay pairing operation failed")
  return response.json() as Promise<{
    status: "pending" | "rejected" | "approved_unconfirmed" | "complete"
    instance_id?: string
    credential?: string
  }>
}

export async function commitServerOperation(operationId: string, session: RelaySession, instanceId: string, credential: string) {
  const response = await fetch(`/api/relay/pairing-operations/${operationId}/commit`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ relay_id: session.relay_id, instance_id: instanceId, credential }),
  })
  if (!response.ok) throw await errorFor(response, "Panoptikon could not commit the Relay pairing")
}

export async function acknowledgeRelayOperation(session: RelaySession, operationId: string, credential: string) {
  const response = await fetch(`${session.relayURL}/v1/pairing/${operationId}/ack`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${credential}` },
  })
  if (!response.ok) throw await errorFor(response, "The Relay could not acknowledge pairing")
}

export async function cancelPairingOperation(session: RelaySession, operationId: string) {
  await Promise.allSettled([
    fetch(`/api/relay/pairing-operations/${operationId}`, { method: "DELETE" }),
    fetch(`${session.relayURL}/v1/pairing/${operationId}`, { method: "DELETE" }),
  ])
}

export async function forgetServerPairing(relayId: string) {
  await fetch(`/api/relay/pairings/${relayId}`, { method: "DELETE" })
}

export async function validateRelayCredential(session: RelaySession) {
  const response = await fetch(`${session.relayURL}/v1/auth/check`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${session.credential}` },
  })
  if (!response.ok) throw await errorFor(response, "The Relay credential is no longer valid")
}

export async function relayAction(
  session: RelaySession,
  action: "open_file" | "reveal_in_folder",
  path: string,
) {
  const actionId = crypto.randomUUID()
  const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${session.credential}` }
  let response = await fetch(`${session.relayURL}/v1/actions`, {
    method: "POST", headers, body: JSON.stringify({ action_id: actionId, action, path }),
  })
  if (response.ok) return
  let body = await response.json().catch(() => null)
  if (response.status !== 409 || body?.error?.code !== "mapping_required") {
    throw new RelayRequestError(response.status, body?.error?.code, body?.error?.message ?? `Local Relay action failed (${response.status})`)
  }

  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1200))
    response = await fetch(`${session.relayURL}/v1/actions/${actionId}`, { headers: { "Authorization": `Bearer ${session.credential}` }, cache: "no-store" })
    if (response.ok) return
    if (response.status === 202 || response.status === 409) continue
    body = await response.json().catch(() => null)
    throw new RelayRequestError(response.status, body?.error?.code, body?.error?.message ?? `Local Relay action failed (${response.status})`)
  }
  throw new RelayRequestError(408, "mapping_timeout", "Timed out waiting for a local folder mapping")
}
