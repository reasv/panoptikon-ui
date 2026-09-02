// Assertions for lib/fileShareMeta.ts — the pure units behind the adaptive
// share button (hooks/fileShare.ts) and the Relay share client
// (lib/relayClient.ts). No test runner in this repo — run it directly from
// the ui root:
//
//   node --experimental-strip-types scripts/fileshare.test.mjs
//
// (the flag is what lets a .mjs import the .ts module; Node 22+). Exits
// non-zero on the first failing assertion set.

import { createChecker } from "./harness.mjs"
import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  describeError,
  isFullSha256,
  mergeShareMeta,
  relayErrorMessage,
  truncateShareFilename,
} = await import("../lib/fileShareMeta.ts")

const { check, finish } = createChecker()

const SHA = "0a1b2c3d4e5f60718293a4b5c6d7e8f900112233445566778899aabbccddeeff"
const SHA10 = SHA.slice(0, 10)

// ---- isFullSha256 ----------------------------------------------------
// The Relay hash-verifies its uploads: only a full 64-hex lowercase hash may
// reach the action body, and the pinboard carries a 10-char prefix.

check("full 64-hex hash accepted", isFullSha256(SHA) === true)
check("pinboard prefix rejected", isFullSha256(SHA10) === false)
check("uppercase rejected", isFullSha256(SHA.toUpperCase()) === false)
check("63 chars rejected", isFullSha256(SHA.slice(0, 63)) === false)
check("65 chars rejected", isFullSha256(`${SHA}f`) === false)
check("non-hex rejected", isFullSha256(`${SHA.slice(0, 63)}g`) === false)
check("empty rejected", isFullSha256("") === false)

// ---- mergeShareMeta --------------------------------------------------

check(
  "caller values win over the fetch",
  (() => {
    const merged = mergeShareMeta(
      { sha256: SHA, path: "C:/given.png", filename: "given.png", size: 7 },
      { path: "C:/fetched.png", filename: "fetched.png", size: 9 }
    )
    return merged.path === "C:/given.png"
      && merged.filename === "given.png"
      && merged.size === 7
  })()
)

check(
  "the fetch fills every absent field",
  (() => {
    const merged = mergeShareMeta({ sha256: SHA10 }, {
      path: "C:/fetched.png", filename: "fetched.png", size: 9, sha256: SHA,
    })
    return merged.path === "C:/fetched.png"
      && merged.filename === "fetched.png"
      && merged.size === 9
  })()
)

// The item fetch is what resolves a pinboard's 10-char prefix to the stored
// full hash, so it is authoritative for the sha256 alone.
check(
  "fetched sha256 overrides the caller's prefix",
  mergeShareMeta({ sha256: SHA10 }, { sha256: SHA }).sha256 === SHA
)
check(
  "caller sha256 survives a fetch that returned none",
  mergeShareMeta({ sha256: SHA }, {}).sha256 === SHA
)

// The regression FIX 3(b) names: similarityTarget builds `path: file?.path
// || ""` and passes it down. `??` would keep that empty string and discard
// the fetched path, and the Relay rejects an empty path before anything else.
check(
  "empty-string path does NOT shadow the fetched path",
  mergeShareMeta({ sha256: SHA, path: "" }, { path: "C:/fetched.png" }).path
    === "C:/fetched.png"
)
check(
  "empty-string filename does NOT shadow the fetched filename",
  mergeShareMeta({ sha256: SHA, filename: "" }, { filename: "fetched.png" }).filename
    === "fetched.png"
)
check(
  "an empty path with nothing to fall back on is undefined, not \"\"",
  mergeShareMeta({ sha256: SHA, path: "" }, {}).path === undefined
)

// 0 is a legitimate size (empty files exist) — only `undefined` is unknown,
// which is what disqualifies the relay branch.
check(
  "size 0 is kept, not treated as missing",
  mergeShareMeta({ sha256: SHA, size: 0 }, { size: 44 }).size === 0
)
check(
  "absent size falls through to the fetch",
  mergeShareMeta({ sha256: SHA }, { size: 44 }).size === 44
)
check(
  "size unknown on both sides stays undefined",
  mergeShareMeta({ sha256: SHA }, {}).size === undefined
)
check("fetched defaults to empty", mergeShareMeta({ sha256: SHA }).size === undefined)

