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
  /** Present when the search was made with include_bookmarks */
  bookmarked?: boolean | null
}
