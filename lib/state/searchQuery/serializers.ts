import { createSerializer } from "nuqs/server"
import * as def from "nuqs/server"
import {
  orderParamsKeyMap,
  tagFiltersKeyMap,
  fileFiltersKeyMap,
  matchPathKeyMap,
  matchTextKeyMap,
  inBookmarksKeyMap,
  inPinboardsKeyMap,
  semanticTextSearchKeyMap,
  semanticImageSearchKeyMap,
  queryOptionsKeyMap,
  embedArgsKeyMap,
  sourceTextKeyMap,
  itemSimilarityKeyMap,
  rrfKeyMap,
  rrfKeyMapSemanticImage,
  rrfKeyMapSemanticText,
  similaritySBPageArgsKeyMap,
  rrfKeyMapSemanticAudio,
} from "./searchQueryKeyMaps"
import { createScopedSerializer } from "../nuqsScopedWrappers/scopedSerializer"
import type { ReadonlyURLSearchParams } from "next/navigation"
import { GRID_SCROLL_ANCHOR_KEY } from "../gridScroll"
// Relative, not "@/lib/...": scripts/scrollmode.test.mjs imports this module
// under plain node, which resolves no path aliases.
import { virtualPageAnchor } from "../../scrollMode"

export const serializers = {
  embedArgs: createSerializer(embedArgsKeyMap(def)),
  orderArgs: createSerializer(orderParamsKeyMap(def)),
  queryOptions: createSerializer(queryOptionsKeyMap(def)),
  matchTags: createScopedSerializer("tag", tagFiltersKeyMap(def)),
  fileFilters: createScopedSerializer("file", fileFiltersKeyMap(def)),
  matchPath: createScopedSerializer("path", matchPathKeyMap(def)),
  matchText: createScopedSerializer("txt", matchTextKeyMap(def)),
  inBookmarks: createScopedSerializer("bm", inBookmarksKeyMap(def)),
  inPinboards: createScopedSerializer("pb", inPinboardsKeyMap(def)),
  semanticTextSearch: createScopedSerializer(
    "st",
    semanticTextSearchKeyMap(def)
  ),
  semanticTextSource: createScopedSerializer("st.src", sourceTextKeyMap(def)),
  semanticImageSearch: createScopedSerializer(
    "si",
    semanticImageSearchKeyMap(def)
  ),
  itemSimilaritySearch: createScopedSerializer(
    "iss",
    itemSimilarityKeyMap(def)
  ),
  itemSimilarityTextSource: createScopedSerializer(
    "iss.src",
    sourceTextKeyMap(def)
  ),
  atMatchPath: createScopedSerializer("at.path", matchPathKeyMap(def)),
  atTextRRF: createScopedSerializer("at.txt.rrf", rrfKeyMap(def)),
  atPathRRF: createScopedSerializer("at.path.rrf", rrfKeyMap(def)),
  atSemanticTextRRF: createScopedSerializer(
    "at.st.rrf",
    rrfKeyMapSemanticText(def)
  ),
  atSemanticImageRRF: createScopedSerializer(
    "at.si.rrf",
    rrfKeyMapSemanticImage(def)
  ),
  atMatchText: createScopedSerializer("at.txt", matchTextKeyMap(def)),
  atSemanticText: createScopedSerializer(
    "at.st",
    semanticTextSearchKeyMap(def)
  ),
  atSemanticTextSource: createScopedSerializer(
    "at.st.src",
    sourceTextKeyMap(def)
  ),
  atSemanticImage: createScopedSerializer(
    "at.si",
    semanticImageSearchKeyMap(def)
  ),
  atSemanticAudio: createScopedSerializer(
    "at.sa",
    semanticImageSearchKeyMap(def)
  ),
  atSemanticAudioRRF: createScopedSerializer(
    "at.sa.rrf",
    rrfKeyMapSemanticAudio(def)
  ),
}

export const getSearchPageURL = (
  base: ReadonlyURLSearchParams | URLSearchParams,
  newPage: number
) => {
  const queryParams = new URLSearchParams(base)
  // A new page starts at the top — don't carry the scroll anchor across pages
  queryParams.delete(GRID_SCROLL_ANCHOR_KEY)
  return serializers.orderArgs(queryParams, {
    page: newPage,
  })
}

// The grid scroll anchor on its own, for the links below. The parser has to
// be the one lib/state/gridScroll.ts uses for the same key, or a link and the
// hook that reads it back would disagree about the param they share.
const scrollAnchorSerializer = createSerializer({
  [GRID_SCROLL_ANCHOR_KEY]: def.parseAsInteger,
})

/**
 * A virtual page's link in scroll mode: the same destination
 * `getSearchPageURL` builds, addressed as a position instead of a page.
 *
 * Virtual page N covers items `[(N-1)*k, N*k)` with k = `page_size`, so its
 * link is `top = (N-1)*k` and no `page` at all — scroll mode's whole defence
 * against two live position params is that `page` never exists there, and a
 * middle-clicked page link must not be the one URL that reintroduces it.
 *
 * `top` is REMOVED rather than written as 0 for the first page: the codec's
 * convention is "absent while the top row is visible", so writing an explicit
 * zero would put a parameter in every fresh link that means what blank
 * already means.
 *
 * k comes in as an argument — this is a pure serializer, and the caller is
 * the one holding the page-size state. `k < 1` is "no pagination": one
 * unbounded virtual page, hence the top of the set.
 *
 * The anchor itself comes from `virtualPageAnchor` rather than being spelled
 * out here, because the pagination bar has TWO writers of the same
 * destination — this link and the click handler's `setScrollAnchor` — and a
 * middle-click that lands one item away from a left-click is exactly the kind
 * of drift a second copy of `(N-1)*k` produces.
 */
export const getScrollPositionURL = (
  base: ReadonlyURLSearchParams | URLSearchParams,
  newPage: number,
  pageSize: number
) => {
  const queryParams = new URLSearchParams(base)
  // The literal key `orderParamsKeyMap` addresses (see getSearchPageURL's
  // `{ page }` above): dropped outright, not set to 1, so the URL says
  // "position, not pagination".
  queryParams.delete("page")
  // Likewise the gallery index (`lib/state/gallery.ts`'s `gi`). In scroll mode
  // `gi` is a GLOBAL index and it wins over `top` on load — it opens the
  // gallery on that exact item — so carrying the current one into a virtual
  // page link would open the middle-clicked page at the item the user is
  // looking at now, not at the page the link is labelled with.
  queryParams.delete("gi")
  const anchor = virtualPageAnchor(newPage, pageSize)
  return scrollAnchorSerializer(queryParams, {
    [GRID_SCROLL_ANCHOR_KEY]: anchor > 0 ? anchor : null,
  })
}

// Similarity sidebar
export const sbSimilaritySerializers = {
  CLIPSimilarity: createScopedSerializer(
    "sb.iss.clip",
    itemSimilarityKeyMap(def)
  ),
  CLIPTextSource: createScopedSerializer(
    "sb.iss.clip.src",
    sourceTextKeyMap(def)
  ),
  TextSimilarity: createScopedSerializer(
    "sb.iss.txt",
    itemSimilarityKeyMap(def)
  ),
  TextSource: createScopedSerializer("sb.iss.txt.src", sourceTextKeyMap(def)),
  PageArgs: createScopedSerializer("sb.iss", similaritySBPageArgsKeyMap(def)),
}