// ---- error envelopes -------------------------------------------------
// Three shapes reach the toasts: the gateway's ApiError, the Relay's
// structured_error, and the Relay's legacy error() — the last of which the
// client used to drop on the floor in favour of a generic status line.

check(
  "ApiError {detail}",
  describeError({ detail: "no such item" }) === "no such item"
)
check(
  "structured relay {error:{message}}",
  describeError({ error: { code: "size_mismatch", message: "the upload did not match" } })
    === "the upload did not match"
)
check(
  "legacy relay {error:\"string\"}",
  describeError({ error: "invalid server path" }) === "invalid server path"
)
check(
  "Error instances keep their message",
  describeError(new Error("boom")) === "boom"
)
check("a bare string round-trips", describeError("plain") === "plain")
check("null falls back", describeError(null) === "Unknown error")
check("custom fallback honored", describeError(undefined, "nope") === "nope")
check(
  "an unrecognised object falls back",
  describeError({ nothing: true }, "nope") === "nope"
)

check(
  "relayErrorMessage: legacy string beats the fallback",
  relayErrorMessage({ error: "too many Relay actions are in flight" }, "generic")
    === "too many Relay actions are in flight"
)
check(
  "relayErrorMessage: structured message beats the fallback",
  relayErrorMessage({ error: { code: "file_too_large", message: "too big" } }, "generic")
    === "too big"
)
check(
  "relayErrorMessage: an unparsable body keeps the fallback",
  relayErrorMessage(null, "Local Relay copy failed (400)")
    === "Local Relay copy failed (400)"
)
check(
  "relayErrorMessage: an empty legacy string keeps the fallback",
  relayErrorMessage({ error: "" }, "generic") === "generic"
)

// ---- truncateShareFilename -------------------------------------------
// The Relay's ceiling is 255 BYTES, which is ~85 CJK characters.

const utf8 = (value) => new TextEncoder().encode(value).length

check(
  "a short name is untouched",
  truncateShareFilename("holiday.png") === "holiday.png"
)
check(
  "a name exactly at the ceiling is untouched",
  (() => {
    const name = `${"a".repeat(251)}.png`
    return utf8(name) === 255 && truncateShareFilename(name) === name
  })()
)
check(
  "an over-long ASCII name keeps its extension and fits",
  (() => {
    const out = truncateShareFilename(`${"a".repeat(400)}.png`)
    return utf8(out) === 255 && out.endsWith(".png")
  })()
)
check(
  "an over-long CJK name is cut on a character boundary",
  (() => {
    // 300 x 3 bytes + ".jpg"
    const out = truncateShareFilename(`${"漢".repeat(300)}.jpg`)
    return utf8(out) <= 255
      && out.endsWith(".jpg")
      && !out.includes("\uFFFD")
      // 251 bytes of budget / 3 bytes per character = 83 characters
      && out === `${"漢".repeat(83)}.jpg`
  })(),
)
check(
  "an astral-plane name never splits a surrogate pair",
  (() => {
    const out = truncateShareFilename(`${"🐈".repeat(100)}.gif`)
    return utf8(out) <= 255
      && out.endsWith(".gif")
      && Array.from(out).every(ch => ch === "🐈" || ".gif".includes(ch))
  })()
)
check(
  "a dotfile with no extension is truncated whole",
  (() => {
    const out = truncateShareFilename(`.${"b".repeat(400)}`)
    return utf8(out) === 255 && out.startsWith(".b")
  })()
)
check(
  "an absurd \"extension\" is dropped rather than eating the budget",
  (() => {
    const out = truncateShareFilename(`name.${"z".repeat(400)}`)
    return utf8(out) === 255 && out.startsWith("name.")
  })()
)
check(
  "a custom ceiling is honored",
  utf8(truncateShareFilename(`${"a".repeat(50)}.png`, 20)) <= 20
)
check(
  "the result is never empty",
  truncateShareFilename(`.${"z".repeat(400)}`, 8).length > 0
)

finish()
