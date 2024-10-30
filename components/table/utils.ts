export function prettyPrintDate(isoDateString: string): string {
  const date = new Date(isoDateString)
  if (isNaN(date.getTime())) {
    return "Invalid date"
  }
  const options: Intl.DateTimeFormatOptions = {
    year: "2-digit",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }
  return new Intl.DateTimeFormat("en-GB", options).format(date)
}

export function prettyPrintDurationBetweenDates(
  isoDateStart: string,
  isoDateEnd: string
): string {
  const startDate = new Date(isoDateStart)
  const endDate = new Date(isoDateEnd)
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return "Invalid date(s)"
  }
  const diffInSeconds = Math.abs(
    (endDate.getTime() - startDate.getTime()) / 1000
  )
  return prettyPrintDuration(diffInSeconds)
}

export function prettyPrintDuration(seconds: number): string {
  if (seconds < 0) return "Invalid duration"
  if (seconds === 0) return "0s"
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  let result = ""
  if (hours > 0) {
    result += `${hours}h`
    if (minutes > 0) {
      result += ` ${minutes}m`
    }
  } else {
    if (minutes > 0) {
      result += `${minutes}m`
    }
    if (hours === 0 && secs > 0) {
      result += `${secs.toFixed(minutes === 0 ? 1 : 0)}s`
    }
  }
  return result.trim()
}

export function estimateEta(
  scanStartTime: string,
  itemsProcessed: number,
  remainingItems: number
): string {
  const timeElapsed = Date.now() - new Date(scanStartTime).getTime()
  const timeElapsedInSeconds = timeElapsed / 1000
  const itemsPerSecond = itemsProcessed / (timeElapsedInSeconds || 1)
  const remainingTime = remainingItems / (itemsPerSecond || 1)

  return prettyPrintDuration(remainingTime)
}
