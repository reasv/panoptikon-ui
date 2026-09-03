// Assertions for video hover previews: the three-layer PREFERENCE resolution
// (lib/state/hoverPreviewPref.ts), the byte-capped RUNG LADDER, its request
// shapes and its session downgrades (lib/videoPreview.ts), the mp4 stream-copy
// question (lib/videoPlayability.ts), the CANCEL rule and the key's trim
// segment (lib/videoTranscode.ts), the client-config normalization
// (lib/clientConfig.ts) and the V12 frame swap as it reaches the plan
// (lib/cellPicture.ts). The contract is
// docs/video-hover-preview-implementation.md §1, decisions V2-V12, §4's unit
// list, and the byte-capped ladder settled after the verifier measured one
// hover pulling 9.9 MB of a 15.7 MB file. Run it from the ui root:
//
//   node --experimental-strip-types scripts/videopreview.test.mjs
//
// Everything asserted here is pure or is a store decision that touches no
// network: the preference module reaches for localStorage only from inside its
// box functions, the playability ladder takes an injected `canPlayType`, and
// the transcode store's cancel path issues a request only for a job it created
// — which nothing here creates. Exits non-zero on failure.

import { createChecker } from "./harness.mjs"
import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  HOVER_PREVIEW_OFF,
  HOVER_PREVIEW_PREF_STORAGE_KEY,
  hoverPreviewCapability,
  hoverPreviewChoice,
  isEmptyHoverPreviewPref,
  parseHoverPreviewPref,
  resolveHoverPreview,
  withHoverPreviewSlot,
} = await import("../lib/state/hoverPreviewPref.ts")
const {
  PREVIEW_MAX_CS,
  PREVIEW_MAX_SECONDS,
  PREVIEW_PRESET,
  PREVIEW_TRIM_PRESET,
  cellPreviewLadder,
  cellPreviewRung,
  clearPreviewRungFailures,
  notePreviewRungFailure,
  previewFeedback,
  previewKey,
  previewLadder,
  previewRequest,
  previewRung,
  previewArmLadder,
  previewRungFailures,
  previewSliceBytes,
  rungAtStep,
  shouldRecordFailure,
  withinPreviewCap,
} = await import("../lib/videoPreview.ts")
const {
  cancelTranscode,
  createdOwnJob,
  getTranscodeState,
  ownsTranscodeJob,
  setTranscodeState,
  shouldSubmit,
  startTranscode,
  transcodeKey,
  transcodeStoreSize,
} = await import("../lib/videoTranscode.ts")
const { noteVideoPlaybackError, videoCodecPlayableInMp4 } = await import(
  "../lib/videoPlayability.ts"
)
const { deriveClientConfig } = await import("../lib/clientConfig.ts")
const { planCellPicture } = await import("../lib/cellPicture.ts")

const { check, finish } = createChecker()
const shape = (value) => JSON.stringify(value)

/** The server's default ceiling: 16 MiB (`[transcode] hover_preview_max_bytes`). */
const CAP = 16 * 1024 * 1024

/** A resolved capability, spelled the way the ladder tests read best. */
const can = (direct, trim, transcode, maxBytes = CAP) =>
  hoverPreviewCapability(direct, trim, transcode, maxBytes)

/**
 * A browser that decodes h264/AAC in mp4 and VP8/VP9/Opus in WebM, and nothing
 * else — Chrome on a machine with no HEVC. Shaped as the real `canPlayType`
 * is (a full `mime; codecs="…"` string in, `"probably"` or `""` out), because
 * the whole point of the mp4 question below is WHICH string gets asked.
 */
const chrome = (type) => {
  const match = /^([^;]+);\s*codecs="([^"]+)"$/.exec(type)
  if (!match) return ""
  const [, mime, codecs] = match
  const plays = {
    "video/mp4": ["avc1.42E01E", "av01.0.04M.08", "mp4a.40.2", "mp4a.6B", "flac", "opus"],
    "video/webm": ["vp8", "vp9", "vp09.00.10.08", "opus", "vorbis"],
  }
  return (plays[mime] ?? []).includes(codecs) ? "probably" : ""
}

// ---------------------------------------------------------------------------
// V5-V7: the preference resolution matrix
// ---------------------------------------------------------------------------
//
// Three layers, one direction: the SERVER says what is allowed, and the
// browser preference can only ever subtract from it. Two slots over three
// rungs — `direct` governs both rungs that play the item's own bytes.

