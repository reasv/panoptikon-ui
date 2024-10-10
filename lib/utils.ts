import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getFileURL(
  sha256: string,
  dbs: { index_db: string | null; user_data_db: string | null }
) {
  return `${sha256}?index_db=${dbs.index_db || ""}&user_data_db=${
    dbs.user_data_db || ""
  }`
}
export function getFullFileURL(
  sha256: string,
  dbs: { index_db: string | null; user_data_db: string | null }
) {
  return `http://127.0.0.1:6342/api/items/file/${getFileURL(sha256, dbs)}`
}
export function getThumbnailURL(
  sha256: string,
  dbs: { index_db: string | null; user_data_db: string | null }
) {
  return `http://127.0.0.1:6342/api/items/thumbnail/${getFileURL(sha256, dbs)}`
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
