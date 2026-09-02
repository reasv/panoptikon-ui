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

/**
 * Every search-query param family, as a [serializer, key map] pair.
 *
 * The serializer-side twin of `useResetSearchQueryState`'s setter list
 * (lib/state/searchQuery/clientHooks.ts), and deliberately the SAME list
 * rather than a better one: a link and the click handler beside it must land
 * on identical state, so if that hook forgets a family this must forget it
 * too. (It does forget one today — the `at.sa` audio pair has no setter
 * there — and copying the omission is the correct behaviour until the hook
 * gains it.)
 *
 * Pairs rather than serializers alone because a serializer cannot say which
 * keys it owns; the key map can, and taking the names from the map itself is
 * what stops this list from drifting as families gain and lose params.
 */
const SEARCH_QUERY_FAMILIES: [
  (base: URLSearchParams, values: Record<string, null>) => string,
  (p: typeof def) => Record<string, unknown>
][] = (
  [
    [serializers.matchText, matchTextKeyMap],
    [serializers.matchPath, matchPathKeyMap],
    [serializers.orderArgs, orderParamsKeyMap],
    [serializers.matchTags, tagFiltersKeyMap],
    [serializers.fileFilters, fileFiltersKeyMap],
    [serializers.inBookmarks, inBookmarksKeyMap],
    [serializers.inPinboards, inPinboardsKeyMap],
    [serializers.semanticTextSearch, semanticTextSearchKeyMap],
    [serializers.semanticImageSearch, semanticImageSearchKeyMap],
    [serializers.queryOptions, queryOptionsKeyMap],
    [serializers.atMatchText, matchTextKeyMap],
    [serializers.atMatchPath, matchPathKeyMap],
    [serializers.atSemanticText, semanticTextSearchKeyMap],
    [serializers.atSemanticTextSource, sourceTextKeyMap],
    [serializers.atSemanticImage, semanticImageSearchKeyMap],
    [serializers.semanticTextSource, sourceTextKeyMap],
    [serializers.itemSimilaritySearch, itemSimilarityKeyMap],
    [serializers.itemSimilarityTextSource, sourceTextKeyMap],
    [serializers.atTextRRF, rrfKeyMap],
    [serializers.atPathRRF, rrfKeyMap],
    [serializers.atSemanticTextRRF, rrfKeyMapSemanticText],
    [serializers.atSemanticImageRRF, rrfKeyMapSemanticImage],
  ] as unknown
) as [
  (base: URLSearchParams, values: Record<string, null>) => string,
  (p: typeof def) => Record<string, unknown>
][]

/**
 * The current URL with every search-query param stripped, and everything
 * else left alone.
 *
 * For links that REPLACE the search rather than adjust it — the similarity
 * sidebar's result links, whose click-handler twin calls
 * `useResetSearchQueryState()` and then writes the new query. Building such
 * a link from an EMPTY base instead is what made those links drop the whole
 * workspace: `fs`, the `pinboard` itself, the dock pins, the tab flags and
 * the view mode all live in the URL, so a from-scratch link opened in a new
 * tab landed on a bare search page — no board to maximize, and therefore no
 * maximized view either.
 *
 * Position params are NOT cleared here (this function is about the query,
 * not about where you are in its results); callers that are building a fresh
 * result set have to drop the scroll anchor themselves.
 */
export const clearSearchQueryParams = (
  base: ReadonlyURLSearchParams | URLSearchParams
): URLSearchParams => {
  let params = new URLSearchParams(base)
  for (const [serialize, keyMap] of SEARCH_QUERY_FAMILIES) {
    const cleared = Object.fromEntries(
      Object.keys(keyMap(def)).map((key) => [key, null])
    )
    // Each pass returns a "?a=1&b=2" string; URLSearchParams strips the
    // leading "?" itself, and an emptied one round-trips as "".
    params = new URLSearchParams(serialize(params, cleared))
  }
  return params
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
  pageSize: number,
  galleryOpen = false
) => {
  const queryParams = new URLSearchParams(base)
  // The literal key `orderParamsKeyMap` addresses (see getSearchPageURL's
  // `{ page }` above): dropped outright, not set to 1, so the URL says
  // "position, not pagination".
  queryParams.delete("page")
  const anchor = virtualPageAnchor(newPage, pageSize)
  // The gallery index (`lib/state/gallery.ts`'s `gi`). In scroll mode `gi` is
  // a GLOBAL index and it wins over `top` on load — it opens the gallery on
  // that exact item. With the gallery OPEN the link is a gallery jump, so it
  // carries the target page's first item (`gi=0` written explicitly:
  // presence, not value, is what opens the gallery) — the same value the
  // scrubber's own click writes (see setVirtualPage). Never the CURRENT
  // index: that would open the middle-clicked page at the item the user is
  // looking at now, not at the page the link is labelled with. With the
  // gallery closed the link is a grid position and carries no `gi` at all.
  if (galleryOpen) queryParams.set("gi", String(anchor))
  else queryParams.delete("gi")
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
