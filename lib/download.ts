// Saving a generated blob to the user's disk.
//
// The app had no download path at all before the mosaic export: everything
// it shows comes from a URL the browser can save by itself. A composited
// canvas has no URL, so it gets the standard object-URL + synthetic click
// dance — and the revoke, without which every export leaks its blob for
// the life of the document.

/** Triggers a browser download of `blob` under `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.rel = "noopener"
  // Firefox only fires the click of a link that is in the document.
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking synchronously can cancel the download in some browsers; one
  // turn later the navigation has been queued.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// Path separators and the characters Windows reserves.
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|]/g

/**
 * A user-supplied name reduced to something every filesystem accepts:
 * the characters above go, whitespace collapses, and the result is
 * length-capped. Empty (an unnamed board, or one named entirely in
 * stripped characters) returns "", so callers fall back to a generic stem.
 */
export function sanitizeFilePart(name: string, maxLength = 64): string {
  return (
    name
      .replace(UNSAFE_FILENAME_CHARS, " ")
      .replace(/\s+/g, " ")
      .slice(0, maxLength)
      // Windows silently drops trailing dots and spaces
      .replace(/^[. ]+|[. ]+$/g, "")
  )
}

/** Local timestamp as `yyyyMMdd-HHmmss`, for unique download names. */
export function timestampStamp(date = new Date()): string {
  const p = (n: number, len = 2) => String(n).padStart(len, "0")
  return (
    `${p(date.getFullYear(), 4)}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  )
}
