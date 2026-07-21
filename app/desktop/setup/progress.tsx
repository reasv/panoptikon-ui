"use client"

import Image from "next/image"
import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Ban, Check, ExternalLink, LoaderCircle, Search, Settings2, Timer } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { components } from "@/lib/panoptikon"
import { openPanoptikonPage } from "./open-panoptikon-page"
import { ServerAddress } from "./server-address"

type Job = components["schemas"]["JobModel"]
type Completion = components["schemas"]["DesktopSetupCompleteResponse"]
type Outcome = components["schemas"]["JobOutcomeModel"]

function jobName(job: Job) {
  if (job.job_type === "folder_update" || job.job_type === "folder_rescan") return "Initial file scan"
  if (job.job_type === "data_extraction") return job.metadata || "AI model extraction"
  return job.job_type.replaceAll("_", " ")
}

export function WizardProgress({ completion }: { completion: Completion }) {
  const [queue, setQueue] = useState<Job[] | null>(null)
  const [outcomes, setOutcomes] = useState<Outcome[]>([])
  const [queueError, setQueueError] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function refresh() {
      try {
        const response = await fetch("/api/jobs/queue", { cache: "no-store" })
        if (!response.ok) throw new Error("Panoptikon could not read the job queue.")
        const result = await response.json() as components["schemas"]["QueueStatusModel"]
        if (!cancelled) { setQueue(result.queue); setOutcomes(result.outcomes); setQueueError(null) }
      } catch (error) {
        if (!cancelled) setQueueError(error instanceof Error ? error.message : String(error))
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 1500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [])

  const trackedIds = useMemo(() => new Set(completion.jobs.map((job) => job.queue_id)), [completion.jobs])
  const active = queue?.filter((job) => trackedIds.has(job.queue_id)) ?? []
  const outcomeById = new Map(outcomes.map((outcome) => [outcome.queue_id, outcome]))
  const terminalCount = completion.jobs.filter((job) => outcomeById.has(job.queue_id)).length
  const failures = completion.jobs.filter((job) => outcomeById.get(job.queue_id)?.status === "failed")
  const allDone = completion.jobs.length > 0 && terminalCount === completion.jobs.length
  const progress = completion.jobs.length === 0 ? 0 : Math.round((terminalCount / completion.jobs.length) * 100)

  function openPage(page: "search" | "scan") {
    setOpenError(null)
    void openPanoptikonPage(page, completion.index_db).catch((error) => {
      setOpenError(error instanceof Error ? error.message : String(error))
    })
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6 pb-6">
      <div className="flex flex-col items-center text-center">
        <Image src="/spinner.svg" alt="Panoptikon processing" width={112} height={112} priority />
        <h1 className="mt-2 text-2xl font-semibold">{failures.length > 0 ? "Initial processing needs attention" : allDone ? "Initial processing complete" : "Building your index"}</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">{failures.length > 0 ? `One or more jobs for ${completion.index_db} failed. Review the details below or open the Scan page for the full job history.` : allDone ? `The initial jobs for ${completion.index_db} completed. Your files and generated data are ready to explore.` : `Panoptikon is scanning ${completion.index_db} and will run each selected model afterward. This continues in the background if you close this window.`}</p>
      </div>

      {completion.jobs.length > 0 ? (
        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3"><div><h2 className="font-medium">Initial processing</h2><p className="text-sm text-muted-foreground">{terminalCount} of {completion.jobs.length} jobs finished</p></div><span className="text-sm font-medium">{progress}%</span></div>
          <Progress value={progress} aria-label="Initial processing progress" />
          <div className="space-y-2">
            {completion.jobs.map((job) => {
              const current = active.find((entry) => entry.queue_id === job.queue_id)
              const outcome = outcomeById.get(job.queue_id)
              const status = outcome?.status ?? (queue === null ? "checking" : current?.running ? "running" : current ? "queued" : "checking")
              return (
                <div key={job.queue_id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                  <div className="min-w-0"><p className="truncate font-medium">{jobName(job)}</p><p className="text-xs text-muted-foreground">Job {job.queue_id}</p>{outcome?.error && <p className="mt-1 wrap-break-word text-xs text-destructive">{outcome.error}</p>}</div>
                  {status === "running" && <Badge><LoaderCircle className="mr-1 h-3 w-3 animate-spin" />Running</Badge>}
                  {status === "queued" && <Badge variant="secondary"><Timer className="mr-1 h-3 w-3" />Queued</Badge>}
                  {status === "completed" && <Badge variant="outline"><Check className="mr-1 h-3 w-3" />Completed</Badge>}
                  {status === "failed" && <Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3" />Failed</Badge>}
                  {status === "cancelled" && <Badge variant="outline"><Ban className="mr-1 h-3 w-3" />Cancelled</Badge>}
                  {status === "checking" && <Badge variant="secondary">Checking…</Badge>}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border p-4"><h2 className="font-medium">Processing already active</h2><p className="mt-1 text-sm text-muted-foreground">Panoptikon did not add a duplicate batch because processing for this database was already queued or running. Open the Scan page for the complete queue.</p></div>
      )}

      {queueError && <p className="text-sm text-destructive" role="alert">{queueError}</p>}
      <ServerAddress indexDb={completion.index_db} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Button size="lg" onClick={() => openPage("search")}><Search className="mr-2 h-4 w-4" />Open Search<ExternalLink className="ml-2 h-3.5 w-3.5 opacity-70" /></Button>
        <Button size="lg" variant="outline" onClick={() => openPage("scan")}><Settings2 className="mr-2 h-4 w-4" />Open Scan and job details<ExternalLink className="ml-2 h-3.5 w-3.5 opacity-70" /></Button>
      </div>
      <p className="text-center text-sm text-muted-foreground">Search may already show files while scanning continues. The Scan page shows the full queue and lets you manage or cancel jobs.</p>
      {openError && <p className="text-center text-sm text-destructive" role="alert">The browser could not be opened: {openError}</p>}
    </section>
  )
}
