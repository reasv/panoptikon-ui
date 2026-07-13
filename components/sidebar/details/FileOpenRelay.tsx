"use client"

import { useState } from "react"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Switch } from "../../ui/switch"
import { Label } from "../../ui/label"
import { FilterContainer } from "../base/FilterContainer"
import { useToast } from "@/components/ui/use-toast"
import { useRelayConfigState } from "@/lib/state/relayConfig"
import { useClientConfig } from "@/lib/useClientConfig"

export function RelayConfig() {
  const relay = useRelayConfigState()
  const [url, setUrl] = useState(relay.relayURL)
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  const { data: clientConfig } = useClientConfig()
  if (clientConfig?.desktopManaged) return null

  async function requestPairing() {
    setBusy(true)
    try {
      const base = url.replace(/\/$/, "")
      const health = await fetch(`${base}/v1/health`).then((response) => response.json())
      if (health.protocol !== "panoptikon-relay-v1") throw new Error("This is not a Panoptikon Desktop Relay v1 service")
      const response = await fetch(`${base}/v1/pairing/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: document.title || location.host, origin: location.origin, server_url: location.origin }),
      })
      if (!response.ok) throw new Error(`Pairing request failed (${response.status})`)
      const pending = await response.json()
      relay.setRelayURL(base)
      relay.setPairingRequestId(pending.request_id)
      toast({ title: "Approve pairing in Panoptikon Desktop", description: `Desktop will show this browser origin: ${location.origin}` })
    } catch (error) {
      toast({ title: "Relay pairing failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" })
    } finally { setBusy(false) }
  }

  async function checkPairing() {
    setBusy(true)
    try {
      const response = await fetch(`${relay.relayURL}/v1/pairing/${relay.pairingRequestId}`)
      if (!response.ok) throw new Error(`Pairing status failed (${response.status})`)
      const status = await response.json()
      if (status.status === "approved") {
        relay.setPaired(status.instance_id, status.credential)
        toast({ title: "Relay paired", description: "Open and Show in Folder now use this computer." })
      } else if (status.status === "rejected") {
        relay.clearPairing()
        throw new Error("Pairing was rejected")
      } else toast({ title: "Pairing is still waiting for local approval" })
    } catch (error) {
      toast({ title: "Relay pairing failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" })
    } finally { setBusy(false) }
  }

  return <FilterContainer label={<span>Desktop Relay</span>} description={<span>Open remote Panoptikon files on this computer</span>} storageKey="panoptikon-relay-v1" unMountOnCollapse>
    <div className="space-y-4 rounded-lg border p-4 mt-4">
      <div className="flex items-center justify-between"><div><Label>Use Relay</Label><p className="text-sm text-gray-400">Credentials are unique to this Panoptikon origin.</p></div><Switch checked={relay.enabled} disabled={!relay.credential} onCheckedChange={relay.setEnabled} /></div>
      <div className="flex gap-2"><Input value={url} onChange={(event) => setUrl(event.target.value)} aria-label="Relay URL" /><Button disabled={busy} onClick={requestPairing}>Pair</Button></div>
      {relay.pairingRequestId && <Button disabled={busy} variant="outline" onClick={checkPairing}>Check approval</Button>}
      {relay.credential && <div className="flex justify-between items-center"><span className="text-sm text-green-400">Paired with Panoptikon Desktop</span><Button variant="ghost" onClick={relay.clearPairing}>Forget locally</Button></div>}
    </div>
  </FilterContainer>
}
