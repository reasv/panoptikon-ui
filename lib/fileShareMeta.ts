// Pure helpers behind the adaptive share button (hooks/fileShare.ts) and the
// Relay share client (lib/relayClient.ts).
//
// Deliberately free of React, of the `@/` alias and of every browser-only
// import: scripts/fileshare.test.mjs loads this module directly under plain
// node (`node --experimental-strip-types`), which can only resolve relative
// specifiers and cannot run a component.

// The Relay hash-verifies its uploads, so the copy action body needs an exact
// 64-char lowercase-hex sha256 — but the pinboard only carries a 10-char
// prefix. resolveMeta returns the stored full hash; this gates the relay
// branch on it.
export const isFullSha256 = (value: string): boolean => /^[0-9a-f]{64}$/.test(value)

// The Relay caps a share filename at 255 BYTES (MAX_SHARE_FILENAME_LEN) and
// rejects anything longer with a 400 the contract classifies as "our bug".
export const MAX_SHARE_FILENAME_BYTES = 255

const UTF8 = new TextEncoder()
const utf8Length = (value: string): number => UTF8.encode(value).length

/**
 * Trim a filename to `maxBytes` UTF-8 bytes, keeping the extension and never
 * splitting a character (255 bytes is ~85 CJK characters, which real
 * filenames reach). The Relay's own cache sanitizer truncates to the same
 * ceiling anyway, so pre-truncating loses nothing and turns a hard 400 into a
 * successful copy under a slightly shorter name.
 */
export function truncateShareFilename(name: string, maxBytes = MAX_SHARE_FILENAME_BYTES): string {
  const trimmed = name.trim()
  if (utf8Length(trimmed) <= maxBytes) return trimmed
  const dot = trimmed.lastIndexOf(".")
  // A "." at index 0 is a dotfile, not an extension; an extension that would
  // eat half the budget is not an extension either (a name with a stray dot).
  let extension = dot > 0 ? trimmed.slice(dot) : ""
  if (utf8Length(extension) > maxBytes / 2) extension = ""
  const stem = extension ? trimmed.slice(0, trimmed.length - extension.length) : trimmed
  const budget = maxBytes - utf8Length(extension)
  // Iterating the string yields whole code points, so neither a multi-byte
  // character nor a surrogate pair can be cut in half.
  let kept = ""
  let used = 0
  for (const character of stem) {
    const size = utf8Length(character)
    if (used + size > budget) break
    kept += character
    used += size
  }
  const result = `${kept}${extension}`.trim()
  // Degenerate input (an extension alone longer than the budget): keep
  // something non-empty rather than handing the Relay an empty filename.
  return result || Array.from(trimmed).slice(0, maxBytes).join("")
}

export type ShareMetaFields = {
  path?: string
  filename?: string
  size?: number
  sha256?: string
}

export type MergedShareMeta = {
  path?: string
  filename?: string
  size?: number
  sha256: string
}

/**
 * Merge the caller-supplied share metadata with whatever the item fetch
 * returned. Caller values win; the fetch only fills gaps — except for the
 * sha256, where the fetch is authoritative because it resolves a pinboard's
 * 10-char prefix to the stored full 64-hex hash.
 */
export function mergeShareMeta(
  given: ShareMetaFields & { sha256: string },
  fetched: ShareMetaFields = {},
): MergedShareMeta {
  return {
    // `||`, never `??`: several callers build an EMPTY-string path
    // (similarityTarget's `file?.path || ""`) and pass it down. An empty path
    // is exactly as useless as an absent one — the Relay rejects it before
    // anything else — so it must not shadow the fetched path.
    path: given.path || fetched.path || undefined,
    filename: given.filename || fetched.filename || undefined,
    // 0 is a legitimate size (empty files exist); only `undefined` is unknown.
    size: given.size ?? fetched.size,
    sha256: fetched.sha256 || given.sha256,
  }
}

/**
 * The message out of any error envelope this app can receive:
 *
 *   - the Relay's `structured_error` — `{error: {code, message, details}}`
 *   - the Relay's plain `error()` — `{"error": "<string>"}` (reachable in the
 *     share flow for an invalid path, an action-persist failure, the action
 *     ceiling and an unknown upload record)
 *   - the gateway's ApiError — `{detail: "<string>"}`
 */
export function relayErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback
  const envelope = body as { error?: unknown, detail?: unknown }
  if (typeof envelope.error === "string" && envelope.error) return envelope.error
  if (envelope.error && typeof envelope.error === "object") {
    const message = (envelope.error as { message?: unknown }).message
    if (typeof message === "string" && message) return message
  }
  if (typeof envelope.detail === "string" && envelope.detail) return envelope.detail
  return fallback
}

/** The code out of a structured envelope; `undefined` for the legacy shape. */
export function relayErrorCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined
  const error = (body as { error?: unknown }).error
  if (!error || typeof error !== "object") return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === "string" ? code : undefined
}

/** A thrown value rendered as a toast description. */
export function describeError(error: unknown, fallback = "Unknown error"): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === "object") {
    const envelope = relayErrorMessage(error, "")
    if (envelope) return envelope
    const own = (error as { message?: unknown }).message
    if (typeof own === "string" && own) return own
    // An object with nothing message-shaped in it stringifies to
    // "[object Object]"; the fallback is more use to a reader than that.
    return fallback
  }
  if (error === null || error === undefined) return fallback
  return String(error) || fallback
}
