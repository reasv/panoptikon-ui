"use client"

import * as React from "react"

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { useToast } from "@/components/ui/use-toast"
import { cn } from "@/lib/utils"

/**
 * The copy affordance for a toast's `copyText`. Inline feedback rather than a
 * confirmation toast: this button lives IN a toast, and answering it with
 * another one would race the two-toast limit against the very message being
 * copied.
 *
 * The fallback path mirrors `useCopyPath`: insecure origins (plain-http on a
 * LAN) have no clipboard API, but the legacy execCommand path still works.
 */
function CopyDetails({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false)
  const flash = () => {
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  const copy = () => {
    try {
      navigator.clipboard.writeText(text).then(flash, () => {})
    } catch {
      const ta = document.createElement("textarea")
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand("copy")
      ta.remove()
      if (ok) flash()
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="justify-self-start rounded-md border px-2 py-1 text-xs font-medium transition-colors hover:bg-secondary focus:outline-hidden focus:ring-2 focus:ring-ring"
    >
      {copied ? "Copied" : "Copy details"}
    </button>
  )
}

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, copyText, ...props }) {
        return (
          <Toast key={id} {...props}>
            {/* min-w-0: without it the grid tracks size to the widest child,
                and one unbroken token (a base64 file name in an ffmpeg error)
                pushes the text past the toast's clipped edge. */}
            <div className="grid min-w-0 flex-1 gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                // Wrapping itself lives on the primitive, so every toast gets
                // it; only the copyable-detail affordances are added here.
                <ToastDescription
                  className={cn(
                    copyText &&
                      "max-h-40 select-text overflow-y-auto whitespace-pre-wrap"
                  )}
                >
                  {description}
                </ToastDescription>
              )}
              {copyText && <CopyDetails text={copyText} />}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
