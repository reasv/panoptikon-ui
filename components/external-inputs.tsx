"use client"

import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useClientConfig } from "@/lib/useClientConfig"

export type ExternalInputDefinition = {
  label: string
  description: string
  secret: boolean
  required: boolean
  source: { type: "environment"; variable: string }
  configured: boolean
}

export type ExternalInputUsage = {
  id: string
  required: boolean
  description?: string | null
}

export type ExternalInputRegistry = {
  definitions: Record<string, ExternalInputDefinition>
  models: Record<string, ExternalInputUsage[]>
}

async function fetchExternalInputs(): Promise<ExternalInputRegistry> {
  const response = await fetch("/api/inference/external-inputs", { cache: "no-store" })
  if (!response.ok) throw new Error("Failed to load additional model configuration")
  return await response.json()
}

export function useExternalInputs() {
  return useQuery({
    queryKey: ["inference-external-inputs"],
    queryFn: fetchExternalInputs,
    staleTime: 0,
  })
}

export function selectedExternalInputIds(
  registry: ExternalInputRegistry | undefined,
  models: string[],
) {
  if (!registry) return []
  return Array.from(new Set(models.flatMap((model) => (registry.models[model] ?? []).map((usage) => usage.id))))
}

export function missingRequiredExternalInputs(
  registry: ExternalInputRegistry | undefined,
  models: string[],
) {
  if (!registry) return []
  return selectedExternalInputIds(registry, models).filter((id) => {
    const required = models.some((model) =>
      (registry.models[model] ?? []).some((usage) => usage.id === id && usage.required),
    )
    return required && !registry.definitions[id]?.configured
  })
}

export function ExternalInputEditor({
  selectedModels,
  onReadyChange,
}: {
  selectedModels?: string[]
  onReadyChange?: (ready: boolean) => void
}) {
  const query = useExternalInputs()
  const clientConfig = useClientConfig()
  const desktopManagement = useQuery({
    queryKey: ["desktop-external-inputs"],
    enabled: clientConfig.data?.desktopManaged === true,
    queryFn: async (): Promise<{ managed: boolean; values: Record<string, string> }> => {
      const response = await fetch("/api/desktop/external-inputs", { cache: "no-store" })
      if (!response.ok) throw new Error("Failed to inspect Desktop inference management")
      return await response.json()
    },
  })
  const queryClient = useQueryClient()
  const [values, setValues] = useState<Record<string, string>>({})
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const registry = query.data
  const desktopCanManage = clientConfig.data?.desktopManaged === true && desktopManagement.data?.managed === true
  const modelIds = selectedModels ?? Object.keys(registry?.models ?? {})
  const inputIds = selectedModels
    ? selectedExternalInputIds(registry, modelIds)
    : Object.keys(registry?.definitions ?? {})
  const missing = missingRequiredExternalInputs(registry, modelIds)
  const ready = !query.isLoading && !query.error && missing.length === 0

  useEffect(() => {
    onReadyChange?.(ready)
  }, [onReadyChange, ready])

  async function save() {
    if (!registry || !desktopCanManage) return
    const updates: Record<string, string> = {}
    for (const id of inputIds) {
      const value = values[id]
      if (value !== undefined && value !== "") {
        updates[registry.definitions[id].source.variable] = value
      }
    }
    if (Object.keys(updates).length === 0) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch("/api/desktop/external-inputs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: updates, remove: [] }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { detail?: string } | null
        throw new Error(body?.detail ?? "Failed to save additional configuration")
      }
      setValues({})
      await queryClient.invalidateQueries({ queryKey: ["inference-external-inputs"] })
      await queryClient.invalidateQueries({ queryKey: ["desktop-external-inputs"] })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!registry || !desktopCanManage) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch("/api/desktop/external-inputs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: {}, remove: [registry.definitions[id].source.variable] }),
      })
      if (!response.ok) throw new Error("Failed to remove the configured value")
      await queryClient.invalidateQueries({ queryKey: ["inference-external-inputs"] })
      await queryClient.invalidateQueries({ queryKey: ["desktop-external-inputs"] })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  async function toggleSecret(id: string) {
    if (!registry) return
    if (visible[id]) {
      setVisible((current) => ({ ...current, [id]: false }))
      return
    }
    if (registry.definitions[id].configured && values[id] === undefined && desktopCanManage) {
      setError(null)
      try {
        const variable = registry.definitions[id].source.variable
        const response = await fetch(`/api/desktop/external-inputs/${encodeURIComponent(variable)}`, { cache: "no-store" })
        if (!response.ok) throw new Error("Failed to reveal the configured value")
        const body = await response.json() as { value?: string | null }
        setValues((current) => ({ ...current, [id]: body.value ?? "" }))
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
        return
      }
    }
    setVisible((current) => ({ ...current, [id]: true }))
  }

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Loading additional configuration…</p>
  if (query.error) return <p className="text-sm text-destructive">Additional model configuration could not be loaded.</p>
  if (!registry || inputIds.length === 0) return <p className="text-sm text-muted-foreground">No additional configuration is declared.</p>

  return (
    <div className="space-y-4">
      {inputIds.map((id) => {
        const definition = registry.definitions[id]
        if (!definition) return null
        const usages = modelIds.flatMap((model) =>
          (registry.models[model] ?? [])
            .filter((usage) => usage.id === id)
            .map((usage) => ({ model, ...usage })),
        )
        const required = usages.some((usage) => usage.required)
        const configured = definition.configured
        const displayedValue = values[id] ?? desktopManagement.data?.values?.[definition.source.variable] ?? ""
        return (
          <section key={id} className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Label htmlFor={`external-input-${id}`} className="text-base">{definition.label}</Label>
                <p className="mt-1 text-sm text-muted-foreground">{definition.description}</p>
              </div>
              <span className={`flex items-center gap-1 text-xs ${configured ? "text-green-600" : required ? "text-destructive" : "text-muted-foreground"}`}>
                {configured ? <CheckCircle2 className="h-3.5 w-3.5" /> : required ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
                {configured ? "Configured" : required ? "Required" : "Optional"}
              </span>
            </div>
            {usages.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Used by</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {usages.map((usage) => <li key={usage.model}><span className="font-mono">{usage.model}</span>{usage.description ? ` — ${usage.description}` : usage.required ? " — required" : " — optional"}</li>)}
                </ul>
              </div>
            )}
            {desktopCanManage ? (
              <div className="flex gap-2">
                <Input
                  id={`external-input-${id}`}
                  type={definition.secret && !visible[id] ? "password" : "text"}
                  value={displayedValue}
                  placeholder={configured ? "Leave empty to keep the current value" : definition.source.variable}
                  onChange={(event) => setValues((current) => ({ ...current, [id]: event.target.value }))}
                  autoComplete="off"
                />
                {definition.secret && <Button type="button" variant="outline" size="icon" onClick={() => void toggleSecret(id)} aria-label={visible[id] ? "Hide value" : "Show value"}>{visible[id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>}
                {configured && <Button type="button" variant="outline" onClick={() => void remove(id)} disabled={saving}>Remove</Button>}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Set <code>{definition.source.variable}</code> on the Inferio host before loading the affected model.</p>
            )}
          </section>
        )
      })}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {desktopCanManage && <Button type="button" onClick={save} disabled={saving || Object.values(values).every((value) => !value)}>{saving ? "Saving…" : "Save configuration"}</Button>}
    </div>
  )
}
