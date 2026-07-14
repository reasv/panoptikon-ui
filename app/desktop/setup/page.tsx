"use server"

import { redirect } from "next/navigation"
import { getServerClientConfig } from "@/lib/serverApi"
import { DesktopSetupWizard } from "./wizard"

export default async function DesktopSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>
}) {
  const config = await getServerClientConfig()
  if (!config?.desktopManaged) redirect("/")
  const requestedMode = (await searchParams).mode
  const mode = requestedMode === "new-database" ? "new-database" : "onboarding"
  return <DesktopSetupWizard mode={mode} />
}
