import React from "react"

// Volume/mute are a player preference, not per-item state. Opt-in
// (`persistVolume`) so call sites that have not adopted the player surface
// keep their existing per-mount defaults.
const VOLUME_STORAGE_KEY = "videoPlayerVolume"

interface StoredVolume {
  volume: number
  muted: boolean
}

function readStoredVolume(): StoredVolume | null {
  try {
    const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null
    const { volume, muted } = parsed as Partial<StoredVolume>
    if (typeof volume !== "number" || !isFinite(volume)) return null
    return { volume: Math.max(0, Math.min(1, volume)), muted: muted === true }
  } catch {
    return null
  }
}

// The speed ladder, shared by the player surface's inline speed row and the
// gallery's < / > keys so both step the same rungs
export const PLAYBACK_RATES: readonly number[] = [0.25, 0.5, 1, 1.5, 2]

// Outro skip is a viewer preference like volume: one browser-level setting,
// default ON, shared by every player on the page (docs/video-outro-skip-
// design.md §3). Volume can afford per-hook state because one element is one
// player; this one must be SHARED — a board shows many pins at once and
// toggling it on one has to move all of them. Hence a module-level store
// read through useSyncExternalStore rather than the persistVolume pattern's
// per-mount effect.
const OUTRO_SKIP_STORAGE_KEY = "videoPlayerOutroSkip"

let outroSkipCache: boolean | null = null
const outroSkipListeners = new Set<() => void>()

function readStoredOutroSkip(): boolean {
  try {
    const raw = window.localStorage.getItem(OUTRO_SKIP_STORAGE_KEY)
    // Absent means "never set" — the default is on
    return raw === null ? true : raw !== "0"
  } catch {
    return true
  }
}

// "Browser-level" has to include the OTHER tabs: localStorage fires
// `storage` in every document but the one that wrote, so this is the whole
// cross-tab path. Bound once per document (never removed — its lifetime is
// the module's, not any component's) and lazily, from subscribe, so the
// module stays importable on the server.
let outroSkipStorageBound = false
function bindOutroSkipStorage() {
  if (outroSkipStorageBound || typeof window === "undefined") return
  outroSkipStorageBound = true
  window.addEventListener("storage", (e) => {
    if (e.storageArea != null && e.storageArea !== window.localStorage) return
    // A null key is localStorage.clear() — that drops this key too
    if (e.key !== null && e.key !== OUTRO_SKIP_STORAGE_KEY) return
    const next = readStoredOutroSkip()
    // getSnapshot must stay stable across a no-op event, or every
    // subscribed player re-renders for another tab's unrelated write
    if (next === outroSkipCache) return
    outroSkipCache = next
    for (const listener of outroSkipListeners) listener()
  })
}

function subscribeOutroSkip(onChange: () => void): () => void {
  bindOutroSkipStorage()
  outroSkipListeners.add(onChange)
  return () => {
    outroSkipListeners.delete(onChange)
  }
}

// Cached, because getSnapshot runs on every render of every player and must
// return a stable value; the cache is the store.
function getOutroSkipSnapshot(): boolean {
  if (outroSkipCache === null) outroSkipCache = readStoredOutroSkip()
  return outroSkipCache
}

// SSR (and the hydration pass) renders the default; React re-checks the
// client snapshot right after hydrating, so a stored `off` still applies.
function getOutroSkipServerSnapshot(): boolean {
  return true
}

export function setOutroSkipEnabled(value: boolean) {
  outroSkipCache = value
  try {
    window.localStorage.setItem(OUTRO_SKIP_STORAGE_KEY, value ? "1" : "0")
  } catch {
    // Private mode / quota — the preference is a convenience, never a
    // precondition
  }
  for (const listener of outroSkipListeners) listener()
}

export function useOutroSkipEnabled(): boolean {
  return React.useSyncExternalStore(
    subscribeOutroSkip,
    getOutroSkipSnapshot,
    getOutroSkipServerSnapshot,
  )
}

