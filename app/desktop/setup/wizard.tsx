"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { CreateNewDB } from "@/components/scan/CreateDB"
import { FolderLists } from "@/components/scan/FolderLists"
import { SwitchDB } from "@/components/sidebar/options/switchDB"

const steps = ["Welcome", "Database", "Folders", "Models", "Finish"]

export function DesktopSetupWizard() {
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  async function finish(state: "complete" | "skipped") {
    setSaving(true)
    try {
      const response = await fetch("/api/desktop/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      })
      if (!response.ok) throw new Error("Desktop could not record onboarding completion")
      router.push("/search")
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl p-6">
      <div className="mb-8 flex flex-wrap gap-2" aria-label="Setup progress">
        {steps.map((label, index) => <span key={label} className={`rounded-full border px-3 py-1 text-sm ${index === step ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{index + 1}. {label}</span>)}
      </div>
      {step === 0 && <section className="space-y-4"><h1 className="text-3xl font-semibold">Welcome to Panoptikon Desktop</h1><p>Desktop keeps Panoptikon running in the tray, while search opens in your normal browser. Databases, thumbnails, models, and configuration live in your platform application-data folder—not beside the installer.</p><p>You can change every choice later from the Scan page or Desktop Settings.</p></section>}
      {step === 1 && <section><h1 className="text-2xl font-semibold">Choose your databases</h1><p className="text-muted-foreground">The default databases are ready to use, or create a separate index for this collection.</p><SwitchDB /><CreateNewDB /></section>}
      {step === 2 && <section><h1 className="text-2xl font-semibold">Choose folders to index</h1><p className="text-muted-foreground">Add at least one folder and save it to enqueue the initial scan, or continue and configure folders later.</p><FolderLists /></section>}
      {step === 3 && <section className="space-y-4"><h1 className="text-2xl font-semibold">Models and extraction</h1><p>Scanning makes files searchable by path and metadata. Extraction models add tags, text, and semantic search. The first model load can download large files and may take time.</p><p>You do not need to wait for extraction to finish. Model selection, job progress, and accelerator settings remain available on the Scan page.</p><Button variant="outline" onClick={() => router.push("/scan")}>Open full model and job settings</Button></section>}
      {step === 4 && <section className="space-y-4"><h1 className="text-2xl font-semibold">Panoptikon is ready</h1><p>Your local Server will continue running when this window closes. Use the tray icon to open search, restart the Server, view diagnostics, or quit.</p><Button disabled={saving} onClick={() => finish("complete")}>Finish and open Search</Button></section>}
      <div className="mt-10 flex justify-between border-t pt-5"><Button variant="ghost" disabled={step === 0 || saving} onClick={() => setStep((value) => value - 1)}>Back</Button><div className="flex gap-2"><Button variant="ghost" disabled={saving} onClick={() => finish("skipped")}>Skip setup</Button>{step < steps.length - 1 && <Button onClick={() => setStep((value) => value + 1)}>Continue</Button>}</div></div>
    </main>
  )
}
