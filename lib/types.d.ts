interface SearchResult {
  item_id: number
  file_id: number
  /** Path */
  path: string
  /** Sha256 */
  sha256: string
  /** Last Modified */
  last_modified: string
  /** Type */
  type: string
  width?: number | null
  height?: number | null
  /**
   * The file's size in bytes, requested by the gallery's search select and
   * shown on the gallery headers' metadata line (both the page gallery and
   * the maximized board's viewer). Nullable because rows built from a
   * selection rather than a search result may not carry one — the headers
   * omit the size entirely rather than printing a made-up zero.
   */
  size?: number | null
  blurhash?: string
  /**
   * The item's indexed duration in seconds (ffprobe's), requested by the
   * gallery's search select alongside content_end_ms: the two together give
   * the outro card's length, which is what end-anchors the cut point.
   */
  duration?: number | null
  /**
   * Where the item's real content ends (ms), when an outro was detected.
   * Requested by the gallery's search select; absent/null when the item has
   * no outro or the index DB has TikTok detection off (the API nulls it).
   */
  content_end_ms?: number | null
  /**
   * ffprobe's `codec_name` for the item's video stream, requested by the
   * gallery's search select and read by lib/videoPlayability.ts. Two in-band
   * sentinels ride the same column: `'none'` means the file was probed and
   * has no video stream (an audio file, or a video container carrying audio
   * only), `'unknown'` means a stream exists but ffprobe would not name its
   * codec. NULL is neither — it means the item has not been probed yet
   * (pre-migration rows, backfill still pending), which is why the playability
   * ladder keeps the legacy mime check as its NULL branch.
   */
  video_codec?: string | null
  /**
   * ffprobe's `codec_name` for the item's FIRST audio stream, same select.
   * NULL deliberately conflates "no audio stream" with "not probed yet" —
   * termination of the backfill keys on video_codec alone — so the playability
   * ladder never treats a NULL audio codec as a veto.
   */
  audio_codec?: string | null
  /** Present when the search was made with include_bookmarks */
  bookmarked?: boolean | null
}
