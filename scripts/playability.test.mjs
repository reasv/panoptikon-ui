// Assertions for the playability ladder in lib/videoPlayability.ts — §6 of
// docs/video-transcoding-design.md plus the audio-only rungs settled in the
// server review round. No test runner in this repo — run it directly from the
// ui root:
//
//   node --experimental-strip-types scripts/playability.test.mjs
//
// (the flag is what lets a .mjs import the .ts module; Node 22+). Exits
// non-zero on the first failing assertion set.

// videoPlayability imports its dependencies extensionless / via the "@/"
// alias, neither of which node's resolver knows; ts-hooks fills both in.
// register() has to run before the modules load, hence the dynamic import.
import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const { shouldDowngradeOnError, videoPlayability } = await import(
  "../lib/videoPlayability.ts"
)

let all = true
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `\n  ${detail}` : ""}`)
  all &&= !!ok
  return ok
}

// ---- injected browsers -------------------------------------------------
//
// `canPlayType` is the whole environment this module has, so each fake browser
// is just a predicate over the full `mime; codecs="..."` string. The strings
// are asserted verbatim (rather than matched loosely) because the mapping
// table IS the contract — a typo in a codec string is a silent demotion of
// every file using it.

const seen = []
function browser(accept) {
  return (type) => {
    seen.push(type)
    return accept(type) ? "probably" : ""
  }
}

// The common case: h264 + aac in anything, plus vp8/vp9/vorbis/opus in webm.
const mainstream = browser((type) =>
  type === 'video/mp4; codecs="avc1.42E01E"' ||
  type === 'video/mp4; codecs="mp4a.40.2"' ||
  type === 'video/quicktime; codecs="avc1.42E01E"' ||
  type === 'video/quicktime; codecs="mp4a.40.2"' ||
  type === 'video/webm; codecs="vp8"' ||
  type === 'video/webm; codecs="vp9"' ||
  type === 'video/webm; codecs="opus"' ||
  type === 'video/webm; codecs="vorbis"'
)

// The same browser with hardware HEVC (Safari, or Chrome on a machine with a
// HEVC decoder): the identical file must NOT be transcoded there.
const withHevc = browser((type) =>
  type === 'video/mp4; codecs="hvc1.1.6.L93.B0"' ||
  type === 'video/mp4; codecs="mp4a.40.2"'
)

const on = (canPlayType) => ({ transcodeEnabled: true, canPlayType })
const off = (canPlayType) => ({ transcodeEnabled: false, canPlayType })

// ---- not a video -------------------------------------------------------

check(
  "an image is unsupported",
  videoPlayability({ type: "image/png" }, on(mainstream)) === "unsupported"
)
check(
  "a missing item is unsupported",
  videoPlayability(null, on(mainstream)) === "unsupported"
)
check(
  "an audio/* item is unsupported (the video hosts never mount one)",
  videoPlayability(
    { type: "audio/mpeg", video_codec: null, audio_codec: "mp3" },
    on(mainstream)
  ) === "unsupported"
)

// ---- NULL codecs: the backfill window ----------------------------------
//
// Nothing may regress while `video_codec` is still NULL, so this branch is
// today's mime check, verbatim.

check(
  "NULL codecs: mp4 stays playable",
  videoPlayability(
    { type: "video/mp4", video_codec: null, audio_codec: null },
    on(mainstream)
  ) === "playable"
)
check(
  "NULL codecs: webm stays playable",
  videoPlayability({ type: "video/webm" }, on(mainstream)) === "playable"
)
check(
  "NULL codecs: mov becomes needs-transcode with the capability on",
  videoPlayability(
    { type: "video/quicktime", video_codec: null },
    on(mainstream)
  ) === "needs-transcode"
)
check(
  "NULL codecs: mov is unsupported with the capability off (today's behaviour)",
  videoPlayability(
    { type: "video/quicktime", video_codec: null },
    off(mainstream)
  ) === "unsupported"
)
check(
  "NULL codecs: a parameterised mime still matches (video/mp4; codecs=...)",
  videoPlayability({ type: "video/mp4; codecs=avc1" }, on(mainstream)) === "playable"
)
check(
  "no canPlayType at all (SSR) falls back to the mime check",
  videoPlayability(
    { type: "video/mp4", video_codec: "hevc" },
    { transcodeEnabled: true, canPlayType: null }
  ) === "playable"
)

// ---- known codecs: the RFC 6381 probe ----------------------------------

check(
  "h264+aac in mp4 is playable",
  videoPlayability(
    { type: "video/mp4", video_codec: "h264", audio_codec: "aac" },
    on(mainstream)
  ) === "playable"
)
check(
  "h264+aac in a .mov is playable — the container alone never decides",
  videoPlayability(
    { type: "video/quicktime", video_codec: "h264", audio_codec: "aac" },
    on(mainstream)
  ) === "playable"
)
check(
  "HEVC in mp4 is needs-transcode where the browser refuses it",
  videoPlayability(
    { type: "video/mp4", video_codec: "hevc", audio_codec: "aac" },
    on(mainstream)
  ) === "needs-transcode"
)
check(
  "the same HEVC file is playable where the browser accepts it",
  videoPlayability(
    { type: "video/mp4", video_codec: "hevc", audio_codec: "aac" },
    on(withHevc)
  ) === "playable"
)
check(
  "HEVC with the capability off loses its play button",
  videoPlayability(
    { type: "video/mp4", video_codec: "hevc", audio_codec: "aac" },
    off(mainstream)
  ) === "unsupported"
)
check(
  "the 'unknown' sentinel is needs-transcode, never unsupported",
  videoPlayability(
    { type: "video/mp4", video_codec: "unknown", audio_codec: "aac" },
    on(mainstream)
  ) === "needs-transcode"
)
check(
  "an unmapped video codec (wmv3) is needs-transcode — no client blocklist",
  videoPlayability(
    { type: "video/x-ms-wmv", video_codec: "wmv3", audio_codec: "wmav2" },
    on(mainstream)
  ) === "needs-transcode"
)
check(
  "codec names are matched case-insensitively",
  videoPlayability(
    { type: "VIDEO/MP4", video_codec: "H264", audio_codec: "AAC" },
    on(mainstream)
  ) === "playable"
)
check(
  "vp9 in webm probes the bare 'vp9' string",
  videoPlayability(
    { type: "video/webm", video_codec: "vp9", audio_codec: "opus" },
    on(mainstream)
  ) === "playable" && seen.includes('video/webm; codecs="vp9"')
)
check(
  "vp9 in mp4 probes the vp09.* string instead",
  videoPlayability(
    { type: "video/mp4", video_codec: "vp9", audio_codec: "aac" },
    on(browser((type) => type === 'video/mp4; codecs="vp09.00.10.08"'))
  ) === "needs-transcode"
)

// ---- the audio veto ----------------------------------------------------

check(
  "playable video + AC-3 audio is needs-transcode (the veto)",
  videoPlayability(
    { type: "video/quicktime", video_codec: "h264", audio_codec: "ac3" },
    on(mainstream)
  ) === "needs-transcode"
)
check(
  "playable video + raw PCM (unmapped) is needs-transcode",
  videoPlayability(
    { type: "video/quicktime", video_codec: "h264", audio_codec: "pcm_s16le" },
    on(mainstream)
  ) === "needs-transcode"
)
check(
  "the veto is suppressed with the capability off",
  videoPlayability(
    { type: "video/quicktime", video_codec: "h264", audio_codec: "pcm_s16le" },
    off(mainstream)
  ) === "unsupported"
)
check(
  "NULL audio never vetoes — the column conflates 'none' with 'unprobed'",
  videoPlayability(
    { type: "video/mp4", video_codec: "h264", audio_codec: null },
    on(mainstream)
  ) === "playable"
)

// ---- 'none': the audio-only rungs --------------------------------------
//
// An audio file in a video container plays in a <video> today and must keep
// playing; there is nothing to transcode either way, so the ladder answers
// playable or unsupported and never needs-transcode.

check(
  "'none' + aac is playable (audio-only in a video container)",
  videoPlayability(
    { type: "video/mp4", video_codec: "none", audio_codec: "aac" },
    on(mainstream)
  ) === "playable"
)
check(
  "'none' + NULL audio is unsupported",
  videoPlayability(
    { type: "video/mp4", video_codec: "none", audio_codec: null },
    on(mainstream)
  ) === "unsupported"
)
check(
  "'none' + an unmapped audio codec (pcm) is unsupported",
  videoPlayability(
    { type: "video/mp4", video_codec: "none", audio_codec: "pcm_s16le" },
    on(mainstream)
  ) === "unsupported"
)
check(
  "'none' + a mapped but unplayable audio codec is unsupported",
  videoPlayability(
    { type: "video/mp4", video_codec: "none", audio_codec: "flac" },
    on(mainstream)
  ) === "unsupported"
)
check(
  "'none' + aac is playable with the capability off too (nothing to transcode)",
  videoPlayability(
    { type: "video/mp4", video_codec: "none", audio_codec: "aac" },
    off(mainstream)
  ) === "playable"
)
check(
  "video_tracks === 0 alongside the sentinel changes nothing",
  videoPlayability(
    {
      type: "video/mp4",
      video_codec: "none",
      audio_codec: "aac",
      video_tracks: 0,
    },
    on(mainstream)
  ) === "playable"
)
check(
  "video_tracks === 0 with NULL codecs still uses the mime fallback",
  videoPlayability(
    { type: "video/mp4", video_codec: null, audio_codec: null, video_tracks: 0 },
    on(mainstream)
  ) === "playable"
)
// The sentinel is the sole authority, which is only observable when the two
// DISAGREE: a stale/wrong zero count must not route a real video down the
// audio-only rung, where the verdict can only be playable or unsupported and
// the transcode it needs is unreachable.
check(
  "a stale video_tracks === 0 never overrides a named video codec",
  videoPlayability(
    {
      type: "video/mp4",
      video_codec: "hevc",
      audio_codec: "aac",
      video_tracks: 0,
    },
    on(mainstream)
  ) === "needs-transcode"
)
check(
  "...and a playable one stays playable through the video rung",
  videoPlayability(
    {
      type: "video/quicktime",
      video_codec: "h264",
      audio_codec: "aac",
      video_tracks: 0,
    },
    on(mainstream)
  ) === "playable"
)

// ---- audio codecs with several spellings -------------------------------
//
// One codec, several names: mp3 is `mp4a.6B` to Safari and plain `mp3` to
// Chrome/Firefox, and either answer means the track plays.

const mp3AsObjectType = browser(
  (type) => type === 'video/mp4; codecs="mp4a.6B"'
)
const mp3AsBareName = browser((type) => type === 'video/mp4; codecs="mp3"')
check(
  "mp3 is playable via the RFC 6381 object type",
  videoPlayability(
    { type: "video/mp4", video_codec: "none", audio_codec: "mp3" },
    on(mp3AsObjectType)
  ) === "playable"
)
check(
  "mp3 is playable via the bare name too (any candidate is enough)",
  videoPlayability(
    { type: "video/mp4", video_codec: "none", audio_codec: "mp3" },
    on(mp3AsBareName)
  ) === "playable"
)
check(
  "a browser that accepts neither spelling still vetoes",
  videoPlayability(
    { type: "video/mp4", video_codec: "h264", audio_codec: "mp3" },
    on(browser((type) => type === 'video/mp4; codecs="avc1.42E01E"'))
  ) === "needs-transcode"
)

// ---- the in-session downgrade gate -------------------------------------
//
// The downgrade is permanent for the session and takes the source away from
// the player, so only the element's DECODE verdict may trigger it.

check(
  "a decode error downgrades",
  shouldDowngradeOnError({ code: 3 }) === true
)
check(
  "an aborted or network error never does",
  shouldDowngradeOnError({ code: 1 }) === false &&
    shouldDowngradeOnError({ code: 2 }) === false
)
check(
  "src-not-supported does not either — it cannot be told from a failed fetch",
  shouldDowngradeOnError({ code: 4 }) === false
)
check(
  "an error event with no MediaError at all is not evidence",
  shouldDowngradeOnError(null) === false &&
    shouldDowngradeOnError(undefined) === false
)

// ---- the hydration gate ------------------------------------------------
//
// `canPlayType: null` is how useVideoPlayability renders the FIRST client pass
// (and how the server renders every pass): an explicit "do not ask the
// browser", which must reach the legacy mime branch even where a probe exists.
// Omitting the option entirely still means "use this module's own element".

check(
  "an explicit null probe forces the legacy mime verdict",
  videoPlayability(
    { type: "video/mp4", video_codec: "hevc", audio_codec: "ac3" },
    { transcodeEnabled: true, canPlayType: null }
  ) === "playable" &&
    videoPlayability(
      { type: "video/quicktime", video_codec: "h264", audio_codec: "aac" },
      { transcodeEnabled: true, canPlayType: null }
    ) === "needs-transcode"
)

// ---- parity with the check this replaces -------------------------------
//
// The single most important property: for an item the backfill has not
// reached, the ladder is the old boolean.

const legacyCases = [
  ["video/mp4", true],
  ["video/webm", true],
  ["video/quicktime", false],
  ["video/x-matroska", false],
  ["image/png", false],
]
let parity = true
for (const [type, wasPlayable] of legacyCases) {
  const verdict = videoPlayability(
    { type, video_codec: null, audio_codec: null },
    on(mainstream)
  )
  // `needs-transcode` is the deliberate change on the false side: it shows a
  // play button where there was none. What must not change is which items are
  // playable WITHOUT a job.
  const nowPlayable = verdict === "playable"
  if (nowPlayable !== wasPlayable) {
    parity = false
    console.log(`  ${type}: was ${wasPlayable}, now ${verdict}`)
  }
}
check("NULL-codec verdicts match the mp4/webm check element for element", parity)

process.exit(all ? 0 : 1)
