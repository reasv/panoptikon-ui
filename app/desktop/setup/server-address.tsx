"use client"

import { useEffect, useState } from "react"
import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/// The Search UI's address, with a copy button.
///
/// The setup wizard runs inside the Desktop window, so every way out of it is
/// a button that asks the operating system to open a browser. When that fails
/// - it did on Linux for every Desktop release up to 0.1.6 - the wizard was a
/// dead end: nothing on screen told the user that Panoptikon is a web app they
/// can simply visit. This is that fallback, and it is shown unconditionally
/// rather than only after a failed open, because the user needs to know the
/// address exists before they are stuck.
///
/// The address always names a page worth landing on. Desktop users have no use
/// for the site root, so it points at Search - and at the database the wizard
/// just set up, matching the button beside it.
export function ServerAddress({ indexDb, className }: { indexDb?: string; className?: string }) {
  const [address, setAddress] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Read on the client: there is no request origin during prerender, and
  // guessing one would risk printing an address that does not work.
  useEffect(() => {
    const url = new URL("/search", window.location.origin)
    if (indexDb) url.searchParams.set("index_db", indexDb)
    setAddress(url.toString())
  }, [indexDb])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (!address) return null

  async function copy() {
    try {
      await navigator.clipboard.writeText(address!)
      setCopied(true)
    } catch {
      // No clipboard API on an insecure origin (Desktop reaches the wizard
      // over plain http); the legacy path still works there.
      const field = document.createElement("textarea")
      field.value = address!
      document.body.appendChild(field)
      field.select()
      const ok = document.execCommand("copy")
      field.remove()
      setCopied(ok)
    }
  }

  return (
    <div className={cn("mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg border px-4 py-2", className)}>
      <span className="text-sm text-muted-foreground">The Search UI is reachable at:</span>
      <code className="rounded bg-muted px-2 py-1 text-sm font-medium">{address}</code>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        onClick={() => void copy()}
        aria-label={copied ? "Address copied" : "Copy address"}
      >
        {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
      </Button>
      <span aria-live="polite" className="sr-only">{copied ? "Address copied to the clipboard" : ""}</span>
    </div>
  )
}
