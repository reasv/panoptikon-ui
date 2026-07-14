"use client"

import { CalendarClock, Database, FileType2, FolderTree, Radio, Sparkles } from "lucide-react"
import { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { WizardFileTypes } from "./file-types"
import { WizardModelSettings } from "./models"
import { describeSchedule, effectiveCronSchedule, WizardSchedule } from "./schedule"

function SummaryCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="shadow-none">
      <CardHeader className="flex-row items-center gap-3 space-y-0 p-4 pb-3">
        <span className="rounded-md bg-muted p-2 text-muted-foreground">{icon}</span>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-4 pb-4 text-sm">{children}</CardContent>
    </Card>
  )
}

export function WizardReview({
  database,
  includedFolders,
  excludedFolders,
  fileTypes,
  continuousEnabled,
  continuousMode,
  pollInterval,
  continuousFolders,
  selectedModels,
  modelSettings,
  schedule,
  scheduleNextRun,
}: {
  database: string
  includedFolders: string[]
  excludedFolders: string[]
  fileTypes: WizardFileTypes
  continuousEnabled: boolean
  continuousMode: "watcher" | "poller"
  pollInterval: string
  continuousFolders: string[]
  selectedModels: string[]
  modelSettings: WizardModelSettings
  schedule: WizardSchedule
  scheduleNextRun: string | null
}) {
  const enabledTypes = Object.entries(fileTypes).filter(([, enabled]) => enabled).map(([name]) => name)
  return (
    <section className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Review your index</h1>
        <p className="text-muted-foreground">The choices below have not been committed by this wizard yet. Check the configuration, then start the initial scan.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <SummaryCard icon={<Database className="h-5 w-5" />} title="Database">
          <p className="font-mono font-medium">{database}</p>
          <p className="text-muted-foreground">A separate searchable index with its own data and processing plan.</p>
        </SummaryCard>

        <SummaryCard icon={<FolderTree className="h-5 w-5" />} title="Folders">
          <p><strong>{includedFolders.length}</strong> included · <strong>{excludedFolders.length}</strong> excluded</p>
          <details><summary className="cursor-pointer text-muted-foreground">Review paths</summary><div className="mt-2 space-y-2 font-mono text-xs"><div><p className="mb-1 font-sans font-medium">Included</p>{includedFolders.map((path) => <p key={path} className="break-all">{path}</p>)}</div>{excludedFolders.length > 0 && <div><p className="mb-1 font-sans font-medium">Excluded</p>{excludedFolders.map((path) => <p key={path} className="break-all">{path}</p>)}</div>}</div></details>
        </SummaryCard>

        <SummaryCard icon={<FileType2 className="h-5 w-5" />} title="File types">
          <div className="flex flex-wrap gap-1.5">{enabledTypes.map((type) => <Badge key={type} variant="secondary" className="capitalize">{type}</Badge>)}</div>
        </SummaryCard>

        <SummaryCard icon={<Radio className="h-5 w-5" />} title="Continuous scanning">
          {continuousEnabled ? <><Badge>Enabled</Badge><p>{continuousMode === "poller" ? `Network-compatible polling every ${pollInterval} seconds` : "Native filesystem monitoring"}</p><p className="text-muted-foreground">{continuousFolders.length > 0 ? `${continuousFolders.length} selected folder${continuousFolders.length === 1 ? "" : "s"} monitored` : "All included folders monitored"}</p></> : <><Badge variant="outline">Disabled</Badge><p className="text-muted-foreground">Changes are found during scheduled or manually started full scans.</p></>}
        </SummaryCard>

        <SummaryCard icon={<Sparkles className="h-5 w-5" />} title="AI models">
          {selectedModels.length === 0 ? <p className="text-muted-foreground">No models selected. The initial run will only scan files.</p> : <div className="space-y-2">{selectedModels.map((model) => <div key={model} className="rounded-md border p-2"><p className="break-all font-mono text-xs font-medium">{model}</p><p className="mt-1 text-xs text-muted-foreground">Batch {modelSettings[model]?.batchSize ?? "default"}{modelSettings[model]?.threshold !== undefined ? ` · threshold ${modelSettings[model].threshold}` : ""}</p></div>)}</div>}
        </SummaryCard>

        <SummaryCard icon={<CalendarClock className="h-5 w-5" />} title="Routine processing">
          <Badge variant={schedule.enabled ? "default" : "outline"}>{schedule.enabled ? "Automatic" : "Manual only"}</Badge>
          <p>{describeSchedule(schedule)}</p>
          <p className="font-mono text-xs text-muted-foreground">{effectiveCronSchedule(schedule)}</p>
          {schedule.enabled && scheduleNextRun && <p className="text-muted-foreground">Next scheduled run: {new Date(scheduleNextRun).toLocaleString()}</p>}
        </SummaryCard>
      </div>

      <p className="rounded-lg border bg-muted/20 p-4 text-sm"><strong>When you start:</strong> Panoptikon saves this configuration, queues the initial file scan, and then runs the selected models in order. You’ll remain on the final Scan step while the work continues.</p>
    </section>
  )
}
