// app/config/route.ts
import { NextResponse } from "next/server"
export interface ClientConfig {
  disableBackendOpen: boolean
  restrictedMode: boolean
}
export async function GET() {
  const config: ClientConfig = {
    disableBackendOpen:
      process.env.DISABLE_BACKEND_OPEN?.toLowerCase() === "true" ||
      process.env.DISABLE_BACKEND_OPEN === "1",
    restrictedMode:
      process.env.RESTRICTED_MODE?.toLowerCase() === "true" ||
      process.env.RESTRICTED_MODE === "1",
  }
  return NextResponse.json(config)
}