// What playback does when a video reaches its end — the trim end, the outro
// cut or the file's natural end, whichever governs (docs/video-end-action-
// design.md §1). A browser-level viewer preference, not a URL param: it
// belongs to the viewer like volume, not to the search or the item, and it
// must survive sessions.
//
// GALLERY-ONLY: the pinboard never reads it (pins are an arrangement, not a
// sequence — only the gallery renders the button). The store is still
// load-bearing WITHIN the gallery tree: the mode is read by more than one
// component (the `loop` attribute gate and `useVideoTrim` wiring in the
// player host, the advance callback and prefetch effect in the gallery, the
// surface's button), and every reader must see the same value in the same
// commit — a per-mount localStorage read (the persistVolume pattern below)
// would let a video keep its native `loop` while the gallery already
// believes it is advancing, silently stalling the chain. Deliberately a
// duplicate of the outro-skip store above rather than a shared generic: that
// code is pending field validation and must stay untouched.

// The canonical mode order — the cycle button steps through this array, and
// the parser derives validity from it, so a future mode added here is
// automatically parseable (a hand-listed parser would make an unlisted new
// mode silently revert to "loop" on reload or in other tabs).
export const GALLERY_END_ACTIONS = ["loop", "stop", "advance"] as const
export type GalleryEndAction = (typeof GALLERY_END_ACTIONS)[number]

const END_ACTION_STORAGE_KEY = "galleryVideoEndAction"

let endActionCache: GalleryEndAction | null = null
const endActionListeners = new Set<() => void>()

function readStoredEndAction(): GalleryEndAction {
  try {
    const raw = window.localStorage.getItem(END_ACTION_STORAGE_KEY)
    // Anything unrecognized — absent, a value from a future version, a
    // hand-edited key — reads as the default, so a bad string can never
    // wedge playback in a mode the UI cannot name
    return raw != null && (GALLERY_END_ACTIONS as readonly string[]).includes(raw)
      ? (raw as GalleryEndAction)
      : "loop"
  } catch {
    return "loop"
  }
}

// "Browser-level" has to include the OTHER tabs: localStorage fires
// `storage` in every document but the one that wrote, so this is the whole
// cross-tab path. Bound once per document (never removed — its lifetime is
// the module's, not any component's) and lazily, from subscribe, so the
// module stays importable on the server.
let endActionStorageBound = false
function bindEndActionStorage() {
  if (endActionStorageBound || typeof window === "undefined") return
  endActionStorageBound = true
  window.addEventListener("storage", (e) => {
    if (e.storageArea != null && e.storageArea !== window.localStorage) return
    // A null key is localStorage.clear() — that drops this key too
    if (e.key !== null && e.key !== END_ACTION_STORAGE_KEY) return
    const next = readStoredEndAction()
    // getSnapshot must stay stable across a no-op event, or every
    // subscribed player re-renders for another tab's unrelated write
    if (next === endActionCache) return
    endActionCache = next
    for (const listener of endActionListeners) listener()
  })
}

function subscribeEndAction(onChange: () => void): () => void {
  bindEndActionStorage()
  endActionListeners.add(onChange)
  return () => {
    endActionListeners.delete(onChange)
  }
}

// Cached, because getSnapshot runs on every render of every player and must
// return a stable value; the cache is the store.
function getEndActionSnapshot(): GalleryEndAction {
  if (endActionCache === null) endActionCache = readStoredEndAction()
  return endActionCache
}

// SSR (and the hydration pass) renders the default; React re-checks the
// client snapshot right after hydrating, so a stored mode still applies.
function getEndActionServerSnapshot(): GalleryEndAction {
  return "loop"
}

export function setGalleryEndAction(value: GalleryEndAction) {
  endActionCache = value
  try {
    window.localStorage.setItem(END_ACTION_STORAGE_KEY, value)
  } catch {
    // Private mode / quota — the preference is a convenience, never a
    // precondition
  }
  for (const listener of endActionListeners) listener()
}

export function useGalleryEndAction(): GalleryEndAction {
  return React.useSyncExternalStore(
    subscribeEndAction,
    getEndActionSnapshot,
    getEndActionServerSnapshot,
  )
}

function writeStoredVolume(value: StoredVolume) {
  try {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Private mode / quota — the preference is a convenience, never a
    // precondition
  }
}