console.log("\n== the preference resolution matrix (V5-V7) ==")
{
  const form = (c) =>
    `${c.direct ? "D" : "-"}${c.trim ? "R" : "-"}${c.transcode ? "T" : "-"}`
  const servers = {
    absent: null,
    denied: can(false, false, false),
    "copy only": can(false, true, false),
    "originals only": can(true, true, false),
    allowed: can(true, true, true),
  }
  const prefs = {
    absent: {},
    on: { direct: true, transcode: true },
    originals: { direct: true, transcode: false },
    off: { direct: false, transcode: false },
  }
  const expected = {
    "absent/absent": "---", "absent/on": "---",
    "absent/originals": "---", "absent/off": "---",
    "denied/absent": "---", "denied/on": "---",
    "denied/originals": "---", "denied/off": "---",
    // The `direct` slot governs the stream copy too: turning previews off
    // must take away the rung that pulls the file's own bytes in pieces
    // exactly as it takes away the one that pulls them whole.
    "copy only/absent": "-R-", "copy only/on": "-R-",
    "copy only/originals": "-R-", "copy only/off": "---",
    "originals only/absent": "DR-", "originals only/on": "DR-",
    "originals only/originals": "DR-", "originals only/off": "---",
    "allowed/absent": "DRT", "allowed/on": "DRT",
    "allowed/originals": "DR-", "allowed/off": "---",
  }
  let agreed = true
  for (const [serverName, server] of Object.entries(servers)) {
    for (const [prefName, pref] of Object.entries(prefs)) {
      const name = `${serverName}/${prefName}`
      const got = form(resolveHoverPreview(server, pref))
      if (!check(`server ${serverName}, pref ${prefName} -> ${expected[name]}`,
        got === expected[name], got)) {
        agreed = false
      }
    }
  }
  check("the whole matrix agrees", agreed)
  check(
    "a pref of ON against a denying server is still off",
    resolveHoverPreview(can(false, false, false),
      { direct: true, transcode: true }) === HOVER_PREVIEW_OFF
  )
  // The CAP rides through untouched: it is the server's number and no
  // preference has an opinion about it.
  check("the cap is carried through the resolution",
    resolveHoverPreview(can(true, true, true, 1234), {}).maxBytes === 1234)
  // Identity, not just equality: the resolved answer is a PROP on hundreds of
  // memoized cards, and a fresh object per render would defeat that memo for
  // every visible card on every scroll frame.
  check(
    "equal answers are the SAME object (memo-stable as a prop)",
    resolveHoverPreview(can(true, true, true), {})
      === resolveHoverPreview(can(true, true, true), { direct: true })
      && resolveHoverPreview(null, {}) === HOVER_PREVIEW_OFF
      && can(true, false, true, CAP) === can(true, false, true, CAP)
  )
  check("...and a different CAP is a different answer",
    can(true, true, true, CAP) !== can(true, true, true, CAP + 1))
}

console.log("\n== the stored preference (V7) ==")
{
  check(
    "the storage key is the settled one",
    HOVER_PREVIEW_PREF_STORAGE_KEY === "panoptikon.hoverPreviewPref",
    HOVER_PREVIEW_PREF_STORAGE_KEY
  )
  check("nothing stored reads as both slots absent",
    shape(parseHoverPreviewPref(null)) === shape({}))
  check("unparseable JSON reads as absent",
    shape(parseHoverPreviewPref("{not json")) === shape({}))
  check("a non-object reads as absent",
    shape(parseHoverPreviewPref("42")) === shape({}))
  check("a hand-edited string slot is dropped, not coerced",
    shape(parseHoverPreviewPref('{"direct":"yes","transcode":false}'))
      === shape({ transcode: false }))
  check("both booleans survive a round trip",
    shape(parseHoverPreviewPref(JSON.stringify({ direct: true, transcode: false })))
      === shape({ direct: true, transcode: false }))

  const allowed = can(true, true, true)
  const noEncode = can(true, true, false)
  const copyOnly = can(false, true, false)
  check("Off writes both slots false",
    shape(withHoverPreviewSlot({ direct: true, transcode: true }, "off", allowed))
      === shape({ direct: false, transcode: false }))
  check("Originals writes direct on and transcode off",
    shape(withHoverPreviewSlot({}, "originals", allowed))
      === shape({ direct: true, transcode: false }))
  check("All writes both slots true",
    shape(withHoverPreviewSlot({}, "all", allowed))
      === shape({ direct: true, transcode: true }))
  // A SLOT IS ONLY WRITTEN FOR A RUNG THE SERVER OFFERED (verifier finding
  // S2). On a server that denies the encode, "Originals" is what the control
  // already shows, so clicking it is a visual no-op — and a `transcode: false`
  // written there would record a decision the user had no control to make
  // ("All" is disabled beside it) and could never undo.
  check("on a transcode-denied server, Originals stores direct ONLY",
    shape(withHoverPreviewSlot({}, "originals", noEncode))
      === shape({ direct: true }),
    shape(withHoverPreviewSlot({}, "originals", noEncode)))
  check("...and Off stores direct only, by the same rule",
    shape(withHoverPreviewSlot({}, "off", noEncode)) === shape({ direct: false }))
  // The `direct` SLOT governs both own-bytes rungs, so the stream copy alone
  // is enough to make it a real choice.
  check("a server offering only the stream copy still records the direct slot",
    shape(withHoverPreviewSlot({}, "off", copyOnly)) === shape({ direct: false }))
  check("a server that offers nothing records nothing",
    shape(withHoverPreviewSlot({}, "off", null)) === shape({})
      && shape(withHoverPreviewSlot({}, "originals", HOVER_PREVIEW_OFF)) === shape({}))
  // ...and a preference that records nothing is not WRITTEN at all: storing
  // `{}` would leave a key meaning exactly what its absence means, minted by a
  // click that did nothing (verifier round 2, B5).
  check("a preference with no slots is empty, and is never persisted",
    isEmptyHoverPreviewPref(withHoverPreviewSlot({}, "off", null)) === true
      && isEmptyHoverPreviewPref(
        withHoverPreviewSlot({}, "originals", HOVER_PREVIEW_OFF)) === true)
  check("...while one with either slot is not",
    isEmptyHoverPreviewPref({ direct: false }) === false
      && isEmptyHoverPreviewPref({ transcode: true }) === false
      && isEmptyHoverPreviewPref(
        withHoverPreviewSlot({}, "off", can(false, true, false))) === false)
  check("a stale transcode slot is CLEARED when the server stops offering it",
    shape(withHoverPreviewSlot({ direct: true, transcode: false }, "originals", noEncode))
      === shape({ direct: true }))
  check("a server that LATER allows the encode reaches the user",
    resolveHoverPreview(allowed,
      withHoverPreviewSlot({}, "originals", noEncode)) === can(true, true, true))
  check("...but a deliberate Originals on an offering server still holds",
    resolveHoverPreview(allowed,
      withHoverPreviewSlot({}, "originals", allowed)) === can(true, true, false))
  // The control lights the EFFECTIVE answer (D4's rule).
  check("the lit segment follows the RESOLVED answer",
    hoverPreviewChoice(HOVER_PREVIEW_OFF) === "off"
      && hoverPreviewChoice(can(true, true, false)) === "originals"
      && hoverPreviewChoice(can(false, true, false)) === "originals"
      && hoverPreviewChoice(can(true, true, true)) === "all")
  check("a stored All against a transcode-denying server lights Originals",
    hoverPreviewChoice(resolveHoverPreview(noEncode,
      withHoverPreviewSlot({}, "all", noEncode))) === "originals")
}

