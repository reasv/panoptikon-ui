"use client"

import { $api } from "@/lib/api"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Group, InputObject, Model, transformData } from "@/components/table/columns/models"
import { useExternalInputs } from "@/components/external-inputs"

/// Per-model wizard overrides. Batch size is deliberately absent: it is a
/// cap now, not a target, and new databases always start on auto
/// (docs/batch-calibration-design.md, "Batch size UX").
export type WizardModelSettings = Record<string, { threshold?: number }>

type ModelWithDefaults = Model & {
  default_threshold?: number
}

function fullId(group: Group, modelId: string) {
  return `${group.group_name}/${modelId}`
}

export function WizardModelSelection({
  selected,
  settings,
  onSelectedChange,
  onSettingsChange,
}: {
  selected: string[]
  settings: WizardModelSettings
  onSelectedChange(value: string[]): void
  onSettingsChange(value: WizardModelSettings): void
}) {
  const { data, isLoading, error } = $api.useQuery("get", "/api/inference/metadata")
  const externalInputs = useExternalInputs()
  const groups = data ? transformData(data as unknown as InputObject) : []

  function defaultsFor(group: Group, model: ModelWithDefaults) {
    return {
      threshold: model.default_threshold ?? group.default_threshold,
    }
  }

  function toggleModel(group: Group, model: ModelWithDefaults, checked: boolean) {
    const id = fullId(group, model.inference_id)
    const selectedSet = new Set(selected)
    if (checked) {
      selectedSet.add(id)
      if (!settings[id]) onSettingsChange({ ...settings, [id]: defaultsFor(group, model) })
    } else {
      selectedSet.delete(id)
    }
    const ordered = groups.flatMap((group) => group.inference_ids.map((model) => fullId(group, model.inference_id))).filter((candidate) => selectedSet.has(candidate))
    onSelectedChange(ordered)
  }

  function changeSetting(id: string, current: { threshold?: number }, patch: Partial<{ threshold: number }>) {
    onSettingsChange({ ...settings, [id]: { ...current, ...patch } })
  }

  return (
    <section className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Choose AI models</h1>
        <p className="text-muted-foreground">Models add generated information such as tags, extracted text, captions, and semantic-search embeddings to the files in this database.</p>
        <p className="text-sm text-muted-foreground">No models are selected automatically. Model descriptions identify recommended choices where applicable, and their display order follows Panoptikon’s model registry. Selected models become this database’s persistent routine processing list.</p>
        <p className="text-sm text-muted-foreground">The first run may download large model files and can take considerable time. Nothing is downloaded or queued until the wizard finishes.</p>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading available models…</p>}
      {error && <p className="text-destructive" role="alert">Panoptikon could not load the available models.</p>}
      {groups.length > 0 && (
        <Tabs defaultValue={groups[0].group_name} className="rounded-lg border p-4">
          <TabsList className="h-auto flex-wrap justify-start">
            {groups.map((group) => {
              const count = group.inference_ids.filter((model) => selected.includes(fullId(group, model.inference_id))).length
              return <TabsTrigger key={group.group_name} value={group.group_name}>{group.name}{count > 0 ? ` (${count})` : ""}</TabsTrigger>
            })}
          </TabsList>

          {groups.map((group) => {
            return (
              <TabsContent key={group.group_name} value={group.group_name} className="mt-4 space-y-4">
                <div className="space-y-1">
                  <h2 className="font-medium">{group.name}</h2>
                  <p className="text-sm text-muted-foreground">{group.description}</p>
                </div>

                <div className="space-y-2">
                  {group.inference_ids.map((model) => {
                    const id = fullId(group, model.inference_id)
                    const checked = selected.includes(id)
                    const defaults = defaultsFor(group, model)
                    const modelSettings = settings[id] ?? defaults
                    const inputUsages = externalInputs.data?.models[id] ?? []
                    const missingRequired = inputUsages.some((usage) => usage.required && !externalInputs.data?.definitions[usage.id]?.configured)
                    return (
                      <div key={id} className={`rounded-md border p-3 ${checked ? "border-primary bg-primary/5" : ""}`}>
                        <div className="flex gap-3">
                          <Checkbox id={`model-${id}`} checked={checked} disabled={!!model.unavailable} onCheckedChange={(value) => toggleModel(group, model, value === true)} />
                          <Label htmlFor={`model-${id}`} className="min-w-0 cursor-pointer space-y-1 font-normal">
                            <span className="block break-all font-mono text-sm font-medium">{model.inference_id}</span>
                            <span className="block text-sm text-muted-foreground">{model.description}</span>
                            {model.unavailable && <span className="mt-1 block text-xs text-destructive">{model.unavailable_reason ? `Not available on this system: ${model.unavailable_reason}` : "Not available on this system"}</span>}
                            {inputUsages.length > 0 && <span className={`mt-1 block text-xs ${missingRequired ? "text-destructive" : "text-muted-foreground"}`}>{missingRequired ? "Additional configuration required" : "Additional configuration available"}</span>}
                          </Label>
                        </div>

                        {checked && defaults.threshold !== undefined && defaults.threshold !== null && (
                          <div className="mt-4 grid gap-4 border-t pt-4 lg:grid-cols-2">
                            {(
                              <div className="space-y-3 rounded-md border bg-background p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div><Label>Confidence threshold</Label><p className="text-xs text-muted-foreground">Lower values retain more model results.</p></div>
                                  <span className="whitespace-nowrap text-sm font-medium">{modelSettings.threshold} <span className="font-normal text-muted-foreground">(default {defaults.threshold})</span></span>
                                </div>
                                <Slider min={0} max={1} step={0.01} value={[modelSettings.threshold ?? defaults.threshold]} onValueChange={([threshold]) => changeSetting(id, modelSettings, { threshold })} aria-label={`${model.inference_id} confidence threshold`} />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </TabsContent>
            )
          })}
        </Tabs>
      )}

      <p className="text-sm font-medium">{selected.length} model{selected.length === 1 ? "" : "s"} selected</p>
    </section>
  )
}
