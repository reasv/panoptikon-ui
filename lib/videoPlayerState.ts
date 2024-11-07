import React from "react"

export function useVideoPlayerState({
  videoRef,
}: {
  videoRef: React.RefObject<HTMLVideoElement>
}) {
  const [showVideo, setShowVideo] = React.useState(false)
  const [videoIsPlaying, setVideoIsPlaying] = React.useState(false)
  const [videoIsMuted, setVideoIsMuted] = React.useState(false)
  const [showControls, setShowControls] = React.useState(false)
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
      videoRef.current.muted = state
      setVideoIsMuted(state)
    }
  }
  const setControls = (state: boolean) => {
    setShowControls(state)
    if (videoRef.current) {
      setVideoIsMuted(videoRef.current.muted)
      setVideoIsPlaying(!videoRef.current.paused)
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
  }
}
