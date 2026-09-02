// Assertions for the pure half of "Copy, don't download" on TRANSCODE
// ARTIFACTS: the relay-eligibility gate and the download name
// (lib/artifactShareMeta.ts), the deliverable the job store parses off an
// ArtifactRef at BOTH of its parse sites (lib/videoTranscode.ts), and the one
// branch the clip export takes on a finished job (`artifactDeliveryMode`,
// which is the whole of the deliver-mode decision in a function no node script
// can drive). Run from the ui root:
//
//   node --experimental-strip-types scripts/artifactShare.test.mjs
//
// lib/videoTranscode.ts imports fetchClient (a value, at module scope) — that
// is why the resolver hook below also maps the "@/" alias.

import { createChecker } from "./harness.mjs"
import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  artifactDeliveryMode,
  artifactDownloadName,
  artifactExtension,
  fallbackFileName,
  relayEligibleArtifact,
} = await import("../lib/artifactShareMeta.ts")

const { stateFromEvent, stateFromSubmit } = await import("../lib/videoTranscode.ts")

const { check, finish } = createChecker()
const shape = (value) => JSON.stringify(value)

const SHA = "0a1b2c3d4e5f60718293a4b5c6d7e8f900112233445566778899aabbccddeeff"

/** A fully-deliverable artifact; each case below removes exactly one thing. */
const full = (overrides = {}) => ({
  key: "abc-def",
  url: "/api/video/artifact?key=abc-def",
  filename: "holiday-clip.mp4",
  size: 1234,
  sha256: SHA,
  path: "C:/panoptikon/cache/video/abc-def.mp4",
  ...overrides,
})

// ---- relayEligibleArtifact ---------------------------------------------
//
// The Relay hash-verifies and size-checks its uploads and rejects an EMPTY
// path before anything else, so all three have to be present or the leg is
// disqualified and the caller falls through to the server copy / a download.

check("everything present is eligible", relayEligibleArtifact(full()) === true)
check(
  "a null sha256 (a pre-migration row) is NOT eligible",
  relayEligibleArtifact(full({ sha256: null })) === false
)
check(
  "a short/prefix sha256 is not a hash the relay can verify against",
  relayEligibleArtifact(full({ sha256: SHA.slice(0, 10) })) === false &&
    relayEligibleArtifact(full({ sha256: SHA.slice(0, 63) })) === false
)
check(
  "an uppercase hash is rejected too (the relay wants lowercase hex)",
  relayEligibleArtifact(full({ sha256: SHA.toUpperCase() })) === false
)
check(
  "an unknown size is not eligible",
  relayEligibleArtifact(full({ size: null })) === false
)
// relayClient.ts is explicit: "size MAY be 0 for a legitimately empty file —
// send 0, never omit it". Only null is unknown.
check(
  "size 0 IS eligible — an empty file is a legitimate one",
  relayEligibleArtifact(full({ size: 0 })) === true
)
// `typeof === "number"` is true for all three of these, and every one of them
// is a hard 400 at the relay — after the browser has already materialized a
// possibly multi-GB file. "Known size" means finite and non-negative.
check(
  "NaN is a number but not a size",
  relayEligibleArtifact(full({ size: Number.NaN })) === false
)
check(
  "a negative size is not eligible",
  relayEligibleArtifact(full({ size: -1 })) === false
)
check(
  "an infinite size is not eligible",
  relayEligibleArtifact(full({ size: Number.POSITIVE_INFINITY })) === false &&
    relayEligibleArtifact(full({ size: Number.NEGATIVE_INFINITY })) === false
)
check(
  "an empty or absent path is not eligible",
  relayEligibleArtifact(full({ path: "" })) === false &&
    relayEligibleArtifact(full({ path: null })) === false
)
check(
  "a missing filename does not disqualify anything (a name is derivable)",
  relayEligibleArtifact(full({ filename: null })) === true
)

// ---- the download name --------------------------------------------------

check(
  "the server's own name is used verbatim when there is one",
  artifactDownloadName(full()) === "holiday-clip.mp4"
)
check(
  "without one, the extension is read off the artifact's storage name",
  artifactDownloadName(full({ filename: null })) === `${SHA.slice(0, 10)}-clip.mp4`
)
check(
  "the URL is the second source of an extension",
  artifactDownloadName(
    full({ filename: null, path: null, url: "/cache/abc.webp?key=abc" })
  ) === `${SHA.slice(0, 10)}-clip.webp`,
  artifactDownloadName(full({ filename: null, path: null, url: "/cache/abc.webp?key=abc" }))
)
check(
  "with no extension anywhere the name still has one (never extensionless)",
  artifactDownloadName(
    full({ filename: null, path: null, url: "/api/video/artifact?key=abc-def" })
  ) === `${SHA.slice(0, 10)}-clip.mp4`
)
check(
  "the key stands in for the stem when the hash is missing too",
  artifactDownloadName(full({ filename: null, sha256: null })) === "abc-def-clip.mp4"
)
check(
  "fallbackFileName is the shared spelling lib/videoClip.ts uses",
  fallbackFileName(SHA, "webm") === `${SHA.slice(0, 10)}-clip.webm`
)
check(
  "a query string and a dotted directory never look like an extension",
  artifactExtension({ path: null, url: "/api/video/artifact?key=a.b.c" }) === null &&
    artifactExtension({ path: "/srv/my.cache/abcdef", url: "" }) === null
)
check(
  "a dotfile is not an extension either",
  artifactExtension({ path: "/srv/cache/.hidden", url: "" }) === null
)

