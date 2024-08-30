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
  return `/api/items/file/${getFileURL(sha256, dbs)}`
}
export function getThumbnailURL(
  sha256: string,
  dbs: { index_db: string | null; user_data_db: string | null }
) {
  return `/api/items/thumbnail/${getFileURL(sha256, dbs)}`
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
