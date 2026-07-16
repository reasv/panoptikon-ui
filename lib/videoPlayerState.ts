import React from "react"

export function useVideoPlayerState({
  videoRef,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
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
    }
  }
  const setControls = (state: boolean) => {
    setShowControls(state)
    if (videoRef.current) {
      setVideoIsMuted(videoRef.current.muted)
      setVideoIsPlaying(!videoRef.current.paused)
      setVolumeState(videoRef.current.volume)
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