// ---------------------------------------------------------------------------
// The mp4 stream-copy question
// ---------------------------------------------------------------------------

console.log("\n== can the video stream play inside an mp4? ==")
{
  const asks = (item) => videoCodecPlayableInMp4(item, { canPlayType: chrome })
  // THE CASE THE RUNG EXISTS FOR: unplayable as a file, playable as a copy.
  check("h264 in a .mkv is eligible — the copy makes it an mp4",
    asks({ type: "video/x-matroska", video_codec: "h264" }) === true)
  check("h264 already in an mp4 is eligible too (the trim is still a copy)",
    asks({ type: "video/mp4", video_codec: "h264" }) === true)
  // AUDIO IS NOT ASKED: the preset emits -an, so a track that vetoes the whole
  // file in the playability ladder cannot veto the copy.
  check("an AC-3 soundtrack does not disqualify the copy — it is dropped",
    asks({ type: "video/quicktime", video_codec: "h264", audio_codec: "ac3" }) === true)
  // A codec the browser plays that mp4 CANNOT CARRY. The browser's own answer
  // for the mp4 container is what rules it out, so nothing here keeps a list.
  check("VP8 is NOT eligible: mp4 cannot carry it, however well WebM plays it",
    chrome('video/webm; codecs="vp8"') === "probably"
      && asks({ type: "video/webm", video_codec: "vp8" }) === false)
  check("a codec this browser cannot decode at all is not eligible",
    asks({ type: "video/mp4", video_codec: "hevc" }) === false)
  check("a codec with no RFC 6381 string on this side is not eligible",
    asks({ type: "video/mpeg", video_codec: "mpeg2video" }) === false)
  // NOT SETTLED IS NOT ELIGIBLE: a remux is a promise about bytes.
  check("an unprobed row is not eligible",
    asks({ type: "video/mp4", video_codec: null }) === false)
  check("the two sentinels are not eligible",
    asks({ type: "video/mp4", video_codec: "none" }) === false
      && asks({ type: "video/mp4", video_codec: "unknown" }) === false)
  check("no probe at all is not eligible",
    videoCodecPlayableInMp4({ type: "video/mp4", video_codec: "h264" },
      { canPlayType: null }) === false)
}

// ---------------------------------------------------------------------------
// The byte cap and the slice estimate
// ---------------------------------------------------------------------------

