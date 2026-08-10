import React from "react"

// Can this browser play this item's bytes, and if not, is a transcode the
// answer? (docs/video-transcoding-design.md §6.)
//
// This replaces the `type === "video/mp4" || type === "video/webm"` test that
// used to be duplicated in ImageGallery and GalleryPinBoard. That test was
// wrong in both directions at once: a `video/quicktime` holding plain
// h264+aac (which every browser plays) got no play button at all, while an
// HEVC-in-mp4 got one and then decoded to a silent black frame. The scan now
// stores ffprobe's `codec_name` per stream, so the question can be asked the
// only way it can be answered truthfully — `canPlayType` with an RFC 6381
// codecs string, against this browser, on this machine.
//
// Three verdicts:
//   playable        mount the ordinary <video> against the file URL
//   needs-transcode the play affordance starts a job and mounts the artifact
//   unsupported     no play affordance at all (today's behaviour for .mov)
//
// Everything here is pure and `canPlayType` is injectable, so the ladder is
// node-testable without a DOM (scripts/playability.test.mjs).

export type Playability = "playable" | "needs-transcode" | "unsupported"

// The subset of an item this needs. Deliberately structural: the gallery
// passes a `SearchResult` (whose select requests both codec columns) and the
// pin passes the `/api/items/item` record, which additionally carries
// `video_tracks`.
export interface PlayabilityItem {
  type?: string | null
  /**
   * ffprobe's video `codec_name`, or one of the two in-band sentinels:
   * `'none'` (probed, no video stream — an audio file in a video container,
   * or one holding nothing but cover art) and `'unknown'` (a stream exists,
   * ffprobe would not name it). NULL means *not probed yet*.
   */
  video_codec?: string | null
  /** ffprobe's first audio stream `codec_name`; NULL = none, or not probed. */
  audio_codec?: string | null
  /** Stream count from the item metadata, when the caller has it. */
  video_tracks?: number | null
}

export type CanPlayType = (type: string) => string

// Representative profile strings. Profiles are NOT stored (the columns hold
// `codec_name`, nothing else), so each entry is the standard compromise: the
// baseline-ish profile every decoder that supports the codec at all accepts.
// The known miss is a High-10 / 4:2:2 stream answering `probably` for the
// 8-bit string and then failing in the decoder; that is what the element's
// `error` event and the in-session downgrade below exist for.
//
// A codec ABSENT from these tables is not a verdict — it is "this client has
// no string for it", which resolves to needs-transcode. The server job is the
// only arbiter of untranscodable; there is deliberately no client blocklist.
const VIDEO_CODEC_STRINGS: Record<string, string> = {
  h264: "avc1.42E01E",
  hevc: "hvc1.1.6.L93.B0",
  av1: "av01.0.04M.08",
  vp8: "vp8",
  // Overridden for webm below: the modern `vp09.*` form is an ISO-BMFF
  // (mp4) spelling, and several browsers only answer for the bare `vp9`
  // inside a WebM container.
  vp9: "vp09.00.10.08",
  mpeg4: "mp4v.20.9",
  // wmv3 (and every other codec) is deliberately absent — see above.
}

const AUDIO_CODEC_STRINGS: Record<string, string> = {
  aac: "mp4a.40.2",
  opus: "opus",
  vorbis: "vorbis",
  mp3: "mp4a.6B",
  ac3: "ac-3",
  eac3: "ec-3",
  flac: "flac",
  // pcm_* is absent: a raw-PCM track in a .mov is the classic audio veto.
}

/** Probed, but the container has no video stream. */
export const CODEC_NONE = "none"
/** A stream exists; the indexing ffmpeg build would not name its codec. */
export const CODEC_UNKNOWN = "unknown"

function normalizeCodec(codec: string | null | undefined): string | null {
  if (typeof codec !== "string") return null
  const value = codec.trim().toLowerCase()
  return value ? value : null
}

// Mime without parameters, lowercased. `item.type` is used VERBATIM as the
// container half of the probe (`video/quicktime` and friends included): the
// per-browser answer for the real container is exactly the wanted truth, and
// normalizing .mov to video/mp4 would be this module inventing one.
function normalizeMime(type: string | null | undefined): string {
  if (typeof type !== "string") return ""
  return type.split(";")[0].trim().toLowerCase()
}

export function videoCodecString(codec: string, mime: string): string | null {
  if (codec === "vp9" && mime === "video/webm") return "vp9"
  return VIDEO_CODEC_STRINGS[codec] ?? null
}

export function audioCodecString(codec: string): string | null {
  return AUDIO_CODEC_STRINGS[codec] ?? null
}

function accepts(probe: CanPlayType, mime: string, codecs: string): boolean {
  const answer = probe(`${mime}; codecs="${codecs}"`)
  return answer === "probably" || answer === "maybe"
}

// The pre-codec-column check, kept verbatim as the NULL branch: an item the
// backfill has not reached yet must behave exactly as it did before any of
// this existed, or every library regresses for the length of the backfill.
function legacyMimeVerdict(mime: string, transcodeEnabled: boolean): Playability {
  if (mime === "video/mp4" || mime === "video/webm") return "playable"
  return transcodeEnabled ? "needs-transcode" : "unsupported"
}

function transcodeVerdict(transcodeEnabled: boolean): Playability {
  // Capability off collapses the tri-state to two: .mov keeps behaving
  // exactly as it does today (no play affordance), and HEVC-in-mp4 *changes*
  // from a play button that yields a black frame to no play button. Native
  // playability is never suppressed by this — a browser that decodes HEVC
  // still probes `playable` above and never reaches here.
  return transcodeEnabled ? "needs-transcode" : "unsupported"
}

