"use client"

import { useCallback, useMemo, useState } from "react"
import { $api } from "@/lib/api"
import { components } from "@/lib/panoptikon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FolderValidationIssue, WizardFolderSelector } from "./folder-selector"
import { ContinuousScanMode, WizardContinuousScan } from "./continuous-scan"
import { WizardFileTypes, WizardFileTypeSelection } from "./file-types"
import { WizardModelSelection, WizardModelSettings } from "./models"
import { WizardSchedule, WizardScheduleSelection, effectiveCronSchedule } from "./schedule"
import { WizardReview } from "./review"
import { WizardProgress } from "./progress"
import { ExternalInputEditor, selectedExternalInputIds, useExternalInputs } from "@/components/external-inputs"

export type DesktopSetupMode = "onboarding" | "new-database"

type StepId = "welcome" | "database" | "folders" | "file-types" | "continuous" | "models" | "configuration" | "schedule" | "review" | "progress"

const onboardingSteps: { id: StepId; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "folders", label: "Folders" },
  { id: "file-types", label: "File types" },
  { id: "continuous", label: "Continuous scan" },
  { id: "models", label: "Models" },
  { id: "schedule", label: "Schedule" },
  { id: "review", label: "Review" },
  { id: "progress", label: "Scan" },
]

const newDatabaseSteps: { id: StepId; label: string }[] = [
  { id: "welcome", label: "New database" },
  { id: "database", label: "Name" },
  { id: "folders", label: "Folders" },
  { id: "file-types", label: "File types" },
  { id: "continuous", label: "Continuous scan" },
  { id: "models", label: "Models" },
  { id: "schedule", label: "Schedule" },
  { id: "review", label: "Review" },
  { id: "progress", label: "Scan" },
]

