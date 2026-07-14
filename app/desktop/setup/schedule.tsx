"use client"

import { useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

export type ScheduleMode = "daily" | "hours" | "weekly" | "custom"
export type WizardSchedule = {
  enabled: boolean
  mode: ScheduleMode
  time: string
  everyHours: string
  weekday: string
  cron: string
}

const compactFocus = "focus:ring-inset focus:ring-offset-0 focus-visible:ring-inset focus-visible:ring-offset-0"

function cronFor(value: WizardSchedule): string {
  if (value.mode === "custom") return value.cron
  const [hour, minute] = value.time.split(":").map(Number)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return ""
  if (value.mode === "daily") return `${minute} ${hour} * * *`
  if (value.mode === "weekly") return `${minute} ${hour} * * ${value.weekday}`
  return value.everyHours === "1" ? "0 * * * *" : `0 */${value.everyHours} * * *`
}

export function describeSchedule(value: WizardSchedule): string {
  if (value.mode === "daily") return `Every day at ${value.time}`
  if (value.mode === "hours") return `Every ${value.everyHours === "1" ? "hour" : `${value.everyHours} hours`}`
  if (value.mode === "weekly") return `Every week on ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(value.weekday)]} at ${value.time}`
  return "Custom cron schedule"
}

export function WizardScheduleSelection({
  value,
  selectedModelCount,
  valid,
  nextRun,
  error,
  onChange,
  onPreviewChange,
}: {
  value: WizardSchedule
  selectedModelCount: number
  valid: boolean
  nextRun: string | null
  error: string | null
  onChange(value: WizardSchedule): void
  onPreviewChange(valid: boolean, nextRun: string | null, error: string | null): void
}) {
  const effectiveCron = cronFor(value)

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/desktop/setup-schedule/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cron_schedule: effectiveCron }),
          signal: controller.signal,
        })
        if (!response.ok) throw new Error("Panoptikon could not preview this schedule.")
        const result = await response.json() as { valid: boolean; next_run: string | null; error: string | null }
        onPreviewChange(result.valid, result.next_run, result.error)
      } catch (reason) {
        if (!controller.signal.aborted) onPreviewChange(false, null, reason instanceof Error ? reason.message : String(reason))
      }
    }, 250)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [effectiveCron, onPreviewChange])

  function patch(patchValue: Partial<WizardSchedule>) {
    const next = { ...value, ...patchValue }
    if (next.mode !== "custom") next.cron = cronFor(next)
    onPreviewChange(false, null, null)
    onChange(next)
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return (
    <section className="max-w-3xl space-y-5">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Schedule routine processing</h1>
        <p className="text-muted-foreground">A routine run performs a full file scan and then runs the {selectedModelCount} model{selectedModelCount === 1 ? "" : "s"} selected in the previous step.</p>
        <p className="text-sm text-muted-foreground">The wizard always queues the first run immediately after setup. Automatic scheduling controls later runs; even when it is disabled, the same processing plan can be started manually from the Scan page.</p>
      </div>

      <div className="flex items-start justify-between gap-5 rounded-lg border p-4">
        <div className="space-y-1">
          <Label htmlFor="automatic-routine" className="text-base font-medium">Run automatically</Label>
          <p className="text-sm text-muted-foreground">Keep this database reconciled and its selected model data up to date.</p>
        </div>
        <Switch id="automatic-routine" checked={value.enabled} onCheckedChange={(enabled) => patch({ enabled })} />
      </div>

      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-4">
          {([['daily', 'Daily'], ['hours', 'Every few hours'], ['weekly', 'Weekly'], ['custom', 'Custom cron']] as [ScheduleMode, string][]).map(([mode, label]) => (
            <button key={mode} type="button" onClick={() => patch({ mode })} className={`rounded-md border px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-0 ${value.mode === mode ? "border-primary bg-primary/5" : ""}`}>{label}</button>
          ))}
        </div>

        {value.mode === "hours" && (
          <div className="w-fit space-y-2"><Label>Frequency</Label><Select value={value.everyHours} onValueChange={(everyHours) => patch({ everyHours })}><SelectTrigger className={`w-48 ${compactFocus}`}><SelectValue /></SelectTrigger><SelectContent>{["1", "3", "6", "8", "12"].map((hours) => <SelectItem key={hours} value={hours}>Every {hours === "1" ? "hour" : `${hours} hours`}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Runs at the start of the hour.</p></div>
        )}
        {value.mode === "daily" && <div className="w-fit space-y-2"><Label htmlFor="daily-time">Time of day</Label><Input id="daily-time" className={`w-28 px-2 text-center ${compactFocus}`} type="time" value={value.time} onChange={(event) => patch({ time: event.target.value })} /></div>}
        {value.mode === "weekly" && <div className="flex flex-wrap gap-4"><div className="w-36 space-y-2"><Label>Day</Label><Select value={value.weekday} onValueChange={(weekday) => patch({ weekday })}><SelectTrigger className={compactFocus}><SelectValue /></SelectTrigger><SelectContent>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => <SelectItem key={day} value={String(index)}>{day}</SelectItem>)}</SelectContent></Select></div><div className="w-fit space-y-2"><Label htmlFor="weekly-time">Time</Label><Input id="weekly-time" className={`w-28 px-2 text-center ${compactFocus}`} type="time" value={value.time} onChange={(event) => patch({ time: event.target.value })} /></div></div>}
        {value.mode === "custom" && <div className="w-fit space-y-2"><Label htmlFor="custom-cron">Cron expression</Label><Input id="custom-cron" className={`w-64 font-mono ${compactFocus}`} value={value.cron} onChange={(event) => patch({ cron: event.target.value })} placeholder="0 3 * * *" /><p className="text-xs text-muted-foreground">Five fields: minute, hour, day of month, month, day of week.</p></div>}

        <div className="space-y-1 rounded-lg border bg-muted/20 p-4">
          <p className="font-medium">{describeSchedule(value)}</p>
          <p className="font-mono text-sm">{effectiveCron || "—"}</p>
          <p className="text-sm text-muted-foreground">Local timezone: {timezone}</p>
          {valid && nextRun && <p className="text-sm">{value.enabled ? "Next automatic run" : "Next run if enabled"}: {new Date(nextRun).toLocaleString()}</p>}
          {!valid && error && <p className="text-sm text-destructive" role="alert">Invalid schedule: {error}</p>}
          {!valid && !error && <p className="text-sm text-muted-foreground">Checking schedule…</p>}
        </div>
      </div>
    </section>
  )
}

export function effectiveCronSchedule(value: WizardSchedule): string {
  return cronFor(value)
}
