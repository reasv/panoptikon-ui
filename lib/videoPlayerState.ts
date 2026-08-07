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
  }
}
