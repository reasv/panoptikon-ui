"use client"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export type WizardFileTypes = {
  images: boolean
  video: boolean
  audio: boolean
  pdf: boolean
  html: boolean
}

const choices: { key: keyof WizardFileTypes; label: string; extensions: string; description: string }[] = [
  { key: "images", label: "Images", extensions: "JPG, PNG, GIF, WebP, BMP, TIFF", description: "Index image metadata and generate searchable thumbnails." },
  { key: "video", label: "Video", extensions: "MP4, MKV, MOV, AVI, WebM, WMV, FLV", description: "Index video metadata and representative frames." },
  { key: "audio", label: "Audio", extensions: "MP3, WAV, FLAC, AAC, OGG, WMA, M4A", description: "Index audio metadata and embedded cover art." },
  { key: "pdf", label: "PDF documents", extensions: "PDF", description: "Index PDF files and render a first-page preview when PDF support is available." },
  { key: "html", label: "HTML documents", extensions: "HTML, HTM", description: "Index saved web pages and render previews when a compatible browser is available." },
]

export function WizardFileTypeSelection({ value, onChange }: { value: WizardFileTypes; onChange(value: WizardFileTypes): void }) {
  return (
    <section className="max-w-3xl space-y-5">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Choose file types</h1>
        <p className="text-muted-foreground">Choose which supported file types Panoptikon should index inside the folders selected in the previous step.</p>
        <p className="text-sm text-muted-foreground">Files with other extensions are ignored. You can change this later from the Scan page; enabling a type later will add matching files during the next full scan.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {choices.map((choice) => (
          <div key={choice.key} className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor={`scan-${choice.key}`} className="text-base font-medium">{choice.label}</Label>
              <p className="text-sm text-muted-foreground">{choice.description}</p>
              <p className="text-xs text-muted-foreground">{choice.extensions}</p>
            </div>
            <Switch
              id={`scan-${choice.key}`}
              checked={value[choice.key]}
              onCheckedChange={(checked) => onChange({ ...value, [choice.key]: checked })}
            />
          </div>
        ))}
      </div>

      {!Object.values(value).some(Boolean) && <p className="text-sm text-destructive" role="alert">Select at least one file type to continue.</p>}
    </section>
  )
}
