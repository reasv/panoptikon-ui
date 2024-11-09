import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { components, operations } from "./panoptikon"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
export function getFileURL(
  dbs: { index_db: string | null; user_data_db: string | null },
  file_type: "file" | "thumbnail",
  id_type: operations["get_item_meta_api_items_item_get"]["parameters"]["query"]["id_type"],
  id: string | number
) {
  const index_db_param = dbs.index_db ? `&index_db=${dbs.index_db}` : ""
  return `/api/items/item/${file_type}?id=${id}&id_type=${id_type}${index_db_param}`
}

export function prettyPrintBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  let unitIndex = 0

  while (bytes >= 1024 && unitIndex < units.length - 1) {
    bytes /= 1024
    unitIndex++
  }

  return `${bytes.toFixed(2)} ${units[unitIndex]}`
}

export function prettyPrintVideoDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)

  const hoursStr = hours > 0 ? String(hours).padStart(2, "0") + ":" : ""
  const minutesStr = String(minutes).padStart(2, "0")
  const secondsStr = String(remainingSeconds).padStart(2, "0")

  return hoursStr + minutesStr + ":" + secondsStr
}

export function getLocale(date: Date) {
  return date.toLocaleString("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function envVariableIsTrue(envVariable: string | undefined): boolean {
  return envVariable?.toLowerCase() === "true" || envVariable === "1"
}
