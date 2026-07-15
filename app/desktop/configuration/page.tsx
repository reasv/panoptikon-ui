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
        <h1 className="text-3xl font-semibold">Model credentials and services</h1>
        <p className="text-muted-foreground">Manage installation-wide values declared by inference models, such as API keys. They apply to every database and are read whenever Panoptikon starts a worker. Network, memory, and Server settings live in the Panoptikon Desktop control window so they remain available if the Server cannot start.</p>
        <a href="/scan" className="text-sm font-medium text-primary underline underline-offset-4">Return to Scan</a>
      </div>
      <ExternalInputEditor />
    </main>
  )
}
