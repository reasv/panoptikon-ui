// Pure helpers behind "Copy, don't download" for TRANSCODE ARTIFACTS: the
// deliverable shape the job store parses off an `ArtifactRef`, the relay
// eligibility gate, and the name a fallback download lands under.
//
// Deliberately free of React, of the `@/` alias and of every browser-only
// import, exactly like lib/fileShareMeta.ts (whose `isFullSha256` this reuses
// rather than re-spelling): scripts/artifactShare.test.mjs loads this module
// directly under plain node, which can only resolve relative specifiers and
// cannot run a component.
//
// The hook that USES these is hooks/artifactShare.ts, the artifact-side twin
// of hooks/fileShare.ts. Same split, same reason.

import { isFullSha256 } from "./fileShareMeta"

/**
 * One finished artifact, as much of `ArtifactRef` as a delivery needs.
 *
 * Parsed defensively out of the wire by lib/videoTranscode.ts (the payload
 * arrives as text through an EventSource, where the type system is a
 * suggestion), so every field a server may not have sent is nullable:
 *
 * - `key` is the only REQUIRED one, and it is what makes the object exist at
 *   all — the server-side copy addresses the artifact by key and nothing else.
 * - `sha256` is null on a row committed before the column existed. The
 *   `ArtifactRef` doc is explicit that this means "no integrity claim", so it
 *   disqualifies the relay leg (which hash-verifies) rather than failing it.
 * - `path` is the relay's mapping hint — the artifact's absolute path on the
 *   server host. A hint that does not resolve on the relay's machine simply
 *   earns a `bytes_required`, which is the ordinary upload path.
 * - `size` is null when unknown, never coerced to 0: 0 is a legitimate size
 *   (see `relayEligibleArtifact`), so the two must stay distinguishable.
 */
export type DeliverableArtifact = {
  key: string
  url: string
  filename: string | null
  size: number | null
  sha256: string | null
  path: string | null
}

/**
 * An artifact that has cleared `relayEligibleArtifact` — the three fields the
 * Relay's copy action requires, narrowed to non-null so the caller builds its
 * `RelayShareFile` without re-asserting what the gate just proved.
 */
export type RelayReadyArtifact = DeliverableArtifact & {
  sha256: string
  size: number
  path: string
}

/**
 * May this artifact go through the RELAY leg?
 *
 * The same three-part gate hooks/fileShare.ts applies to an original file, for
 * the same reasons: the Relay hash-verifies and size-checks the upload and
 * rejects an EMPTY path before anything else, so a relay copy is only
 * attempted with a full 64-hex sha256, a known numeric size, and a non-empty
 * path. Any of them missing disqualifies the leg and the caller falls through
 * to the server copy or to a download — never sending a null hash, an unknown
 * size or an empty path the Relay would hard-fail on.
 *
 * A size of ZERO is ELIGIBLE. `relayClient.ts` says it outright ("size MAY be
 * 0 for a legitimately empty file — send 0, never omit it"); only `null` is
 * unknown.
 *
 * `typeof === "number"` alone is NOT enough to call a size known: `NaN`,
 * `Infinity` and negatives are all numbers, all reachable from a defensive
 * parse of an EventSource payload (`Number("")` is 0, but `Number("x")` is
 * `NaN` and a bad `size_bytes` can arrive negative), and every one of them is
 * a hard 400 at the relay after the browser has already materialized the file.
 * Finite and non-negative is what "known size" means.
 */
export function relayEligibleArtifact(
  artifact: DeliverableArtifact,
): artifact is RelayReadyArtifact {
  return (
    typeof artifact.sha256 === "string" &&
    isFullSha256(artifact.sha256) &&
    typeof artifact.size === "number" &&
    Number.isFinite(artifact.size) &&
    artifact.size >= 0 &&
    !!artifact.path
  )
}

/**
 * The name to save bytes under when the server sent none. Only reachable
 * against a gateway older than the `ArtifactRef.filename` field, or a payload
 * the defensive parse could not read — never in normal operation, which is why
 * it does not try to be a good name. The extension matters (the `download`
 * attribute IS the filename, and an extensionless one lands as a file nothing
 * will open); the stem only has to be unambiguous.
 *
 * Shared by lib/videoClip.ts (which knows the pressed row's `preset.ext`) and
 * by `artifactDownloadName` below (which does not, and reads one off the
 * artifact's own storage name instead).
 */
export function fallbackFileName(sha256: string, ext: string): string {
  return `${sha256.slice(0, 10)}-clip.${ext}`
}

/**
 * Last-resort container when neither the artifact's stored path nor its URL
 * carries an extension. Every shipped VIDEO preset — the playback rendition
 * included — is an mp4, so this is the likeliest of the guesses available
 * here, and it is only ever reached on a payload that already lost two better
 * answers.
 */
const FALLBACK_ARTIFACT_EXT = "mp4"

/**
 * The extension of an artifact's own storage name. The cache stores an
 * artifact as `<key>.<ext>`, so both the server-side path and the `?key=` URL
 * usually end in the real container — a truth worth reading before guessing
 * one. Query strings and directory separators are stripped first so a `.` in
 * a folder name (or in `?key=…`) cannot be mistaken for an extension.
 */
export function artifactExtension(artifact: {
  path: string | null
  url: string
}): string | null {
  for (const candidate of [artifact.path, artifact.url]) {
    if (!candidate) continue
    const withoutQuery = candidate.split(/[?#]/)[0]
    const separator = Math.max(
      withoutQuery.lastIndexOf("/"),
      withoutQuery.lastIndexOf("\\"),
    )
    const name = withoutQuery.slice(separator + 1)
    const dot = name.lastIndexOf(".")
    // A dot at index 0 is a dotfile, not an extension.
    if (dot <= 0) continue
    const ext = name.slice(dot + 1)
    if (/^[A-Za-z0-9]{1,8}$/.test(ext)) return ext.toLowerCase()
  }
  return null
}

/**
 * What a DOWNLOAD of this artifact should be called: the server's own name
 * whenever it sent one (the only place that knows whether the request was
 * trimmed), and a hash-prefixed stem otherwise.
 */
export function artifactDownloadName(artifact: DeliverableArtifact): string {
  if (artifact.filename) return artifact.filename
  const stem = artifact.sha256 || artifact.key
  return fallbackFileName(stem, artifactExtension(artifact) ?? FALLBACK_ARTIFACT_EXT)
}

/**
 * The one branch `exportClip` takes on a finished job: hand the artifact to
 * the delivery seam, or save it as a file.
 *
 * Pure and separate because it is the whole of the deliver-mode decision, and
 * the surrounding function is a POST-follow-download pipeline no node script
 * can drive. "deliver" needs BOTH a deliverer and a parsed artifact: an old
 * gateway sends a `done` whose artifact this client cannot address (no key),
 * and the download path is always valid, so it is what an unaddressable
 * artifact falls back to.
 */
export function artifactDeliveryMode(
  artifact: DeliverableArtifact | null,
  canDeliver: boolean,
): "deliver" | "download" {
  return canDeliver && artifact != null ? "deliver" : "download"
}
