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

// Audio takes a LIST per codec, tried in order, because one spelling is not
// enough for mp3: `mp4a.6B` is the RFC 6381 form (and the one Safari answers
// for), while Chrome and Firefox answer for the bare `mp3` and shrug at the
// object-type form in some containers. Any candidate answering
// probably|maybe is a playable track — the strings are alternative names for
// one codec, not a set of requirements.
const AUDIO_CODEC_STRINGS: Record<string, readonly string[]> = {
  aac: ["mp4a.40.2"],
  opus: ["opus"],
  vorbis: ["vorbis"],
  mp3: ["mp4a.6B", "mp3"],
  ac3: ["ac-3"],
  eac3: ["ec-3"],
  flac: ["flac"],
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

/** Every spelling this browser might know the codec by, or null if unmapped. */
export function audioCodecStrings(codec: string): readonly string[] | null {
  return AUDIO_CODEC_STRINGS[codec] ?? null
}

function accepts(probe: CanPlayType, mime: string, codecs: string): boolean {
  const answer = probe(`${mime}; codecs="${codecs}"`)
  return answer === "probably" || answer === "maybe"
}

/** One codec, several names: any accepted spelling makes the track playable. */
function acceptsAny(
  probe: CanPlayType,
  mime: string,
  candidates: readonly string[]
): boolean {
  return candidates.some((codecs) => accepts(probe, mime, codecs))
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
  options: {
    transcodeEnabled: boolean
    /**
     * ABSENT means "use this module's own element"; an explicit `null` means
     * "there is no browser to ask" and forces the legacy mime branch. The two
     * are deliberately different: the hook passes null on the hydration pass,
     * where a probe exists but must not be consulted.
     */
    canPlayType?: CanPlayType | null
  }
): Playability {
  const mime = normalizeMime(item?.type)
  // Not a video item at all: no play affordance, no job, nothing to decide.
  if (!mime.startsWith("video/")) return "unsupported"

  const probe =
    options.canPlayType === undefined ? defaultCanPlayType() : options.canPlayType
  const videoCodec = normalizeCodec(item?.video_codec)
  if (!probe || videoCodec === null) {
    return legacyMimeVerdict(mime, options.transcodeEnabled)
  }

  const audioCodec = normalizeCodec(item?.audio_codec)

  // No video stream. This is NOT unsupported by itself: audio-only files in
  // video containers (and files whose only "video" stream is cover art) play
  // in a <video> today, and taking their play button away would be a
  // regression dressed up as a fix. So the audio track alone decides, probed
  // against the real container.
  //
  // The SENTINEL is the sole authority here, `video_tracks` deliberately not:
  // the two come from different probes and the count is the weaker of them
  // (cover art is a video stream that counts and decodes to a still, and a
  // stale or missing count would otherwise route a real video down the
  // audio-only rung, where the verdict can only be playable or unsupported —
  // never the transcode it actually needs).
  if (videoCodec === CODEC_NONE) {
    if (audioCodec === null) return "unsupported"
    const audio = audioCodecStrings(audioCodec)
    if (audio && acceptsAny(probe, mime, audio)) return "playable"
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
    const audio = audioCodecStrings(audioCodec)
    if (!audio || !acceptsAny(probe, mime, audio)) {
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

// MediaError codes, by value: the constants live on the MediaError INTERFACE,
// which is a DOM global this module must stay free of to remain node-testable.
const MEDIA_ERR_ABORTED = 1
const MEDIA_ERR_NETWORK = 2
const MEDIA_ERR_DECODE = 3
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4

/**
 * Is this element error evidence about the CODEC? Only a decode failure is.
 *
 * The downgrade is permanent for the session and takes the file's own bytes
 * away from the player, so it must never fire on an accident: ABORTED is the
 * user navigating away mid-load, NETWORK is a dropped connection to a file
 * this decoder may well handle, and firing on either would demote a perfectly
 * playable item on a flaky link.
 *
 * SRC_NOT_SUPPORTED is the one that looks tempting and is not usable: the
 * resource-selection algorithm reports it for "fetched, and unsupported" AND
 * for "could not be fetched at all" (a 404 on the file URL, a CORS refusal, a
 * gateway hiccup), and in both cases the element lands on
 * `networkState === NETWORK_NO_SOURCE`. There is no readable state that
 * separates them, so it is left alone: an item that genuinely cannot be
 * decoded gets its play button from the codec probe or not at all.
 */
export function shouldDowngradeOnError(
  error: { code: number } | null | undefined
): boolean {
  if (!error) return false
  switch (error.code) {
    case MEDIA_ERR_DECODE:
      return true
    case MEDIA_ERR_ABORTED:
    case MEDIA_ERR_NETWORK:
    case MEDIA_ERR_SRC_NOT_SUPPORTED:
    default:
      return false
  }
}

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

// "Is this render allowed to consult the browser?" — false on the server AND
// on the client's first (hydrating) render, true from the render after it.
// useSyncExternalStore is what makes that split honest: React uses the server
// snapshot while hydrating and re-checks the client one immediately after,
// which is the same mechanism useOutroSkipEnabled relies on. The store never
// changes, so it never subscribes to anything.
// EXPORTED because the hover-preview capability needs the same split for the
// same reason (lib/useClientConfig.ts `useHoverPreview`): the search page
// prefetches the client config, so a server render would otherwise resolve a
// real capability and plan video cells against a ladder that had no browser to
// probe. One store that is never notified, so a second caller costs nothing.
const subscribeNothing = () => () => {}
export function useHydrated(): boolean {
  return React.useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false
  )
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
  // The probe is a CLIENT capability, and the server answered without it.
  // Consulting it on the hydrating render would render different markup than
  // the HTML being hydrated — an audio-only mp4 (playable here, playable
  // there, but arrived at through a different branch) and a .mov with the
  // capability off are the two that actually differed. So the first client
  // render repeats the server's legacy-mime verdict verbatim and the real
  // answer lands one render later, which React applies as an ordinary update.
  const hydrated = useHydrated()
  const verdict = videoPlayability(item, {
    transcodeEnabled,
    canPlayType: hydrated ? undefined : null,
  })
  // Only a `playable` verdict is ever downgraded: every other one already
  // routes through the transcode, and a failing ARTIFACT is the job's problem,
  // not evidence about the source.
  if (downgraded && verdict === "playable") return transcodeVerdict(transcodeEnabled)
  return verdict
}
