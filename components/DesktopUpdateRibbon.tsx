"use client"

import { useQuery } from "@tanstack/react-query"
import { X } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useClientConfig } from "@/lib/useClientConfig"

type DesktopUpdateStatus = {
  available: boolean
  target_version: string | null
  ribbon_visible: boolean
  sysmem_fallback_notice?: { visible: boolean, worker_python: string | null }
}

class DesktopUpdateRequestError extends Error {
  constructor(readonly status: number) {
    super("Panoptikon Desktop did not accept the update action")
  }
}

async function updateRequest(path: string, init?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...init })
  if (!response.ok) throw new DesktopUpdateRequestError(response.status)
  return response
}

export function DesktopUpdateRibbon({ onVisibilityChange }: { onVisibilityChange?: (visible: boolean) => void }) {
  const clientConfig = useClientConfig()
  const enabled = clientConfig.data?.desktopShellAvailable === true
  const [error, setError] = useState<string | null>(null)
  const status = useQuery({
    queryKey: ["desktopUpdateStatus"],
    enabled,
    queryFn: async () => (await updateRequest("/api/desktop/update-status")).json() as Promise<DesktopUpdateStatus>,
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })

  const act = async (path: string, body?: unknown) => {
    setError(null)
    try {
      await updateRequest(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch (reason) {
      setError(reason instanceof DesktopUpdateRequestError && reason.status === 409
        ? "The available version changed. Review it and try again."
        : reason instanceof Error ? reason.message : "The Desktop update action failed")
    } finally {
      // A stale target returns 409. Refresh even after rejection so this tab
      // immediately shows the replacement release instead of retrying stale
      // state until the normal polling interval elapses.
      await status.refetch()
    }
  }

  const update = status.data
  const updateVisible = Boolean(enabled && update?.available && update.ribbon_visible && update.target_version)
  // One ribbon at a time, so the page offsets stay one ribbon high.
  const notice = enabled && !updateVisible ? update?.sysmem_fallback_notice : undefined
  const visible = updateVisible || Boolean(notice?.visible)
  useEffect(() => onVisibilityChange?.(visible), [onVisibilityChange, visible])
  if (notice?.visible) {
    return <SysmemFallbackRibbon workerPython={notice.worker_python} onChanged={() => status.refetch()} />
  }
  if (!updateVisible || !update?.target_version) return null

  return (
    <aside className="relative z-40 flex min-h-12 shrink-0 items-center justify-center gap-3 border-b border-orange-900/70 bg-orange-950/90 px-4 py-2 text-sm text-orange-50 shadow-md" aria-label="Desktop update available">
      <p className="text-center">
        <span className="font-semibold">Panoptikon Desktop {update.target_version} is available.</span>
        {error && <span className="ml-2 text-red-300" role="alert">{error}</span>}
      </p>
      <Button size="sm" className="h-8 bg-orange-600 text-white hover:bg-orange-500" onClick={() => act("/api/desktop/update-window/open")}>View update</Button>
      <button className="text-xs text-orange-200 underline underline-offset-4 hover:text-white" onClick={() => act("/api/desktop/update-ribbon/dismiss", { version: update.target_version })}>Don&apos;t show again for this version</button>
      <button className="rounded p-1 text-orange-200 hover:bg-orange-900 hover:text-white" aria-label="Hide until tomorrow" title="Hide until tomorrow" onClick={() => act("/api/desktop/update-ribbon/snooze", { version: update.target_version })}>
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </aside>
  )
}

function SysmemFallbackRibbon({ workerPython, onChanged }:
  { workerPython: string | null, onChanged: () => Promise<unknown> }) {
  const [error, setError] = useState<string | null>(null)
  const dismiss = async () => {
    setError(null)
    try {
      await updateRequest("/api/desktop/sysmem-fallback-notice/dismiss", { method: "POST" })
    } catch {
      setError("Could not save this choice. Try again.")
    } finally {
      await onChanged()
    }
  }
  const summary = "With the default NVIDIA driver settings, inference on this GPU can become several times slower."
  // One line, so the page offsets for a one-line ribbon hold; the dialog has the full text.
  return (
    <aside className="relative z-40 flex min-h-12 shrink-0 items-center justify-center gap-3 border-b border-orange-900/70 bg-orange-950/90 px-4 py-2 text-sm text-orange-50 shadow-md" aria-label="NVIDIA driver setting">
      <p className="min-w-0 truncate" title={error ?? summary}>
        {error
          ? <span className="text-red-300" role="alert">{error}</span>
          : <span className="font-semibold">{summary}</span>}
      </p>
      <Dialog>
        <DialogTrigger asChild>
          <Button size="sm" className="h-8 shrink-0 bg-orange-600 text-white hover:bg-orange-500">How to fix</Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>NVIDIA sysmem fallback</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              Panoptikon finds the largest batch your GPU can process by trying larger ones, so a batch can
              briefly need slightly more GPU memory than is free. With the default setting of NVIDIA drivers
              536.40 and later, the driver then silently uses system RAM instead of reporting that the GPU is out
              of memory. Nothing fails, but inference runs several times slower.
            </p>
            <p>
              To make it fail cleanly instead, so that Panoptikon learns the limit, open NVIDIA Control Panel,
              go to Manage 3D Settings, set <b>CUDA - Sysmem Fallback Policy</b> to <b>Prefer No Sysmem
              Fallback</b>, apply, and restart Panoptikon:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li><b>Global Settings</b> applies it to every CUDA program on this computer.</li>
              <li>
                <b>Program Settings</b> applies it to the program you add. Add the Python interpreter that
                runs Panoptikon&apos;s inference workers: {workerPython
                  ? <code className="break-all">{workerPython}</code>
                  : <>python.exe in the folder named on the <code>home</code> line of <code>runtime\venv\pyvenv.cfg</code> in the data folder</>}.
                The python.exe in Panoptikon&apos;s own folder only starts that one.
              </li>
            </ul>
            <p>
              The setting reduces these slowdowns but cannot prevent all of them, because Windows can still move
              GPU memory to system RAM. Panoptikon also takes its own steps to avoid this and to back off when it
              happens.
            </p>
          </div>
        </DialogContent>
      </Dialog>
      <button className="shrink-0 text-xs text-orange-200 underline underline-offset-4 hover:text-white" onClick={dismiss}>Don&apos;t show again</button>
    </aside>
  )
}
