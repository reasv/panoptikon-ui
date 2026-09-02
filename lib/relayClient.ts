import { relayErrorCode, relayErrorMessage } from "./fileShareMeta"

export type RelayHealth = {
  protocol: string
  version: string
  pairing: boolean
  relay_id: string
  // Verbs the Relay can execute beyond the original open/reveal pair. Absent on
  // an old Relay (§0.1) — parsed to [] so relay-copy stays gated off and the UI
  // degrades to Download instead of POSTing an action the old enum rejects.
  features: string[]
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

// The Relay speaks TWO error shapes — `structured_error` ({error:{code,message}})
// and the plain `error()` ({"error": "<string>"}) — and the gateway a third
// ({detail}). relayErrorMessage reads all three, so a legacy-envelope message
// is surfaced instead of being replaced by a generic status line.
async function errorFor(response: Response, fallback: string) {
  const body = await response.json().catch(() => null)
  return new RelayRequestError(response.status, relayErrorCode(body), relayErrorMessage(body, fallback))
}

export async function discoverRelayHealth(): Promise<RelaySession | null> {
  for (const port of [16341, 17601]) {
    const relayURL = `http://127.0.0.1:${port}`
    try {
      const response = await fetch(`${relayURL}/v1/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(700),
      })
      if (!response.ok) continue
      const health = await response.json() as Partial<RelayHealth>
      if (health.protocol === "panoptikon-relay-v1" && health.relay_id) {
        return {
          protocol: health.protocol,
          version: health.version ?? "",
          pairing: health.pairing ?? false,
          relay_id: health.relay_id,
          features: Array.isArray(health.features) ? health.features : [],
          relayURL,
        }
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
    fetch(`/api/relay/pairing-operations/${operationId}/cancel`, { method: "DELETE" }),
    fetch(`${session.relayURL}/v1/pairing/${operationId}`, { method: "DELETE" }),
  ])
}

export async function forgetServerPairing(relayId: string) {
  const response = await fetch(`/api/relay/pairings/${relayId}`, { method: "DELETE" })
  if (!response.ok) throw await errorFor(response, "Panoptikon could not clear the stale Relay pairing")
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
  if (response.status !== 409 || relayErrorCode(body) !== "mapping_required") {
    throw new RelayRequestError(response.status, relayErrorCode(body), relayErrorMessage(body, `Local Relay action failed (${response.status})`))
  }

  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1200))
    response = await fetch(`${session.relayURL}/v1/actions/${actionId}`, { headers: { "Authorization": `Bearer ${session.credential}` }, cache: "no-store" })
    if (response.ok) return
    if (response.status === 202 || response.status === 409) continue
    body = await response.json().catch(() => null)
    throw new RelayRequestError(response.status, relayErrorCode(body), relayErrorMessage(body, `Local Relay action failed (${response.status})`))
  }
  throw new RelayRequestError(408, "mapping_timeout", "Timed out waiting for a local folder mapping")
}

// The Relay refused to store the file because it exceeds the share-cache
// ceiling (413 file_too_large on the action). This is not an error to surface —
// the caller silently falls back to Download (§0.17 / plan 4.1).
export class RelayFileTooLargeError extends Error {
  constructor(readonly size: number, readonly max: number) {
    super("File too large to copy")
    this.name = "RelayFileTooLargeError"
  }
}

// The file on disk no longer matches what the index recorded, so a copy cannot
// succeed (the Relay verifies the uploaded bytes against the indexed sha256).
// Like RelayFileTooLargeError this is a fall-back-to-Download signal, not an
// error to surface raw.
export class RelayStaleFileError extends Error {
  constructor() {
    super("The file changed on disk since it was indexed")
    this.name = "RelayStaleFileError"
  }
}

export type RelayShareFile = {
  // Same-origin URL the browser fetches the original bytes from when the Relay
  // needs them uploaded (lib/thumbnailURL.ts). Only read on the bytes_required path.
  url: string
  path: string
  sha256: string
  filename: string
  size: number
}

// The one phase transition the caller cannot infer from progress events: the
// action came back 409 bytes_required, so this copy has to MATERIALIZE the
// file (a full download of the original, then the upload) before a single
// upload.onprogress tick can fire. For a multi-GB video that first leg is as
// long as the second — without this the UI is silent for half the operation.
export type RelaySharePhase = "materializing"

export type RelayShareOptions = {
  onPhase?: (phase: RelaySharePhase) => void
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

// Copy-as-file via the Relay's share verb. A fresh action_id per call: a repeat
// copy of the same file must re-run (the Relay serves it from cache on the new
// id). 2xx => done immediately (mapped path or cache hit). 409 bytes_required
// => push the bytes, then poll the action to completion.
export async function relayShare(
  session: RelaySession,
  file: RelayShareFile,
  options: RelayShareOptions = {},
): Promise<void> {
  await runRelayShare(session, file, options)
}

async function runRelayShare(
  session: RelaySession,
  file: RelayShareFile,
  options: RelayShareOptions,
): Promise<void> {
  const actionId = crypto.randomUUID()
  const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${session.credential}` }
  const response = await fetch(`${session.relayURL}/v1/actions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      action_id: actionId,
      action: "copy_to_clipboard",
      path: file.path,
      sha256: file.sha256.toLowerCase(),
      filename: file.filename,
      // size MAY be 0 for a legitimately empty file — send 0, never omit it.
      size: file.size,
    }),
    signal: options.signal,
  })
  if (response.ok) return
  const body = await response.json().catch(() => null)
  const code = relayErrorCode(body)
  if (response.status === 413 && code === "file_too_large") {
    const details = (body as any)?.error?.details ?? {}
    throw new RelayFileTooLargeError(Number(details.size ?? file.size), Number(details.max ?? 0))
  }
  if (response.status !== 409 || code !== "bytes_required") {
    throw new RelayRequestError(response.status, code, relayErrorMessage(body, `Local Relay copy failed (${response.status})`))
  }
  // Announce the materializing phase BEFORE the download starts: everything
  // below this line takes real time and reports nothing until the upload.
  options.onPhase?.("materializing")
  const completed = await uploadRelayBytes(session, actionId, file, options)
  // A 204 is `complete_action`'s own answer: the Relay ran the clipboard
  // handler and it SUCCEEDED before the upload response was written (a failure
  // comes back as a 500 on the upload itself). Polling from there only adds a
  // 1200 ms sleep and one more GET. The poll stays for any other 2xx, where
  // the record may still be Executing.
  if (!completed) await pollRelayShare(session, actionId, options.signal)
}

// Fetch the original bytes to a Blob and stream them to the Relay over XHR
// (§0.3: XHR not fetch, for upload.onprogress).
async function uploadRelayBytes(
  session: RelaySession,
  actionId: string,
  file: RelayShareFile,
  options: RelayShareOptions,
): Promise<boolean> {
  const fileResponse = await fetch(file.url, { signal: options.signal })
  if (!fileResponse.ok) {
    throw new RelayRequestError(fileResponse.status, "fetch_failed", "Could not read the file to copy")
  }
  const blob = await fileResponse.blob()
  // The declared size came from the index; the Blob's is the truth. A
  // disagreement means the file changed on disk since the scan, so the Relay's
  // hash check against the INDEXED sha256 is guaranteed to fail too — uploading
  // would push the whole file only to be refused. Bail to Download instead.
  if (blob.size !== file.size) throw new RelayStaleFileError()
  const payload = blob
  const completed = await new Promise<boolean>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", `${session.relayURL}/v1/files/${actionId}`)
    xhr.setRequestHeader("Authorization", `Bearer ${session.credential}`)
    xhr.setRequestHeader("Content-Type", "application/octet-stream")
    xhr.upload.onprogress = event => {
      // A 0-byte upload has total 0 — loaded/total is NaN, which would reach
      // the toast as "NaN%". Report a fraction only when it is well-defined.
      if (event.lengthComputable && event.total > 0 && options.onProgress) {
        options.onProgress(event.loaded / event.total)
      }
    }
    xhr.onload = () => {
      // 204 = the action already completed (see runRelayShare).
      if (xhr.status >= 200 && xhr.status < 300) { resolve(xhr.status === 204); return }
      let errBody: any = null
      try { errBody = JSON.parse(xhr.responseText) } catch { /* opaque body */ }
      reject(new RelayRequestError(xhr.status, relayErrorCode(errBody), relayErrorMessage(errBody, `Relay upload failed (${xhr.status})`)))
    }
    xhr.onerror = () => reject(new RelayRequestError(0, "upload_failed", "The upload to the desktop Relay failed"))
    xhr.onabort = () => reject(new RelayRequestError(0, "aborted", "Copy canceled"))
    if (options.signal) {
      if (options.signal.aborted) { xhr.abort(); return }
      options.signal.addEventListener("abort", () => xhr.abort(), { once: true })
    }
    xhr.send(payload)
  })
  return completed
}

// Poll the action after an upload, reusing the mapping flow's 1200 ms cadence:
// 204 done, 202 executing => wait, anything else is an error (a recurring
// bytes_required after a successful upload is treated as one).
async function pollRelayShare(session: RelaySession, actionId: string, signal?: AbortSignal): Promise<void> {
  const headers = { "Authorization": `Bearer ${session.credential}` }
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1200))
    if (signal?.aborted) throw new RelayRequestError(0, "aborted", "Copy canceled")
    const response = await fetch(`${session.relayURL}/v1/actions/${actionId}`, { headers, cache: "no-store" })
    if (response.ok) return
    if (response.status === 202) continue
    const body = await response.json().catch(() => null)
    throw new RelayRequestError(response.status, relayErrorCode(body), relayErrorMessage(body, `Local Relay copy failed (${response.status})`))
  }
  throw new RelayRequestError(408, "copy_timeout", "Timed out waiting for the desktop to finish copying")
}