export function useVideoPlayerState({
  videoRef,
  persistVolume = false,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  persistVolume?: boolean
}) {
  const [showVideo, setShowVideo] = React.useState(false)
  const [videoIsPlaying, setVideoIsPlaying] = React.useState(false)
  const [videoIsMuted, setVideoIsMuted] = React.useState(false)
  const [showControls, setShowControls] = React.useState(false)
  const [volume, setVolumeState] = React.useState(1)
  // volume isn't a React prop on <video>, so re-apply it whenever the
  // element (re)mounts (showVideo toggles remount it)
  React.useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume
    }
  }, [volume, showVideo, videoRef])
  // Speed is situational, so it is never stored — but it must outlive the
  // ELEMENT: the gallery's <video> is keyed by item and remounts mid-
  // navigation (a fresh ref identity), and showVideo remounts it too. Both
  // hand back an element at the default 1x that React state disagrees with.
  const [playbackRate, setPlaybackRateState] = React.useState(1)
  React.useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate
    }
  }, [playbackRate, showVideo, videoRef])
  // Stored preference is applied once per mount (never during render: a
  // localStorage read there would desync server and client markup)
  React.useEffect(() => {
    if (!persistVolume) return
    const stored = readStoredVolume()
    if (!stored) return
    setVolumeState(stored.volume)
    setVideoIsMuted(stored.muted)
    if (videoRef.current) {
      videoRef.current.volume = stored.volume
      videoRef.current.muted = stored.muted
    }
  }, [persistVolume, videoRef])
  const setVolume = (v: number) => {
    const clamped = Math.max(0, Math.min(1, v))
    setVolumeState(clamped)
    // Volume and mute are coupled: raising the volume unmutes, dragging
    // to zero mutes
    setVideoIsMuted(clamped === 0)
    if (videoRef.current) {
      videoRef.current.volume = clamped
      videoRef.current.muted = clamped === 0
    }
    if (persistVolume) writeStoredVolume({ volume: clamped, muted: clamped === 0 })
  }
  const setPlaybackRate = (rate: number) => {
    setPlaybackRateState(rate)
    if (videoRef.current) {
      videoRef.current.playbackRate = rate
    }
  }
  const setPlaying = (state: boolean) => {
    if (!showVideo) {
      // If the video is not playing, show the video
      setShowVideo(true)
      setVideoIsPlaying(true)
      return
    }
    if (videoRef.current) {
      if (state) {
        videoRef.current.play()
        setVideoIsPlaying(true)
      } else {
        videoRef.current.pause()
        setVideoIsPlaying(false)
      }
    }
  }
  const stopVideo = () => {
    setShowVideo(false)
    setVideoIsPlaying(false)
  }
  const setMuted = (state: boolean) => {
    if (videoRef.current) {
      // Unmuting at volume zero would be silence with a "sound on" icon
      if (!state && volume === 0) {
        setVolume(0.5)
        return
      }
      videoRef.current.muted = state
      setVideoIsMuted(state)
      if (persistVolume) writeStoredVolume({ volume, muted: state })
    }
  }
  const setControls = (state: boolean) => {
    setShowControls(state)
    if (videoRef.current) {
      setVideoIsMuted(videoRef.current.muted)
      setVideoIsPlaying(!videoRef.current.paused)
      setVolumeState(videoRef.current.volume)
      // The native controls carry their own speed menu, so they are a second
      // writer of the rate exactly as they are of volume/mute
      setPlaybackRateState(videoRef.current.playbackRate)
      // The native controls are a second writer of volume/mute; the resync
      // is the only chance to keep the stored preference truthful
      if (persistVolume) writeStoredVolume({
        volume: videoRef.current.volume,
        muted: videoRef.current.muted,
      })
    }
  }
  return {
    showVideo,
    setShowVideo,
    videoIsPlaying,
    setVideoIsPlaying,
    videoIsMuted,
    setVideoIsMuted,
    showControls,
    setShowControls,
    setPlaying,
    stopVideo,
    setMuted,
    setControls,
    volume,
    setVolume,
    playbackRate,
    setPlaybackRate,
  }
}
