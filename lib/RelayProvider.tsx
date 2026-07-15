"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSelectedDBs } from "@/lib/state/database"
import { fetchClient } from "@/lib/api"
import { RelayContext, type FileActionTarget } from "@/lib/relayContext"
import * as client from "@/lib/relayClient"

const queryKey = ["relay", "session", typeof location === "undefined" ? "server" : location.origin]
const targetKey = "panoptikon-file-action-target"

async function reconcile(): Promise<client.RelaySession | null> {
  const session = await client.discoverRelayHealth()
  if (!session) return null

  const pairing = await client.serverPairing(session.relay_id)
  if (pairing) {
    const ready = { ...session, instanceId: pairing.instance_id, credential: pairing.credential }
    try {
      await client.validateRelayCredential(ready)
      if (pairing.operation_id) {
        // Commit may have succeeded before the browser disappeared or before
        // acknowledgement reached Relay. Acknowledgement is cleanup-only and
        // idempotent once credential validation succeeds.
        await client.acknowledgeRelayOperation(ready, pairing.operation_id, pairing.credential).catch(() => {})
      }
      return ready
    } catch (error) {
      if (error instanceof client.RelayRequestError && error.code === "invalid_credential") {
        await client.forgetServerPairing(session.relay_id)
        return session
      }
      throw error
    }
  }

  const operation = await client.serverOperation(session.relay_id)
  if (!operation) return session
  const relayState = await client.relayOperation(session, operation.operation_id)
  if (!relayState) {
    // The browser may have disappeared after the durable Server operation was
    // created but before the loopback request arrived. Re-submit the same
    // operation ID; Relay creation is idempotent. Root hints can be supplied
    // by an explicit retry later, while unknown-root mapping remains usable.
    await client.createRelayOperation(session, operation.operation_id, [])
    return { ...session, operationId: operation.operation_id, pairingStatus: "pending" }
  }
  if (relayState.status === "rejected") {
    await client.cancelPairingOperation(session, operation.operation_id)
    return session
  }
  if (relayState.status === "approved_unconfirmed" && relayState.instance_id && relayState.credential) {
    await client.commitServerOperation(operation.operation_id, session, relayState.instance_id, relayState.credential)
    await client.acknowledgeRelayOperation(session, operation.operation_id, relayState.credential)
    return { ...session, instanceId: relayState.instance_id, credential: relayState.credential }
  }
  return { ...session, operationId: operation.operation_id, pairingStatus: "pending" }
}

export function RelayProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const selectedDBs = useSelectedDBs()[0]
  const [target, setTargetState] = useState<FileActionTarget>(() =>
    typeof localStorage !== "undefined" && localStorage.getItem(targetKey) === "existing" ? "existing" : "relay"
  )
  const session = useQuery({
    queryKey,
    queryFn: reconcile,
    staleTime: 4_000,
    refetchInterval: query => query.state.data?.pairingStatus === "pending" ? 1_000 : 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    retry: false,
  })

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === targetKey) setTargetState(event.newValue === "existing" ? "existing" : "relay")
    }
    window.addEventListener("storage", sync)
    return () => window.removeEventListener("storage", sync)
  }, [])

  const setTarget = useCallback((value: FileActionTarget) => {
    setTargetState(value)
    localStorage.setItem(targetKey, value)
  }, [])

  const pairing = useMutation({
    mutationFn: async () => {
      const relay = session.data
      if (!relay) throw new Error("Local Relay is unavailable")
      const stats = await fetchClient.GET("/api/search/stats", { params: { query: selectedDBs } })
      const roots = new Set(stats.data?.folders ?? [])
      const operation = await client.beginServerOperation(relay.relay_id)
      await client.createRelayOperation(relay, operation.operation_id, [...roots])
    },
    onSuccess: async () => {
      setTarget("relay")
      await queryClient.invalidateQueries({ queryKey })
    },
  })

  const handleAuthFailure = useCallback(async () => {
    const relay = session.data
    if (relay) await client.forgetServerPairing(relay.relay_id)
    queryClient.setQueryData(queryKey, relay ? { ...relay, credential: undefined, instanceId: undefined } : null)
    await queryClient.invalidateQueries({ queryKey })
  }, [queryClient, session.data])

  const run = useCallback(async (action: "open_file" | "reveal_in_folder", path: string) => {
    const relay = session.data
    if (!relay?.credential) throw new Error("Local Relay is not paired")
    try {
      await client.relayAction(relay, action, path)
    } catch (error) {
      if (error instanceof client.RelayRequestError && error.code === "invalid_credential") {
        await handleAuthFailure()
      }
      throw error
    }
  }, [handleAuthFailure, session.data])

  const value = useMemo(() => ({
    detected: !!session.data,
    paired: !!session.data?.credential,
    pairing: pairing.isPending || session.data?.pairingStatus === "pending",
    target,
    setTarget,
    pair: async () => { await pairing.mutateAsync() },
    run,
    refresh: async () => { await session.refetch() },
  }), [pairing, run, session, setTarget, target])

  return <RelayContext.Provider value={value}>{children}</RelayContext.Provider>
}
