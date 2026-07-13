"use server"

import { redirect } from "next/navigation"
import { getServerClientConfig } from "@/lib/serverApi"
import { DesktopSetupWizard } from "./wizard"

export default async function DesktopSetupPage() {
  const config = await getServerClientConfig()
  if (!config?.desktopManaged) redirect("/")
  return <DesktopSetupWizard />
}
