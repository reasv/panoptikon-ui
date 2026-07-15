"use server"

import { redirect } from "next/navigation"
import { getServerClientConfig } from "@/lib/serverApi"
import { ExternalInputEditor } from "@/components/external-inputs"

export default async function DesktopConfigurationPage() {
  const config = await getServerClientConfig()
  if (!config?.desktopManaged) redirect("/")
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl space-y-6 p-6 sm:p-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold">Additional configuration</h1>
        <p className="text-muted-foreground">Manage installation-wide values used by inference models. They apply to every database and are read whenever Panoptikon starts a new model worker.</p>
        <a href="/scan" className="text-sm font-medium text-primary underline underline-offset-4">Return to Scan</a>
      </div>
      <ExternalInputEditor />
    </main>
  )
}