// One reusable detached element. Creating one per call would allocate a media
// element per pin per render; `canPlayType` touches no resource and the
// element is never inserted, loaded or played.
let probeElement: HTMLVideoElement | null = null
function defaultCanPlayType(): CanPlayType | null {
  if (typeof document === "undefined") return null
  if (!probeElement) probeElement = document.createElement("video")
  const el = probeElement
  return (type: string) => {
    try {
      return el.canPlayType(type)
    } catch {
      return ""
    }
  }
}

/**
 * The ladder. `canPlayType` is injected by the tests; in the browser it is
 * this module's own detached element.
 *
 * On the server (and anywhere `document` is missing) there is no browser to
 * ask, so the legacy mime check answers for every item — which is precisely
 * the markup the pre-codec build rendered, so hydration has nothing to
 * disagree about beyond items whose verdict genuinely changed.
 */
export function videoPlayability(
  item: PlayabilityItem | null | undefined,
  options: { transcodeEnabled: boolean; canPlayType?: CanPlayType | null }
): Playability {
  const mime = normalizeMime(item?.type)
  // Not a video item at all: no play affordance, no job, nothing to decide.
  if (!mime.startsWith("video/")) return "unsupported"

  const probe = options.canPlayType ?? defaultCanPlayType()
  const videoCodec = normalizeCodec(item?.video_codec)
  if (!probe || videoCodec === null) {
    return legacyMimeVerdict(mime, options.transcodeEnabled)
  }

  const audioCodec = normalizeCodec(item?.audio_codec)

  // No video stream. This is NOT unsupported by itself: audio-only files in
  // video containers (and files whose only "video" stream is cover art) play
  // in a <video> today, and taking their play button away would be a
  // regression dressed up as a fix. So the audio track alone decides, probed
  // against the real container. `video_tracks === 0` from the item metadata
  // lands here too rather than short-circuiting: it says the same thing the
  // sentinel does, and the sentinel is the authority when they disagree.
  if (videoCodec === CODEC_NONE || item?.video_tracks === 0) {
    if (audioCodec === null) return "unsupported"
    const audio = audioCodecString(audioCodec)
    if (audio && accepts(probe, mime, audio)) return "playable"
    // An unmapped or unplayable audio codec with no video stream is not
    // worth a video transcode job — there is no picture to produce.
    return "unsupported"
  }

  const video = videoCodecString(videoCodec, mime)
  // Unmapped (including the `'unknown'` sentinel): the server decides.
  if (!video) return transcodeVerdict(options.transcodeEnabled)
  if (!accepts(probe, mime, video)) return transcodeVerdict(options.transcodeEnabled)

  // Audio veto: a playable picture with an unplayable soundtrack (AC-3 or
  // raw PCM in a .mov) is a silent video, which is a broken video. NULL audio
  // never vetoes — the column conflates "no audio stream" with "not probed",
  // so it is not evidence of anything.
  if (audioCodec !== null && audioCodec !== CODEC_NONE) {
    const audio = audioCodecString(audioCodec)
    if (!audio || !accepts(probe, mime, audio)) {
      return transcodeVerdict(options.transcodeEnabled)
    }
  }
  return "playable"
}

// ---- in-session recovery ----------------------------------------------
//
// The representative-profile compromise above can say `probably` for a stream
// this decoder cannot actually handle (High 10, 4:2:2, an exotic level). The
// element itself is the only thing that knows, and it says so exactly once:
// an `error` event on the mounted <video>. That demotes the sha to
// needs-transcode for the rest of the session, which turns the black frame
// into a transcode the user can start.
//
// Session-scoped on purpose (a module Set, not storage): the miss is a
// property of this browser *build*, and a reload is the cheapest possible
// re-test.
const downgradedShas = new Set<string>()
const downgradeListeners = new Set<() => void>()

/** Wire this to the mounted element's `error` event on a `playable` verdict. */
export function noteVideoPlaybackError(sha256: string | null | undefined) {
  if (!sha256 || downgradedShas.has(sha256)) return
  downgradedShas.add(sha256)
  for (const listener of downgradeListeners) listener()
}

export function isPlaybackDowngraded(sha256: string | null | undefined): boolean {
  return sha256 != null && downgradedShas.has(sha256)
}

function subscribeDowngrades(onChange: () => void): () => void {
  downgradeListeners.add(onChange)
  return () => {
    downgradeListeners.delete(onChange)
  }
}

/**
 * The hook both hosts use. `transcodeEnabled` comes from the client config
 * (`useVideoTranscodeEnabled`), passed in rather than read here so this module
 * stays free of the query client — and node-testable.
 */
export function useVideoPlayability(
  item: (PlayabilityItem & { sha256?: string | null }) | null | undefined,
  transcodeEnabled: boolean
): Playability {
  const sha = item?.sha256 ?? null
  const downgraded = React.useSyncExternalStore(
    subscribeDowngrades,
    () => sha != null && downgradedShas.has(sha),
    // The server never mounted an element, so nothing can have failed there
    () => false
  )
  const verdict = videoPlayability(item, { transcodeEnabled })
  // Only a `playable` verdict is ever downgraded: every other one already
  // routes through the transcode, and a failing ARTIFACT is the job's problem,
  // not evidence about the source.
  if (downgraded && verdict === "playable") return transcodeVerdict(transcodeEnabled)
  return verdict
}