export function DesktopSetupWizard({ mode }: { mode: DesktopSetupMode }) {
  const [step, setStep] = useState(0)
  const [databaseName, setDatabaseName] = useState("")
  const [includedFolders, setIncludedFolders] = useState("")
  const [excludedFolders, setExcludedFolders] = useState("")
  const [folderErrors, setFolderErrors] = useState<FolderValidationIssue[]>([])
  const [fileTypes, setFileTypes] = useState<WizardFileTypes>({ images: true, video: true, audio: false, pdf: false, html: false })
  const [continuousScanEnabled, setContinuousScanEnabled] = useState(false)
  const [continuousScanMode, setContinuousScanMode] = useState<ContinuousScanMode>("watcher")
  const [pollInterval, setPollInterval] = useState("60")
  const [continuousFolders, setContinuousFolders] = useState("")
  const [continuousFolderErrors, setContinuousFolderErrors] = useState<FolderValidationIssue[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [modelSettings, setModelSettings] = useState<WizardModelSettings>({})
  const [externalInputsReady, setExternalInputsReady] = useState(false)
  const [schedule, setSchedule] = useState<WizardSchedule>({ enabled: true, mode: "daily", time: "03:00", everyHours: "3", weekday: "0", cron: "0 3 * * *" })
  const [scheduleValid, setScheduleValid] = useState(true)
  const [scheduleNextRun, setScheduleNextRun] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [completion, setCompletion] = useState<components["schemas"]["DesktopSetupCompleteResponse"] | null>(null)
  const { data: databases } = $api.useQuery("get", "/api/db")
  const externalInputs = useExternalInputs()
  const hasExternalInputs = selectedExternalInputIds(externalInputs.data, selectedModels).length > 0
  const baseSteps = mode === "onboarding" ? onboardingSteps : newDatabaseSteps
  const steps = hasExternalInputs
    ? baseSteps.flatMap((item) => item.id === "models" ? [item, { id: "configuration" as const, label: "Configuration" }] : [item])
    : baseSteps
  const currentStep = steps[step].id
  const existingNames = databases?.index.all ?? []
  const trimmedDatabaseName = databaseName.trim()
  const databaseNameError = useMemo(() => {
    if (mode !== "new-database") return null
    if (trimmedDatabaseName.length < 3 || trimmedDatabaseName.length > 32) {
      return "Use between 3 and 32 characters."
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmedDatabaseName)) {
      return "Use only letters, numbers, and underscores."
    }
    if (existingNames.some((name) => name.toLocaleLowerCase() === trimmedDatabaseName.toLocaleLowerCase())) {
      return `A database named “${trimmedDatabaseName}” already exists.`
    }
    return null
  }, [existingNames, mode, trimmedDatabaseName])
  const handleSchedulePreview = useCallback((valid: boolean, nextRun: string | null, error: string | null) => {
    setScheduleValid(valid)
    setScheduleNextRun(nextRun)
    setScheduleError(error)
  }, [])

  async function startScan() {
    if (mode === "new-database" && (!trimmedDatabaseName || databaseNameError)) return
    setSaving(true)
    setSaveError(null)
    try {
      const result = await completeSetup(mode === "new-database" ? trimmedDatabaseName : undefined)
      if (!result) return
      setCompletion(result)
      setStep(steps.findIndex((item) => item.id === "progress"))
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Panoptikon could not start the initial scan.")
    } finally {
      setSaving(false)
    }
  }

  async function completeSetup(newIndexDb?: string): Promise<components["schemas"]["DesktopSetupCompleteResponse"] | null> {
    const response = await fetch("/api/desktop/setup/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        included_folders: lines(includedFolders),
        excluded_folders: lines(excludedFolders),
        continuous_filescan_enabled: continuousScanEnabled,
        continuous_filescan_poll_interval_secs: continuousScanEnabled && continuousScanMode === "poller" ? Number(pollInterval) : null,
        continuous_filescan_included_folders: continuousScanEnabled ? lines(continuousFolders) : [],
        scan_images: fileTypes.images,
        scan_video: fileTypes.video,
        scan_audio: fileTypes.audio,
        scan_pdf: fileTypes.pdf,
        scan_html: fileTypes.html,
        cron_jobs: selectedModels.map((inferenceId) => {
          const settings = modelSettings[inferenceId]
          return {
            inference_id: inferenceId,
            batch_size: settings?.batchSize ?? null,
            threshold: settings?.threshold ?? null,
          }
        }),
        enable_cron_job: schedule.enabled,
        cron_schedule: effectiveCronSchedule(schedule),
        new_index_db: newIndexDb,
      }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { detail?: string } | null
      throw new Error(body?.detail || "Panoptikon could not save the folder configuration.")
    }
    return await response.json() as components["schemas"]["DesktopSetupCompleteResponse"]
  }

  async function validateFoldersAndContinue() {
    setSaving(true)
    setSaveError(null)
    try {
      const response = await fetch("/api/desktop/setup-folders/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          included_folders: lines(includedFolders),
          excluded_folders: lines(excludedFolders),
          new_database: mode === "new-database",
        }),
      })
      if (!response.ok) throw new Error("Panoptikon could not validate these folders.")
      const result = await response.json() as {
        included_folders: string[]
        excluded_folders: string[]
        errors: FolderValidationIssue[]
      }
      setIncludedFolders(result.included_folders.join("\n"))
      setExcludedFolders(result.excluded_folders.join("\n"))
      setFolderErrors(result.errors)
      if (result.errors.length === 0) setStep((value) => value + 1)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function validateContinuousScanAndContinue() {
    if (!continuousScanEnabled) {
      setContinuousFolderErrors([])
      setStep((value) => value + 1)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const response = await fetch("/api/desktop/setup-continuous/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          included_folders: lines(includedFolders),
          excluded_folders: lines(excludedFolders),
          continuous_folders: lines(continuousFolders),
          new_database: mode === "new-database",
        }),
      })
      if (!response.ok) throw new Error("Panoptikon could not validate the continuously watched folders.")
      const result = await response.json() as {
        included_folders: string[]
        errors: FolderValidationIssue[]
      }
      setContinuousFolders(result.included_folders.join("\n"))
      setContinuousFolderErrors(result.errors)
      if (result.errors.length === 0) setStep((value) => value + 1)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  function continueFromCurrentStep() {
    if (currentStep === "folders") {
      void validateFoldersAndContinue()
    } else if (currentStep === "continuous") {
      void validateContinuousScanAndContinue()
    } else {
      setStep((value) => value + 1)
    }
  }

  function lines(value: string): string[] {
    return value.split("\n").map((line) => line.trim()).filter(Boolean)
  }

  const pollingIntervalIsValid = continuousScanMode !== "poller"
    || (Number.isInteger(Number(pollInterval)) && Number(pollInterval) >= 1)
  const canContinue = currentStep === "database"
    ? databaseNameError === null
    : currentStep === "folders"
      ? lines(includedFolders).length > 0
      : currentStep === "file-types"
        ? Object.values(fileTypes).some(Boolean)
        : currentStep === "continuous"
          ? !continuousScanEnabled || pollingIntervalIsValid
          : currentStep === "configuration"
            ? externalInputsReady
            : currentStep !== "schedule" || scheduleValid
  const showDatabaseNameError = databaseName.length > 0
  const defaultDatabaseName = databases?.index.current ?? "default"
  const exampleDatabaseName = defaultDatabaseName.toLocaleLowerCase() === "photos" ? "family_photos" : "photos"

  return (
    <main className="mx-auto flex h-screen w-full flex-col overflow-hidden px-4 sm:px-6">
      <div className="shrink-0 py-4 sm:py-6" aria-label="Setup progress">
        <div className="flex w-full flex-nowrap justify-center gap-2 overflow-x-auto pb-1">
          {steps.map((item, index) => (
            <span
              key={item.id}
              className={`shrink-0 rounded-full border px-3 py-1 text-sm ${index === step ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              {index + 1}. {item.label}
            </span>
          ))}
        </div>
      </div>

      <ScrollArea key={currentStep} className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-3xl px-2 pb-6 sm:pb-8">
        {currentStep === "welcome" && mode === "onboarding" && (
          <section className="max-w-3xl space-y-4">
            <h1 className="text-3xl font-semibold">Welcome to Panoptikon</h1>
            <p>Panoptikon makes the files on your computer searchable and explorable, including with local AI-powered tags, text extraction, and semantic search.</p>
            <p>First, we’ll set up your default index database. A database determines which folders Panoptikon scans or excludes, which AI models it uses, and the other options used to build your searchable index.</p>
            <p>You can change these choices at any time from the Scan page. Later, you can also create any number of named databases with completely separate folders, settings, and indexed data—so everything you want to index does not need to live in this first database.</p>
            <p className="italic">This database is called <strong>{defaultDatabaseName}</strong>. Later, you could, for example, set up a separate <strong>{exampleDatabaseName}</strong> database that only indexes your family photos.</p>
          </section>
        )}

        {currentStep === "welcome" && mode === "new-database" && (
          <section className="max-w-3xl space-y-4">
            <h1 className="text-3xl font-semibold">New Index Database</h1>
            <p>Create a separate searchable index with its own folders, exclusions, AI models, settings, and indexed data.</p>
            <p>Databases are fully separate silos: their files and generated data do not mix, and an individual search only searches one database at a time. This is useful when collections should remain independent or need different scanning and model settings.</p>
            <p>Next, give the database a unique name. You’ll then choose what belongs in it before Panoptikon creates it.</p>
          </section>
        )}

        {currentStep === "database" && (
          <section className="max-w-2xl space-y-5">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold">Name this database</h1>
              <p className="text-muted-foreground">The name identifies this index when you switch databases in Search or on the Scan page.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="database-name">Database name</Label>
              <Input
                id="database-name"
                autoFocus
                minLength={3}
                maxLength={32}
                pattern="[a-zA-Z0-9_]+"
                value={databaseName}
                onChange={(event) => setDatabaseName(event.target.value)}
                placeholder="for example: family_photos"
                aria-invalid={showDatabaseNameError && databaseNameError !== null}
                aria-describedby="database-name-help database-name-error"
              />
              <p id="database-name-help" className="text-sm text-muted-foreground">3–32 characters; letters, numbers, and underscores only.</p>
              {showDatabaseNameError && databaseNameError && <p id="database-name-error" className="text-sm text-destructive" role="alert">{databaseNameError}</p>}
            </div>
            <div className="space-y-2">
              <h2 className="font-medium">Existing databases</h2>
              {existingNames.length > 0
                ? <div className="flex flex-wrap gap-2">{existingNames.map((name) => <span key={name} className="rounded-full border px-3 py-1 text-sm text-muted-foreground">{name}</span>)}</div>
                : <p className="text-sm text-muted-foreground">No named databases yet.</p>}
            </div>
            <p className="text-sm text-muted-foreground">
              To change the folders or settings of an existing database, open the{" "}
              <a className="font-medium text-primary underline underline-offset-4" href="/scan" target="_blank" rel="noreferrer">Scan page</a>.
            </p>
          </section>
        )}

        {currentStep === "folders" && (
          <WizardFolderSelector
            includedFolders={includedFolders}
            excludedFolders={excludedFolders}
            errors={folderErrors}
            onIncludedChange={(value) => { setIncludedFolders(value); setFolderErrors([]) }}
            onExcludedChange={(value) => { setExcludedFolders(value); setFolderErrors([]) }}
          />
        )}
        {currentStep === "file-types" && <WizardFileTypeSelection value={fileTypes} onChange={setFileTypes} />}
        {currentStep === "continuous" && (
          <WizardContinuousScan
            enabled={continuousScanEnabled}
            mode={continuousScanMode}
            pollInterval={pollInterval}
            watchedFolders={continuousFolders}
            includedFolders={lines(includedFolders)}
            foldersStepNumber={steps.findIndex((item) => item.id === "folders") + 1}
            errors={continuousFolderErrors}
            onEnabledChange={setContinuousScanEnabled}
            onModeChange={setContinuousScanMode}
            onPollIntervalChange={setPollInterval}
            onWatchedFoldersChange={(value) => { setContinuousFolders(value); setContinuousFolderErrors([]) }}
          />
        )}
        {currentStep === "models" && <WizardModelSelection selected={selectedModels} settings={modelSettings} onSelectedChange={setSelectedModels} onSettingsChange={setModelSettings} />}
        {currentStep === "configuration" && (
          <section className="space-y-5">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold">Additional configuration</h1>
              <p className="text-muted-foreground">The selected models need or can use installation-wide values. These settings are shared by every database on this Panoptikon Desktop installation.</p>
              <p className="text-sm text-muted-foreground">Save all required values to continue, or go back and deselect the models that require them.</p>
            </div>
            <ExternalInputEditor selectedModels={selectedModels} onReadyChange={setExternalInputsReady} />
          </section>
        )}
        {currentStep === "schedule" && <WizardScheduleSelection value={schedule} selectedModelCount={selectedModels.length} valid={scheduleValid} nextRun={scheduleNextRun} error={scheduleError} onChange={setSchedule} onPreviewChange={handleSchedulePreview} />}
        {currentStep === "review" && <WizardReview database={mode === "new-database" ? trimmedDatabaseName : defaultDatabaseName} includedFolders={lines(includedFolders)} excludedFolders={lines(excludedFolders)} fileTypes={fileTypes} continuousEnabled={continuousScanEnabled} continuousMode={continuousScanMode} pollInterval={pollInterval} continuousFolders={lines(continuousFolders)} selectedModels={selectedModels} modelSettings={modelSettings} schedule={schedule} scheduleNextRun={scheduleNextRun} />}
        {currentStep === "progress" && completion && <WizardProgress completion={completion} />}
        </div>
      </ScrollArea>

      {currentStep !== "progress" && <div className="shrink-0 border-t bg-background py-4 sm:py-5">
        {saveError && <p className="mb-3 text-sm text-destructive" role="alert">{saveError}</p>}
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" disabled={step === 0 || saving} onClick={() => setStep((value) => value - 1)}>Back</Button>
          <div className="flex flex-wrap justify-end gap-2">
            {currentStep !== "review"
              ? <Button disabled={!canContinue || saving} onClick={continueFromCurrentStep}>Continue</Button>
              : <Button disabled={saving || (mode === "new-database" && Boolean(databaseNameError))} onClick={startScan}>{saving ? "Starting…" : "Start scan"}</Button>}
          </div>
        </div>
      </div>}
    </main>
  )
}
