"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { $api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FolderValidationIssue, WizardFolderSelector } from "./folder-selector"
import { ContinuousScanMode, WizardContinuousScan } from "./continuous-scan"

export type DesktopSetupMode = "onboarding" | "new-database"

type StepId = "welcome" | "database" | "folders" | "continuous" | "models" | "finish"

const onboardingSteps: { id: StepId; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "folders", label: "Folders" },
  { id: "continuous", label: "Continuous scan" },
  { id: "models", label: "Models" },
  { id: "finish", label: "Finish" },
]

const newDatabaseSteps: { id: StepId; label: string }[] = [
  { id: "welcome", label: "New database" },
  { id: "database", label: "Name" },
  { id: "folders", label: "Folders" },
  { id: "continuous", label: "Continuous scan" },
  { id: "models", label: "Models" },
  { id: "finish", label: "Finish" },
]

export function DesktopSetupWizard({ mode }: { mode: DesktopSetupMode }) {
  const [step, setStep] = useState(0)
  const [databaseName, setDatabaseName] = useState("")
  const [includedFolders, setIncludedFolders] = useState("")
  const [excludedFolders, setExcludedFolders] = useState("")
  const [folderErrors, setFolderErrors] = useState<FolderValidationIssue[]>([])
  const [continuousScanEnabled, setContinuousScanEnabled] = useState(false)
  const [continuousScanMode, setContinuousScanMode] = useState<ContinuousScanMode>("watcher")
  const [pollInterval, setPollInterval] = useState("60")
  const [continuousFolders, setContinuousFolders] = useState("")
  const [continuousFolderErrors, setContinuousFolderErrors] = useState<FolderValidationIssue[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const router = useRouter()
  const { data: databases } = $api.useQuery("get", "/api/db")
  const steps = mode === "onboarding" ? onboardingSteps : newDatabaseSteps
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

  async function finishOnboarding() {
    setSaving(true)
    setSaveError(null)
    try {
      const completion = await completeSetup()
      if (!completion) return
      const deadline = Date.now() + 180_000
      while (Date.now() < deadline) {
        const response = await fetch("/api/desktop/setup-status", { cache: "no-store" })
        if (!response.ok) throw new Error("Desktop could not determine whether the database is ready.")
        const status = await response.json() as { ready: boolean }
        if (status.ready) {
          router.push("/search")
          return
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500))
      }
      throw new Error("The initial file scan has not started yet. Check the folder settings and job queue, then try again.")
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function finishNewDatabase() {
    if (!trimmedDatabaseName || databaseNameError) return
    setSaving(true)
    setSaveError(null)
    try {
      const completion = await completeSetup(trimmedDatabaseName)
      if (completion) router.push(`/search?index_db=${encodeURIComponent(completion.index_db)}`)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Panoptikon could not create the database.")
    } finally {
      setSaving(false)
    }
  }

  async function completeSetup(newIndexDb?: string): Promise<{ index_db: string } | null> {
    const response = await fetch("/api/desktop/setup/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        included_folders: lines(includedFolders),
        excluded_folders: lines(excludedFolders),
        continuous_filescan_enabled: continuousScanEnabled,
        continuous_filescan_poll_interval_secs: continuousScanEnabled && continuousScanMode === "poller" ? Number(pollInterval) : null,
        continuous_filescan_included_folders: continuousScanEnabled ? lines(continuousFolders) : [],
        new_index_db: newIndexDb,
      }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { detail?: string } | null
      throw new Error(body?.detail || "Panoptikon could not save the folder configuration.")
    }
    return await response.json() as { index_db: string }
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
      : currentStep !== "continuous" || !continuousScanEnabled || pollingIntervalIsValid
  const showDatabaseNameError = databaseName.length > 0
  const defaultDatabaseName = databases?.index.current ?? "default"
  const exampleDatabaseName = defaultDatabaseName.toLocaleLowerCase() === "photos" ? "family_photos" : "photos"

  return (
    <main className="mx-auto flex h-screen max-w-4xl flex-col overflow-hidden px-4 sm:px-6">
      <div className="shrink-0 py-4 sm:py-6" aria-label="Setup progress">
        <div className="flex flex-wrap gap-2">
          {steps.map((item, index) => (
            <span
              key={item.id}
              className={`rounded-full border px-3 py-1 text-sm ${index === step ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              {index + 1}. {item.label}
            </span>
          ))}
        </div>
      </div>

      <ScrollArea key={currentStep} className="min-h-0 flex-1">
        <div className="pr-4">
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
        {currentStep === "models" && <section className="space-y-4"><h1 className="text-2xl font-semibold">Models and extraction</h1><p>Scanning makes files searchable by path and metadata. Extraction models add tags, text, and semantic search. The first model load can download large files and may take time.</p><p>You do not need to wait for extraction to finish. Model selection, job progress, and accelerator settings remain available on the Scan page.</p><Button variant="outline" onClick={() => router.push("/scan")}>Open full model and job settings</Button></section>}
        {currentStep === "finish" && mode === "onboarding" && <section className="space-y-4"><h1 className="text-2xl font-semibold">Finish setup</h1><p>Once the initial scan has started, your first database is ready to use. You can change its folders, models, and other indexing options from the Scan page at any time.</p></section>}
        {currentStep === "finish" && mode === "new-database" && <section className="space-y-4"><h1 className="text-2xl font-semibold">Create {trimmedDatabaseName}</h1><p>Panoptikon will create this separate index database when you finish.</p></section>}
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t bg-background py-4 sm:py-5">
        {saveError && <p className="mb-3 text-sm text-destructive" role="alert">{saveError}</p>}
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" disabled={step === 0 || saving} onClick={() => setStep((value) => value - 1)}>Back</Button>
          <div className="flex flex-wrap justify-end gap-2">
            {step < steps.length - 1
              ? <Button disabled={!canContinue || saving} onClick={continueFromCurrentStep}>Continue</Button>
              : mode === "onboarding"
                ? <Button disabled={saving} onClick={finishOnboarding}>Finish and open Search</Button>
                : <Button disabled={saving || Boolean(databaseNameError)} onClick={finishNewDatabase}>Create database and open Search</Button>}
          </div>
        </div>
      </div>
    </main>
  )
}
