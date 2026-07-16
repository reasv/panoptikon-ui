"use client"

import { ChevronRight } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { FolderValidationIssue, WizardPathListEditor } from "./folder-selector"

export type ContinuousScanMode = "watcher" | "poller"

export function WizardContinuousScan({
  enabled,
  mode,
  pollInterval,
  watchedFolders,
  includedFolders,
  foldersStepNumber,
  errors,
  onEnabledChange,
  onModeChange,
  onPollIntervalChange,
  onWatchedFoldersChange,
}: {
  enabled: boolean
  mode: ContinuousScanMode
  pollInterval: string
  watchedFolders: string
  includedFolders: string[]
  foldersStepNumber: number
  errors: FolderValidationIssue[]
  onEnabledChange(value: boolean): void
  onModeChange(value: ContinuousScanMode): void
  onPollIntervalChange(value: string): void
  onWatchedFoldersChange(value: string): void
}) {
  const pollSeconds = Number(pollInterval)
  const invalidPollInterval = mode === "poller" && (!Number.isInteger(pollSeconds) || pollSeconds < 1)

  return (
    <section className="max-w-3xl space-y-5">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Keep the index up to date</h1>
        <p className="text-muted-foreground">
          Continuous scanning notices file changes while Panoptikon is running, so new, changed, moved, and removed files can be reflected without waiting for a full scan.
        </p>
        <p className="text-sm text-muted-foreground">
          It complements rather than replaces full file scans. Some changes cannot be detected continuously, and temporary drive or network problems are handled conservatively. Periodic full scans remain the final check and can be scheduled in one of the next steps.
        </p>
      </div>

      <div className="flex items-start justify-between gap-5 rounded-lg border p-4">
        <div className="space-y-1">
          <Label htmlFor="continuous-scanning" className="text-base font-medium">Enable continuous scanning</Label>
          <p className="text-sm text-muted-foreground">Monitor this database between its scheduled full scans.</p>
        </div>
        <Switch id="continuous-scanning" checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      <div className={`space-y-5 ${enabled ? "" : "opacity-50"}`} aria-disabled={!enabled}>
        <fieldset disabled={!enabled} className="space-y-3">
          <legend className="font-medium">How should Panoptikon detect changes?</legend>

          <label className="flex cursor-pointer gap-3 rounded-lg border p-4 has-checked:border-primary has-checked:bg-primary/5">
            <input
              type="radio"
              name="continuous-scan-mode"
              value="watcher"
              checked={mode === "watcher"}
              onChange={() => onModeChange("watcher")}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <span className="space-y-1">
              <span className="block font-medium">Native file events</span>
              <span className="block text-sm text-muted-foreground">
                Best for databases containing only local folders. The operating system reports changes immediately with very little background work, but network mounts often do not deliver these events reliably.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer gap-3 rounded-lg border p-4 has-checked:border-primary has-checked:bg-primary/5">
            <input
              type="radio"
              name="continuous-scan-mode"
              value="poller"
              checked={mode === "poller"}
              onChange={() => onModeChange("poller")}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <span className="space-y-1">
              <span className="block font-medium">Periodic polling</span>
              <span className="block text-sm text-muted-foreground">
                Use this when any included folder is on an SMB, NFS, or other network mount. Each pass checks directory timestamps and opens only directories that changed—it does not rescan or hash every file. An idle pass ordinarily takes a fraction of a second, though very large or slow network trees may take longer.
              </span>
              <span className="block text-sm text-muted-foreground">
                Polling detects files being added, removed, or renamed. An in-place edit may not change its parent directory timestamp and can therefore wait for the next scheduled full scan.
              </span>
            </span>
          </label>
        </fieldset>

        {mode === "poller" && (
          <div className="max-w-sm space-y-2">
            <Label htmlFor="poll-interval">Polling interval</Label>
            <div className="flex items-center gap-2">
              <Input
                id="poll-interval"
                type="number"
                min={1}
                step={1}
                disabled={!enabled}
                value={pollInterval}
                onChange={(event) => onPollIntervalChange(event.target.value)}
                aria-invalid={invalidPollInterval}
              />
              <span className="text-sm text-muted-foreground">seconds</span>
            </div>
            <p className="text-sm text-muted-foreground">Shorter intervals notice changes sooner but perform directory metadata checks more often. 60 seconds is a good starting point.</p>
            {invalidPollInterval && <p className="text-sm text-destructive" role="alert">Enter a whole number of seconds, at least 1.</p>}
          </div>
        )}

        <details className="group rounded-lg border">
          <summary className="flex cursor-pointer list-none items-center gap-2 p-4 font-medium [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
            Limit continuous scanning to specific folders
            <span className="ml-auto text-sm font-normal text-muted-foreground">Optional</span>
          </summary>
          <div className="space-y-4 border-t p-4">
            <p className="text-sm text-muted-foreground">
              Leave this empty to continuously monitor every included folder. Add a whitelist only when some indexed folders should be updated by full scans alone. Each path must be inside an included folder and outside every excluded folder.
            </p>
            <WizardPathListEditor
              value={watchedFolders}
              disabled={!enabled}
              className="min-h-32"
              onChange={onWatchedFoldersChange}
            />

            <details className="group rounded-md border bg-muted/20">
              <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
                Review folders selected in step {foldersStepNumber}, “Folders” ({includedFolders.length})
              </summary>
              <div className="border-t p-3">
                <ul className="space-y-2">
                  {includedFolders.map((path) => <li key={path} className="break-all font-mono text-sm">{path}</li>)}
                </ul>
              </div>
            </details>
          </div>
        </details>
      </div>

      {errors.length > 0 && (
        <section className="space-y-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4" role="alert">
          <div>
            <h2 className="font-semibold text-destructive">Some continuously watched folders could not be used</h2>
            <p className="text-sm text-muted-foreground">Correct or remove these paths before continuing.</p>
          </div>
          <ul className="space-y-3">
            {errors.map((issue, index) => (
              <li key={`${issue.path}-${index}`} className="text-sm">
                <div className="break-all font-mono font-medium">{issue.path}</div>
                <div className="text-muted-foreground">{issue.error}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
