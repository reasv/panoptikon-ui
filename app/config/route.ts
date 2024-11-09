// app/config/route.ts
import { envVariableIsTrue } from "@/lib/utils"
import { NextResponse } from "next/server"
export interface ClientConfig {
  disableBackendOpen: boolean
  restrictedMode: boolean
}
export async function GET() {
  const config: ClientConfig = {
    disableBackendOpen:
      envVariableIsTrue(process.env.DISABLE_BACKEND_OPEN_BTN) ||
      envVariableIsTrue(process.env.RESTRICTED_MODE),
    restrictedMode: envVariableIsTrue(process.env.RESTRICTED_MODE),
  }
  return NextResponse.json(config)
}
