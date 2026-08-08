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
  blurhash?: string
  /**
   * Where the item's real content ends (ms), when an outro was detected.
   * Requested by the gallery's search select; absent/null when the item has
   * no outro or the index DB has TikTok detection off (the API nulls it).
   */
  content_end_ms?: number | null
  /** Present when the search was made with include_bookmarks */
  bookmarked?: boolean | null
}