console.log("\n== the cap and the slice estimate ==")
{
  check("the cap is inclusive", withinPreviewCap(CAP, CAP) === true
    && withinPreviewCap(CAP + 1, CAP) === false)
  check("zero bytes are inside every cap", withinPreviewCap(0, CAP) === true)
  // UNKNOWN IS NOT INSIDE: the cap exists because an unbounded hover pulled
  // two thirds of a 15.7 MB file, so a row nobody measured goes to a rung
  // whose cost is known.
  check("an unknown size is NOT inside the cap",
    withinPreviewCap(null, CAP) === false
      && withinPreviewCap(undefined, CAP) === false
      && withinPreviewCap(Number.NaN, CAP) === false)
  check("a negative size is not inside it either",
    withinPreviewCap(-1, CAP) === false)

  check("the slice is the file's own average rate over the kept window",
    previewSliceBytes(40_000_000, 64) === 10_000_000,
    String(previewSliceBytes(40_000_000, 64)))
  check("a file inside the window is its whole self",
    previewSliceBytes(9_000_000, 8) === 9_000_000
      && previewSliceBytes(9_000_000, PREVIEW_MAX_SECONDS) === 9_000_000)
  check("no duration, no estimate",
    previewSliceBytes(40_000_000, null) === null
      && previewSliceBytes(40_000_000, 0) === null
      && previewSliceBytes(40_000_000, -3) === null
      && previewSliceBytes(40_000_000, Number.POSITIVE_INFINITY) === null)
  check("no size, no estimate", previewSliceBytes(null, 64) === null)
  // THE BOUNDARY, both sides of it: a slice exactly at the cap is eligible.
  const atCap = { size: CAP * 4, duration: PREVIEW_MAX_SECONDS * 4 }
  check("a slice EXACTLY at the cap is inside it",
    previewSliceBytes(atCap.size, atCap.duration) === CAP
      && withinPreviewCap(previewSliceBytes(atCap.size, atCap.duration), CAP))
  check("...and one byte more is not",
    withinPreviewCap(previewSliceBytes(atCap.size + 4, atCap.duration), CAP) === false)
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

console.log("\n== the rung ladder ==")
{
  const ladder = (input, capability) => previewLadder(input, capability).join(">")
  // A 4 MB thirty-second clip: inside the cap whole, and its first 16 s are
  // inside it too, so every rung is on offer and the ORDER is what is asserted.
  const small = { size: 4_000_000, duration: 30 }
  // 400 MB in a minute — over the cap whole AND over it sliced (106 MB), which
  // is the only shape that reaches the re-encode on size alone.
  const dense = { size: 400_000_000, duration: 60 }
  // 400 MB over ten minutes: far over the cap whole, 10.7 MB sliced.
  const bigButThin = { size: 400_000_000, duration: 600 }

  check("a small playable file takes the original whole, then the copy, then the encode",
    ladder({ playability: "playable", mp4Playable: true, ...small },
      can(true, true, true)) === "direct>trim>transcode")
  // THE DEFECT THIS LADDER FIXES: a big file no longer mounts whole.
  check("a file over the cap skips the whole-file rung",
    ladder({ playability: "playable", mp4Playable: true, ...bigButThin },
      can(true, true, true)) === "trim>transcode",
    `slice ${previewSliceBytes(bigButThin.size, bigButThin.duration)} vs cap ${CAP}`)
  check("...and one whose first 16 s are ALSO over it skips the copy as well",
    ladder({ playability: "playable", mp4Playable: true, ...dense },
      can(true, true, true)) === "transcode",
    `slice ${previewSliceBytes(dense.size, dense.duration)} vs cap ${CAP}`)
  check("an unplayable container whose stream mp4 can carry takes the copy",
    ladder({ playability: "needs-transcode", mp4Playable: true, ...small },
      can(true, true, true)) === "trim>transcode")
  check("a codec mp4 cannot carry skips the copy",
    ladder({ playability: "needs-transcode", mp4Playable: false, ...small },
      can(true, true, true)) === "transcode")
  // UNKNOWN DURATION NEVER TRIMS: there is no ratio, so no estimate.
  check("an unknown duration never trims",
    ladder({ playability: "needs-transcode", mp4Playable: true, size: 4_000_000,
      duration: null }, can(true, true, true)) === "transcode")
  check("an unknown size takes neither own-bytes rung",
    ladder({ playability: "playable", mp4Playable: true, size: null, duration: 30 },
      can(true, true, true)) === "transcode")
  // AN UNSUPPORTED ITEM HAS NOTHING TO SHOW — not even a re-encode.
  check("an unsupported item has an EMPTY ladder",
    ladder({ playability: "unsupported", mp4Playable: true, ...small },
      can(true, true, true)) === "")
  // The capability gates, one at a time.
  check("previews off means an empty ladder whatever the file",
    ladder({ playability: "playable", mp4Playable: true, ...small },
      HOVER_PREVIEW_OFF) === "")
  check("Originals drops the encode from the end of the ladder",
    ladder({ playability: "playable", mp4Playable: true, ...small },
      can(true, true, false)) === "direct>trim")
  check("...and leaves a needs-transcode item with only the copy",
    ladder({ playability: "needs-transcode", mp4Playable: true, ...small },
      can(true, true, false)) === "trim")
  check("...and with nothing at all when mp4 cannot carry it",
    ladder({ playability: "needs-transcode", mp4Playable: false, ...small },
      can(true, true, false)) === "")
  check("a server offering only the copy never mounts the whole file",
    ladder({ playability: "playable", mp4Playable: true, ...small },
      can(false, true, true)) === "trim>transcode")
  check("a server offering only the whole file never asks for a copy",
    ladder({ playability: "playable", mp4Playable: true, ...small },
      can(true, false, true)) === "direct>transcode")
  // BLOCKED RUNGS are simply absent — this is how a session downgrade reaches
  // the ladder.
  check("a blocked direct rung falls to the copy",
    ladder({ playability: "playable", mp4Playable: true, ...small,
      blocked: ["direct"] }, can(true, true, true)) === "trim>transcode")
  check("a blocked copy falls to the encode",
    ladder({ playability: "needs-transcode", mp4Playable: true, ...small,
      blocked: ["trim"] }, can(true, true, true)) === "transcode")
  check("every rung blocked is an empty ladder",
    ladder({ playability: "playable", mp4Playable: true, ...small,
      blocked: ["direct", "trim", "transcode"] }, can(true, true, true)) === "")
  check("an unknown size still leaves the copy when the slice fits",
    ladder({ playability: "playable", mp4Playable: true, size: null, duration: 30 },
      can(true, true, true)) === "transcode")
  check("the first rung is what `previewRung` answers",
    previewRung({ playability: "playable", mp4Playable: true, ...small },
      can(true, true, true)) === "direct"
      && previewRung({ playability: "unsupported", mp4Playable: true, ...small },
        can(true, true, true)) === "none")
}

console.log("\n== the cell's whole question (cellPreviewLadder) ==")
{
  clearPreviewRungFailures()
  const rungs = (row, capability) =>
    cellPreviewLadder(row, capability, chrome).join(">")
  const all = can(true, true, true)
  const mp4 = {
    sha256: "aaa", type: "video/mp4", video_codec: "h264", audio_codec: "aac",
    size: 4_000_000, duration: 30,
  }
  const bigMp4 = { ...mp4, sha256: "bbb", size: 400_000_000, duration: 60 }
  const thinMkv = {
    sha256: "ccc", type: "video/x-matroska", video_codec: "h264",
    audio_codec: "ac3", size: 40_000_000, duration: 640,
  }
  const hevc = {
    sha256: "ddd", type: "video/mp4", video_codec: "hevc", audio_codec: "aac",
    size: 4_000_000, duration: 30,
  }
  const image = { sha256: "eee", type: "image/png", size: 900_000 }
  check("a small h264 mp4 mounts itself",
    rungs(mp4, all) === "direct>trim>transcode")
  check("a huge one goes to the encode (its first 16 s are still over the cap)",
    rungs(bigMp4, all) === "transcode")
  check("an h264 .mkv with AC-3 audio takes the silent stream copy",
    rungs(thinMkv, all) === "trim>transcode")
  check("HEVC this browser cannot decode goes to the encode",
    rungs(hevc, all) === "transcode")
  check("a still image is never a preview, whatever is allowed",
    rungs(image, all) === "")
  check("a null row is never a preview", rungs(null, all) === "")
  // THE SHORT CIRCUIT: with previews off the ladder is not consulted at all,
  // which is what keeps a grid of stills from probing a codec per card.
  const explodes = () => { throw new Error("the probe must not run") }
  check("previews off short-circuit BEFORE the codec probe",
    cellPreviewLadder(mp4, HOVER_PREVIEW_OFF, explodes).length === 0)
  check("a non-video short-circuits before the probe too",
    cellPreviewLadder(image, all, explodes).length === 0)
  // ...and the mp4 question is only asked when the copy is on offer.
  const noMp4Probe = (type) => {
    if (/^video\/mp4; codecs="avc1/.test(type)) throw new Error("mp4 probe ran")
    return chrome(type)
  }
  check("the mp4 question is not asked when the copy is denied",
    cellPreviewRung(thinMkv, can(true, false, true), noMp4Probe) === "transcode")
}

console.log("\n== session downgrades ==")
{
  clearPreviewRungFailures()
  const all = can(true, true, true)
  const rungs = (row) => cellPreviewLadder(row, all, chrome).join(">")
  // A small playable mp4 whose first 16 s also fit, so every rung is on offer
  // and the walk down is visible one step at a time.
  const item = {
    sha256: "walk", type: "video/mp4", video_codec: "h264", audio_codec: "aac",
    size: 4_000_000, duration: 30,
  }
  check("it starts on the whole file", rungs(item) === "direct>trim>transcode")
  // A DECODE ERROR ON THE ORIGINAL falls to the COPY, not past it: a container
  // this browser mis-parses is exactly what a remux fixes.
  notePreviewRungFailure(item.sha256, "direct")
  check("a failed direct rung falls to the stream copy",
    rungs(item) === "trim>transcode")
  // A REFUSED MUX falls to the re-encode.
  notePreviewRungFailure(item.sha256, "trim")
  check("a failed copy falls to the re-encode", rungs(item) === "transcode")
  notePreviewRungFailure(item.sha256, "transcode")
  check("a failed re-encode leaves nothing", rungs(item) === "")
  check("...and none of it touched a different item",
    rungs({ ...item, sha256: "other" }) === "direct>trim>transcode")
  // Only the copy is denied, so the direct rung is untouched.
  clearPreviewRungFailures()
  notePreviewRungFailure(item.sha256, "trim")
  check("a failed copy alone does not cost the whole-file rung",
    rungs(item) === "direct>transcode")
  clearPreviewRungFailures()
  // THE GALLERY'S OWN DOWNGRADE is the same evidence about the same bytes, so
  // it blocks the same rung — and, deliberately, only that one.
  clearPreviewRungFailures()
  noteVideoPlaybackError(item.sha256)
  check("a gallery decode downgrade blocks the whole-file rung",
    rungs(item) === "trim>transcode")
  check("...and leaves the encode when the copy is denied too",
    cellPreviewLadder(item, can(true, false, true), chrome).join(">") === "transcode")
  clearPreviewRungFailures()
}

console.log("\n== the arm walks a FROZEN ladder (B1) ==")
{
  // TWO SUBTRACTIONS THAT MUST NOT COMPOUND. The host re-plans on any render
  // — one lands milliseconds after a failure, because publishing the badge's
  // progress sets host state — and its plan already subtracts the session map.
  // If the arm ALSO advanced an index into that live plan, the failed rung
  // would come off twice and the walk would land one PAST its fallback.
  clearPreviewRungFailures()
  const sha = "frozen"
  const hostPlan = ["trim", "transcode"]

  // What the arm takes at its mount: the plan minus what is already known bad.
  const armed = previewArmLadder(hostPlan, previewRungFailures(sha))
  check("the arm starts on the host's whole ladder when nothing has failed",
    armed.join(">") === "trim>transcode", armed.join(">"))
  check("...and the walk starts at its first rung",
    rungAtStep(armed, 0) === "trim")

  // The trim rung now fails. The component records it AND steps — and the
  // snapshot must not move under it.
  notePreviewRungFailure(sha, "trim")
  check("recording a failure does NOT move the arm's frozen ladder",
    armed.join(">") === "trim>transcode", armed.join(">"))
  // THE REGRESSION, both sides of it spelled out: the frozen ladder falls to
  // the encode, while a freshly re-derived one at the same step is `undefined`
  // — the two-rung shape in which the cell used to die for the session.
  check("a two-rung ladder falls to its SECOND rung, not off the end",
    rungAtStep(armed, 1) === "transcode", rungAtStep(armed, 1))
  check("...whereas re-deriving mid-walk would have skipped it (the old bug)",
    rungAtStep(previewArmLadder(hostPlan, previewRungFailures(sha)), 1) === "none")

  // The map still decides where the NEXT arm begins — which is all "never
  // retry a failed rung" ever meant.
  check("the next arm begins past the recorded failure",
    previewArmLadder(hostPlan, previewRungFailures(sha)).join(">") === "transcode")

  // The three-rung shape: one step at a time, nothing skipped.
  clearPreviewRungFailures()
  const three = previewArmLadder(["direct", "trim", "transcode"],
    previewRungFailures(sha))
  check("a three-rung ladder walks one step at a time",
    rungAtStep(three, 0) === "direct"
      && rungAtStep(three, 1) === "trim"
      && rungAtStep(three, 2) === "transcode")
  check("...and walking off the end is `none`, never `undefined`",
    rungAtStep(three, 3) === "none" && rungAtStep(three, 99) === "none")

  // The snapshot's own filtering.
  check("the snapshot drops every rung already recorded",
    previewArmLadder(["direct", "trim", "transcode"],
      new Set(["direct", "transcode"])).join(">") === "trim")
  check("a fully-failed plan snapshots to nothing",
    previewArmLadder(["direct", "trim"], new Set(["direct", "trim"])).length === 0)
  check("...and `none` is never a rung to walk",
    previewArmLadder(["none"], new Set()).length === 0)
  clearPreviewRungFailures()
}

console.log("\n== a teardown is not a rung failure ==")
{
  // The hazard: letting go of the arm unmounts the <video>, and unmounting it
  // runs `abortVideo` — clear `src`, call `load()` — which the media load
  // algorithm may answer with an `error`. Recording THAT would demote the item
  // for the whole session because the pointer moved.
  check("an element error while the arm is HELD is evidence",
    shouldRecordFailure({ released: false, rung: "direct" }) === true
      && shouldRecordFailure({ released: false, rung: "trim" }) === true
      && shouldRecordFailure({ released: false, rung: "transcode" }) === true)
  check("an element error after the cell RELEASED is ignored",
    shouldRecordFailure({ released: true, rung: "direct" }) === false
      && shouldRecordFailure({ released: true, rung: "trim" }) === false
      && shouldRecordFailure({ released: true, rung: "transcode" }) === false)
  // Walked off the end of the ladder: no element, so nothing to blame.
  check("an error with no rung is never evidence",
    shouldRecordFailure({ released: false, rung: "none" }) === false
      && shouldRecordFailure({ released: true, rung: "none" }) === false)
}

// ---------------------------------------------------------------------------
// V3/V4: the request and its key
// ---------------------------------------------------------------------------

console.log("\n== the preview request (V3) ==")
{
  check("the cap is 16 s, spelled in both units",
    PREVIEW_MAX_SECONDS === 16 && PREVIEW_MAX_CS === 1600,
    `${PREVIEW_MAX_SECONDS}s / ${PREVIEW_MAX_CS}cs`)
  check("the two presets are the settled ids",
    PREVIEW_PRESET === "preview" && PREVIEW_TRIM_PRESET === "preview-trim")
  check("a file longer than the cap carries end_cs",
    shape(previewRequest({ duration: 16.01 }))
      === shape({ preset: PREVIEW_PRESET, end_cs: PREVIEW_MAX_CS }))
  check("a file exactly at the cap does NOT (the whole file is one key)",
    shape(previewRequest({ duration: 16 })) === shape({ preset: PREVIEW_PRESET }))
  check("a short file does not either",
    shape(previewRequest({ duration: 3 })) === shape({ preset: PREVIEW_PRESET }))
  // Not "> 16" by the letter, and deliberately: an unknown duration is the one
  // case where omitting the bound could hand ffmpeg a two-hour film.
  check("an UNKNOWN duration sends the bound rather than the whole file",
    shape(previewRequest({ duration: null }))
      === shape({ preset: PREVIEW_PRESET, end_cs: PREVIEW_MAX_CS })
      && shape(previewRequest({}))
        === shape({ preset: PREVIEW_PRESET, end_cs: PREVIEW_MAX_CS }))
  check("a zero or negative duration is unknown, not short",
    shape(previewRequest({ duration: 0 }))
      === shape({ preset: PREVIEW_PRESET, end_cs: PREVIEW_MAX_CS }))
  // THE STREAM COPY asks for the same window under a different preset.
  check("the trim rung names the copy preset and the same window",
    shape(previewRequest({ duration: 60 }, "trim"))
      === shape({ preset: PREVIEW_TRIM_PRESET, end_cs: PREVIEW_MAX_CS }))
  check("...and omits the window on a file already inside it",
    shape(previewRequest({ duration: 5 }, "trim"))
      === shape({ preset: PREVIEW_TRIM_PRESET }))
  check("the two rungs are two keys, so a copy and an encode never collide",
    previewKey("sha", previewRequest({ duration: 60 }, "trim"))
      === "sha:preview-trim:e1600"
      && previewKey("sha", previewRequest({ duration: 60 }, "transcode"))
        === "sha:preview:e1600",
    previewKey("sha", previewRequest({ duration: 60 }, "trim")))
  check("...and does not carry the window when it is not asked for",
    previewKey("sha", previewRequest({ duration: 5 })) === "sha:preview")
  check("an untrimmed key is byte-identical to the two-segment form every "
    + "other caller mints",
    transcodeKey("sha", "playback") === "sha:playback"
      && transcodeKey("sha", "playback", null) === "sha:playback"
      && transcodeKey("sha", "playback", 1600) === "sha:playback:e1600")
}

// ---------------------------------------------------------------------------
// V4: cancel only what this client created
// ---------------------------------------------------------------------------

console.log("\n== cancel-only-if-created (V4) ==")
{
  check("a CREATED outcome is this client's job", createdOwnJob({ outcome: "created" }))
  check("a JOINED one is somebody else's",
    createdOwnJob({ outcome: "joined" }) === false)
  check("a cache HIT has no job at all",
    createdOwnJob({ outcome: "hit" }) === false)
  check("a known_failure is not ours to cancel",
    createdOwnJob({ outcome: "known_failure" }) === false)
  check("an unreadable payload is never ours (the safe direction)",
    createdOwnJob(null) === false
      && createdOwnJob({}) === false
      && createdOwnJob({ outcome: 7 }) === false)
  const key = transcodeKey("zzz", PREVIEW_PRESET, PREVIEW_MAX_CS)
  check("a key with no submit behind it owns no job",
    ownsTranscodeJob(key) === false)
  setTranscodeState(key, { state: "queued", position: 3 })
  cancelTranscode(key)
  check("cancelling returns the key to idle",
    getTranscodeState(key).state === "idle")
  check("...so a re-hover may submit again", shouldSubmit(getTranscodeState(key)))
  // A DONE key is left alone entirely: the artifact is cached, which is the
  // whole point of having run the job.
  const done = transcodeKey("yyy", PREVIEW_PRESET)
  setTranscodeState(done, {
    state: "done", artifactUrl: "/api/video/artifact?key=k", filename: null, artifact: null,
  })
  cancelTranscode(done)
  check("cancelling a DONE key changes nothing",
    getTranscodeState(done).state === "done")
}

console.log("\n== a cancel leaves nothing behind (S3) ==")
{
  const size = () => transcodeStoreSize()
  const before = size()
  // The pointer resting on one cell and leaving, over and over.
  for (let i = 0; i < 200; i += 1) {
    const key = transcodeKey("same", PREVIEW_TRIM_PRESET, PREVIEW_MAX_CS)
    setTranscodeState(key, { state: "queued", position: 1 })
    cancelTranscode(key)
  }
  check("200 cancels of ONE key leave the store exactly as it was",
    shape(size()) === shape(before), `${shape(before)} -> ${shape(size())}`)
  // ...and a skim across a library, which is the shape that made this a leak:
  // one distinct key per cell the pointer rested on.
  for (let i = 0; i < 200; i += 1) {
    const key = transcodeKey(`sha${i}`, PREVIEW_PRESET, PREVIEW_MAX_CS)
    setTranscodeState(key, { state: "running", progress: 0.1 })
    cancelTranscode(key)
  }
  check("200 cancels of 200 DISTINCT keys leave the store exactly as it was",
    shape(size()) === shape(before), `${shape(before)} -> ${shape(size())}`)
  check("...and each of them reads idle and may submit again",
    getTranscodeState(transcodeKey("sha7", PREVIEW_PRESET, PREVIEW_MAX_CS)).state === "idle"
      && shouldSubmit(getTranscodeState(
        transcodeKey("sha7", PREVIEW_PRESET, PREVIEW_MAX_CS))))
}

console.log("\n== a cancel DURING the POST is not a verdict (S3/V4) ==")
{
  // The one writer a cancel cannot stop synchronously: a request already on
  // the wire. Here it is a fetch of a relative URL under plain node, which
  // fails — and the point is precisely that its failure must NOT be recorded,
  // because by then the state belongs to nobody.
  const before = transcodeStoreSize()
  const key = startTranscode({
    sha256: "inflight",
    dbs: { index_db: "stdtest", user_data_db: null },
    preset: PREVIEW_TRIM_PRESET,
    endCs: PREVIEW_MAX_CS,
  })
  check("a submit claims the key", getTranscodeState(key).state === "requesting")
  cancelTranscode(key)
  check("cancelling mid-POST returns it to idle at once",
    getTranscodeState(key).state === "idle")
  check("...and drops the bookkeeping in the same breath",
    shape(transcodeStoreSize()) === shape(before),
    `${shape(before)} -> ${shape(transcodeStoreSize())}`)
  // Let the doomed request settle.
  await new Promise((resolve) => setTimeout(resolve, 250))
  check("the failed POST does not land as a verdict on the item",
    getTranscodeState(key).state === "idle",
    getTranscodeState(key).state)
  check("...and still leaves the store as it was",
    shape(transcodeStoreSize()) === shape(before),
    `${shape(before)} -> ${shape(transcodeStoreSize())}`)
  check("so the next dwell may submit again", shouldSubmit(getTranscodeState(key)))
}

// ---------------------------------------------------------------------------
// V11: what the badge says
// ---------------------------------------------------------------------------

console.log("\n== the badge's progress and caption (V11) ==")
{
  check("a POST in flight is an indeterminate sweep",
    shape(previewFeedback({ state: "requesting" }))
      === shape({ progress: "queued", caption: "Transcoding…" }))
  check("a queued job names its position through the shared formatter",
    shape(previewFeedback({ state: "queued", position: 2 }))
      === shape({ progress: "queued", caption: "Queued #2" }))
  check("a running job fills the ring",
    shape(previewFeedback({ state: "running", progress: 0.4 }))
      === shape({ progress: 0.4, caption: "Transcoding…" }))
  check("a running job with no measurable progress sweeps instead",
    shape(previewFeedback({ state: "running", progress: null }))
      === shape({ progress: "queued", caption: "Transcoding…" }))
  check("idle and done say nothing",
    previewFeedback({ state: "idle" }) === null
      && previewFeedback({
        state: "done", artifactUrl: "u", filename: null, artifact: null,
      }) === null)
  // A failure shows NOTHING: it is the ladder's cue to fall to the next rung,
  // and a stalled ring under a thumbnail says less than the frame already does.
  check("a failure shows nothing",
    previewFeedback({ state: "failed", error: "boom", sticky: true }) === null)
}

// ---------------------------------------------------------------------------
// V8: what the client config publishes
// ---------------------------------------------------------------------------

console.log("\n== client-config normalization (V8) ==")
{
  const derive = (hover_preview) => deriveClientConfig({
    capabilities: {},
    client: {},
    hover_preview,
  }).hoverPreview
  const full = { direct: true, trim: true, transcode: false, max_bytes: CAP }
  check("a complete answer is passed through",
    shape(derive(full))
      === shape({ direct: true, trim: true, transcode: false, maxBytes: CAP }))
  check("all-false is a REPORTED denial, not an absence",
    shape(derive({ direct: false, trim: false, transcode: false, max_bytes: 0 }))
      === shape({ direct: false, trim: false, transcode: false, maxBytes: 0 }))
  // ALL FOUR OR NOTHING. The cap is the member that matters most: without a
  // number there is nothing to measure a file against, which is the defect the
  // cap exists to fix.
  check("a missing CAP reads as not reported",
    derive({ direct: true, trim: true, transcode: true }) === null)
  check("a missing rung reads as not reported",
    derive({ direct: true, transcode: true, max_bytes: CAP }) === null)
  check("a non-boolean rung reads as not reported",
    derive({ ...full, trim: "yes" }) === null)
  check("a non-numeric or negative cap reads as not reported",
    derive({ ...full, max_bytes: "16MiB" }) === null
      && derive({ ...full, max_bytes: -1 }) === null)
  check("an absent field reads as not reported (an older Server)",
    derive(undefined) === null && derive(null) === null)
  check("a non-object reads as not reported", derive(true) === null)
}

// ---------------------------------------------------------------------------
// V12: the frame swap, as it reaches the plan
// ---------------------------------------------------------------------------

console.log("\n== the V12 frame swap ==")
{
  const dbs = { index_db: "stdtest", user_data_db: null }
  const env = (smallCell) => ({
    animatedFloor: { maxFileSize: 1024 * 1024, maxSide: 512 },
    displayLoopTrigger: { maxBytes: 5 * 1024 * 1024, maxShortSide: 4096, maxPixels: 24_000_000 },
    smallCell,
  })
  const video = {
    sha256: "abc", type: "video/mp4", duration: 42,
    size: 20_000_000, width: 1920, height: 1080,
  }
  const plan = (smallCell, rungs) =>
    planCellPicture(video, dbs, "grid-s", env(smallCell), rungs)

  // PREVIEWS OFF: byte for byte the cells that shipped before this existed.
  check("previews off, small cell: today's frame->mosaic swap",
    plan(true, []).kind === "videoSmall")
  check("previews off, large cell: today's plain still",
    plan(false, []).kind === "still")
  check("...and the small cell's two URLs are still the frame and the mosaic",
    plan(true, []).frame.includes("&big=false")
      && !plan(true, []).mosaic.includes("big=false"))

  // PREVIEWS ON, SMALL CELL: never swaps to the 2x2 — the same URL twice, so
  // the card mounts no second layer and binds no listeners for it.
  const small = plan(true, ["direct", "transcode"])
  check("previews on, small cell: one video plan", small.kind === "video")
  check("...whose base picture IS the single frame",
    small.poster.includes("&big=false"))
  check("...and which therefore never swaps (poster === frame)",
    small.poster === small.frame)

  // PREVIEWS ON, LARGE CELL: the 2x2 base swaps to the 1x1 on hover.
  const large = plan(false, ["direct", "transcode"])
  check("previews on, large cell: one video plan", large.kind === "video")
  check("...whose base picture is the 2x2 mosaic",
    !large.poster.includes("big=false"))
  check("...and whose hover placeholder is the single frame",
    large.frame.includes("&big=false") && large.poster !== large.frame)

  // The direct rung names the ORIGINAL file; the job rungs have no URL until
  // their job is done.
  check("a ladder containing the direct rung carries the original file URL",
    typeof large.directSrc === "string"
      && large.directSrc.includes("/api/items/item/file"),
    String(large.directSrc))
  check("a ladder without it carries no src at plan time",
    plan(false, ["trim", "transcode"]).directSrc === null
      && plan(false, ["transcode"]).directSrc === null)
  check("the ladder rides in the plan, in order",
    plan(false, ["trim", "transcode"]).rungs.join(">") === "trim>transcode")

  // An EXTREME-ASPECT video: the crop becomes the preview picture and the
  // whole-image swap stands down, so one gesture has one owner.
  const strip = { ...video, width: 2560, height: 1080 }
  const stripPlan = (rungs) =>
    planCellPicture(strip, dbs, "grid-s", env(false), rungs)
  check("an extreme-aspect video with previews OFF keeps its image crop and swap",
    stripPlan([]).crop.kind === "image"
      && typeof stripPlan([]).displaySrc === "string")
  check("...and with previews ON gets a video crop and no swap",
    stripPlan(["direct"]).crop.kind === "video"
      && stripPlan(["direct"]).displaySrc === null)
  check("...whose crop never swaps either (there is no single-frame crop)",
    stripPlan(["direct"]).crop.poster === stripPlan(["direct"]).crop.frame)

  // A non-video row is untouched by any of it.
  const image = { sha256: "ddd", type: "image/png", size: 900_000, width: 800, height: 600 }
  check("a still image is never planned as a video cell",
    planCellPicture(image, dbs, "grid-s", env(true), ["direct"]).kind === "still")
}

finish()