// ---- the deliverable, off both parse sites ------------------------------
//
// The SSE/poll `done` event and the `outcome: "hit"` submit response carry the
// identical ArtifactRef, which is why both read it through one parser. What
// the store keeps unchanged is `artifactUrl`/`filename`: the download path has
// to keep working against a payload with no usable artifact object at all.

const REF = {
  key: "k1",
  url: "/api/video/artifact?key=k1",
  filename: "holiday-clip.mp4",
  mime_type: "video/mp4",
  size_bytes: 4096,
  sha256: SHA,
  path: "/srv/cache/video/k1.mp4",
}

check(
  "a done event parses the whole deliverable",
  shape(stateFromEvent({ id: "j", state: "done", artifact: REF }).artifact) ===
    shape({
      key: "k1",
      url: "/api/video/artifact?key=k1",
      filename: "holiday-clip.mp4",
      size: 4096,
      sha256: SHA,
      path: "/srv/cache/video/k1.mp4",
    }),
  shape(stateFromEvent({ id: "j", state: "done", artifact: REF }).artifact)
)
check(
  "outcome=hit parses the identical deliverable",
  shape(stateFromSubmit({ outcome: "hit", artifact: REF }).artifact) ===
    shape(stateFromEvent({ state: "done", artifact: REF }).artifact)
)
check(
  "the artifact's url is the state's url, never a second read",
  stateFromEvent({ state: "done", artifact: REF }).artifact.url ===
    stateFromEvent({ state: "done", artifact: REF }).artifactUrl
)

// A missing KEY is what makes the whole artifact null: the server-side copy
// addresses an artifact by key and by nothing else. The download path is
// untouched by that — it only ever needed the URL.
const KEYLESS = { url: "/api/video/artifact?key=k1", filename: "holiday-clip.mp4" }
check(
  "no key ⇒ no artifact, while artifactUrl and filename still work",
  (() => {
    for (const state of [
      stateFromEvent({ state: "done", artifact: KEYLESS }),
      stateFromSubmit({ outcome: "hit", artifact: KEYLESS }),
    ]) {
      if (state.state !== "done") return false
      if (state.artifact !== null) return false
      if (state.artifactUrl !== "/api/video/artifact?key=k1") return false
      if (state.filename !== "holiday-clip.mp4") return false
    }
    return true
  })()
)
check(
  "an empty-string key is no key at all",
  stateFromEvent({ state: "done", artifact: { ...REF, key: "" } }).artifact === null
)

// The new fields are the ones an older gateway does not send. Absent means
// null — never a coerced 0 (a legitimate size) and never a mismatch claim.
check(
  "sha256 / path / size_bytes absent ⇒ nulls, not defaults",
  shape(
    stateFromEvent({
      state: "done",
      artifact: { key: "k1", url: "/u", filename: "a.mp4", mime_type: "video/mp4" },
    }).artifact
  ) ===
    shape({ key: "k1", url: "/u", filename: "a.mp4", size: null, sha256: null, path: null })
)
check(
  "a malformed field is the same as an absent one",
  shape(
    stateFromEvent({
      state: "done",
      artifact: { key: "k1", url: "/u", filename: 7, size_bytes: "big", sha256: {}, path: [] },
    }).artifact
  ) ===
    shape({ key: "k1", url: "/u", filename: null, size: null, sha256: null, path: null })
)
check(
  "a size of 0 survives the parse (it is not an unknown size)",
  stateFromEvent({
    state: "done",
    artifact: { key: "k1", url: "/u", size_bytes: 0 },
  }).artifact.size === 0
)
check(
  "a negative or non-finite size is unusable, not clamped",
  stateFromEvent({ state: "done", artifact: { key: "k", url: "/u", size_bytes: -1 } })
    .artifact.size === null &&
    stateFromEvent({
      state: "done",
      artifact: { key: "k", url: "/u", size_bytes: Number.POSITIVE_INFINITY },
    }).artifact.size === null
)
check(
  "a done payload with no artifact at all is still a failure, as before",
  stateFromEvent({ state: "done", artifact: {} }).state === "failed" &&
    stateFromSubmit({ outcome: "hit" }).state === "failed"
)
// End to end: what the store parses is what the gate reads.
check(
  "a full ArtifactRef arrives relay-eligible; a pre-migration one does not",
  relayEligibleArtifact(stateFromEvent({ state: "done", artifact: REF }).artifact) === true &&
    relayEligibleArtifact(
      stateFromEvent({
        state: "done",
        artifact: { ...REF, sha256: null, path: null },
      }).artifact
    ) === false
)

// ---- the clip export's one branch ---------------------------------------
//
// "deliver" needs BOTH a deliverer and an addressable artifact. An older
// gateway's `done` has neither key nor hash, and the download path is always
// valid — so it is what an unaddressable artifact falls back to, whatever mode
// the surface is in.

const ARTIFACT = full()
check(
  "a deliverer plus an artifact delivers",
  artifactDeliveryMode(ARTIFACT, true) === "deliver"
)
check(
  "no deliverer downloads, artifact or not",
  artifactDeliveryMode(ARTIFACT, false) === "download" &&
    artifactDeliveryMode(null, false) === "download"
)
check(
  "a deliverer with an unparseable artifact downloads",
  artifactDeliveryMode(null, true) === "download"
)

finish()
