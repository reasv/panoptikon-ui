import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { components, paths } from "./panoptikon"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
export function getFileURL(
  dbs: { index_db: string | null; user_data_db: string | null },
  file_type: "file" | "thumbnail",
  // Path-derived (not operations[...]): path strings are stable across
  // spec generators, operationIds are not.
  id_type: paths["/api/items/item"]["get"]["parameters"]["query"]["id_type"],
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

const MINUTE_MS = 60_000
// Past this age, relative times ("38d ago") read worse than a plain date.
const RELATIVE_CUTOFF_MS = 7 * 24 * 60 * MINUTE_MS

function relativeShort(date: Date, now: Date): string | null {
  const diff = now.getTime() - date.getTime()
  if (diff < 0 || diff >= RELATIVE_CUTOFF_MS) return null
  const minutes = Math.floor(diff / MINUTE_MS)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// Compact date for card/row footers: relative while recent, then a short
// absolute date. Pair with dateTitle() on hover for the full timestamp.
export function compactDate(date: Date, now: Date = new Date()): string {
  return (
    relativeShort(date, now) ??
    date.toLocaleDateString("en", {
      month: "short",
      day: "numeric",
      ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
    })
  )
}

// Hover text pairing the full timestamp with a relative age, so whichever
// form a compactDate() displays, the other is one hover away.
export function dateTitle(date: Date, now: Date = new Date()): string {
  const diff = date.getTime() - now.getTime()
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 24 * 3600e3],
    ["month", 30 * 24 * 3600e3],
    ["week", 7 * 24 * 3600e3],
    ["day", 24 * 3600e3],
    ["hour", 3600e3],
    ["minute", 60e3],
  ]
  const [unit, ms] = units.find(([, ms]) => Math.abs(diff) >= ms) ?? [
    "second",
    1e3,
  ]
  // trunc, not round: "2h55m ago" must read "2 hours ago" to agree with
  // the floored short form compactDate shows next to it
  return `${getLocale(date)} (${rtf.format(Math.trunc(diff / ms), unit)})`
}
