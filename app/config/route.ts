// app/config/route.ts
import { envVariableIntegerParse, envVariableIsTrue } from "@/lib/utils"
import { NextResponse } from "next/server"
export interface ClientConfig {
  disableBackendOpen: boolean
  restrictedMode: boolean
  searchThrottleMs: number
}
export async function GET() {
  const config: ClientConfig = {
    disableBackendOpen:
      envVariableIsTrue(process.env.DISABLE_BACKEND_OPEN_BTN) ||
      envVariableIsTrue(process.env.RESTRICTED_MODE),
    restrictedMode: envVariableIsTrue(process.env.RESTRICTED_MODE),
    searchThrottleMs: envVariableIntegerParse(
      process.env.SEARCH_THROTTLE_MS,
      500
    ),
  }
  return NextResponse.json(config)
}
