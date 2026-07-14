"use client"

import { useEffect, useState } from "react"
import { FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

export type FolderValidationIssue = {
  path: string
  error: string
}

declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
      }
    }
  }
}

function appendPaths(current: string, paths: string[]): string {
  const existing = current
    .split("\n")
    .map((path) => path.trim())
    .filter(Boolean)
  const additions = paths.filter((path) => !existing.includes(path))
  return [...existing, ...additions].join("\n")
}

export function WizardPathListEditor({
  value,
  onChange,
  disabled = false,
  className = "min-h-48",
}: {
  value: string
  onChange(value: string): void
  disabled?: boolean
  className?: string
}) {
  const [nativePickerAvailable, setNativePickerAvailable] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)

  useEffect(() => {
    setNativePickerAvailable(Boolean(window.__TAURI__?.core?.invoke))
  }, [])

  async function chooseFolders() {
    const invoke = window.__TAURI__?.core?.invoke
    if (!invoke) return
    setPicking(true)
    setPickerError(null)
    try {
      const paths = await invoke<string[]>("choose_scan_folders")
      if (paths.length > 0) onChange(appendPaths(value, paths))
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : String(error))
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="space-y-3">
      <Textarea
        className={`${className} font-mono text-sm`}
        placeholder="One directory per line"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {nativePickerAvailable && (
        <Button type="button" variant="outline" disabled={disabled || picking} onClick={chooseFolders}>
          <FolderOpen className="mr-2 h-4 w-4" />
          Choose folders…
        </Button>
      )}
      {pickerError && <p className="text-sm text-destructive" role="alert">The folder picker could not open: {pickerError}</p>}
    </div>
  )
}

export function WizardFolderSelector({
  includedFolders,
  excludedFolders,
  errors,
  onIncludedChange,
  onExcludedChange,
}: {
  includedFolders: string
  excludedFolders: string
  errors: FolderValidationIssue[]
  onIncludedChange(value: string): void
  onExcludedChange(value: string): void
}) {
  return (
    <section className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Choose folders to index</h1>
        <p className="text-muted-foreground">
          Add at least one included directory to continue. Panoptikon scans included directories and ignores everything beneath excluded directories. Excluded directories must be inside an included directory.
        </p>
      </div>

      <Tabs defaultValue="included" className="rounded-lg border p-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="included">Included folders</TabsTrigger>
          <TabsTrigger value="excluded">Excluded folders</TabsTrigger>
        </TabsList>

        <TabsContent value="included" className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Panoptikon scans these directories and their subdirectories for supported files.
          </p>
          <WizardPathListEditor
            value={includedFolders}
            onChange={onIncludedChange}
          />
        </TabsContent>

        <TabsContent value="excluded" className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Everything beneath these directories is excluded. Exclusions are absolute: a more specific included directory does not override an excluded parent.
          </p>
          <WizardPathListEditor
            value={excludedFolders}
            onChange={onExcludedChange}
          />
        </TabsContent>
      </Tabs>

      {errors.length > 0 && (
        <section className="space-y-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4" role="alert">
          <div>
            <h2 className="font-semibold text-destructive">Some folders could not be used</h2>
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
