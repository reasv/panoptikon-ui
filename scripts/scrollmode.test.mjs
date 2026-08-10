// Assertions for the scroll-mode foundations: the mode-switch arithmetic
// (lib/scrollMode.ts), the chunk lattice the sparse fetcher works on, the
// chunk request builder (lib/searchRequest.ts) and the scroll-mode page link
// (lib/state/searchQuery/serializers.ts). The contract is
// docs/search-scroll-mode-design.md §4-§5. No test runner in this repo — run
// it from the ui root:
//
//   node --experimental-strip-types scripts/scrollmode.test.mjs
//
// The arithmetic lives in an import-free module precisely so it can run here:
// the hooks that call it (lib/searchHooks.ts) pull in React, nuqs and the API
// client, none of which resolve outside a bundler. Exits non-zero on failure.

import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  chunkIndexOf,
  chunkOffsetOf,
  chunkRangeFor,
  chunkStartOf,
  clampToPage,
  overscanItemsFor,
  pageStateFromScrollAnchor,
  remapPageAnchor,
  scanLoadedForward,
  scrollAnchorFromPage,
  topRowHighlightItem,
  virtualPageAnchor,
  virtualPageOf,
} = await import("../lib/scrollMode.ts")
const { SCROLL_CHUNK_SIZE, buildChunkRequest, buildResultsRequest } =
  await import("../lib/searchRequest.ts")
const { getScrollPositionURL, getSearchPageURL } = await import(
  "../lib/state/searchQuery/serializers.ts"
)
// The storage-free half of the creation-defaults layer: resolution, the
// stamp derived from it, and the allowlist. loadUserDefaults and its two
// siblings are the only parts that touch localStorage, and they have no
// logic worth asserting — so they are deliberately not imported here.
const {
  SEARCH_DEFAULTABLE_KEYS,
  SEARCH_DEFAULTABLE_PARAMS,
  SESSION_PARAM_KEYS,
  creationStamp,
  effectiveCreationDefaultsFrom,
  isFreshSession,
  sanitizeSearchDefaults,
} = await import("../lib/searchDefaults.ts")

let all = true
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `\n  ${detail}` : ""}`)
  all &&= !!ok
  return ok
}
const shape = (value) => JSON.stringify(value)

// ---- pages -> scroll --------------------------------------------------
//
// The URL states the switch reads: `page` (1 when absent), `page_size` = k,
// and the position — the open gallery's `gi`, else `top`, else 0 for "the
// top row is visible".

{
  // At rest on a fresh search: nothing to carry, and the caller turns a 0
  // into an absent `top`.
  const anchor = scrollAnchorFromPage({ page: 1, pageSize: 10, anchor: 0 })
  check("at rest, pages -> scroll is the top of the set", anchor === 0, `${anchor}`)
}

{
  const anchor = scrollAnchorFromPage({ page: 37, pageSize: 10, anchor: 4 })
  check(
    "deep position: (page-1)*k + top",
    anchor === 364,
    `${anchor}`
  )
}

{
  // `top` absent mid-set: the page's first item is the position.
  const anchor = scrollAnchorFromPage({ page: 12, pageSize: 25, anchor: 0 })
  check("top absent still lands on the page's first item", anchor === 275, `${anchor}`)
}

{
  // Gallery open: `gi` is the in-page index the caller passes instead of
  // `top`, and it globalizes through the same arithmetic.
  const anchor = scrollAnchorFromPage({ page: 4, pageSize: 50, anchor: 17 })
  check("gallery open: gi globalizes the same way", anchor === 167, `${anchor}`)
}

{
  // k < 1 is "no pagination" — one unbounded page, so the in-page index is
  // ALREADY the global one. The naive `(page-1)*k` would be NaN here.
  const anchor = scrollAnchorFromPage({ page: 1, pageSize: 0, anchor: 512 })
  check(
    "k < 1 is one unbounded page, not NaN",
    anchor === 512,
    `${anchor}`
  )
  const stray = scrollAnchorFromPage({ page: 9, pageSize: 0, anchor: 3 })
  check(
    "…and a stray page number on it is ignored, not multiplied in",
    stray === 3,
    `${stray}`
  )
}

{
  const negative = scrollAnchorFromPage({ page: 0, pageSize: 10, anchor: -5 })
  check(
    "a nonsense page/anchor pair clamps instead of going negative",
    negative === 0,
    `${negative}`
  )
}

// ---- scroll -> pages --------------------------------------------------

{
  const target = pageStateFromScrollAnchor({ anchor: 0, pageSize: 10 })
  check(
    "at rest, scroll -> pages is page 1 with no local anchor",
    shape(target) === shape({ page: 1, index: 0 }),
    shape(target)
  )
}

{
  const target = pageStateFromScrollAnchor({ anchor: 364, pageSize: 10 })
  check(
    "deep position splits into page + local index",
    shape(target) === shape({ page: 37, index: 4 }),
    shape(target)
  )
}

{
  const target = pageStateFromScrollAnchor({ anchor: 275, pageSize: 25 })
  check(
    "a position exactly on a page boundary has no local anchor",
    shape(target) === shape({ page: 12, index: 0 }),
    shape(target)
  )
}

{
  const target = pageStateFromScrollAnchor({ anchor: 4096, pageSize: 0 })
  check(
    "k < 1 puts the whole set on page 1 with the global index intact",
    shape(target) === shape({ page: 1, index: 4096 }),
    shape(target)
  )
}

// ---- pages -> pages: the page-size remap ------------------------------
//
// Both wrappers above pin one side to "no pagination", so neither exercises
// the both-sizes-finite branch that `useCommitPageSize` actually runs in
// pages mode. Asserted directly here.

{
  // page 3 at k=10, 5th item of the page -> global (3-1)*10 + 4 = 24.
  // At k=25 that global index is still on the first page: floor(24/25) = 0.
  const grown = remapPageAnchor({
    page: 3,
    pageSize: 10,
    nextPageSize: 25,
    anchor: 4,
  })
  check(
    "growing the page size re-expresses the same global item",
    shape(grown) === shape({ page: 1, index: 24 }),
    shape(grown)
  )
  // The same global 24 at k=15 lands mid-set: 24 = 1*15 + 9.
  const regrouped = remapPageAnchor({
    page: 3,
    pageSize: 10,
    nextPageSize: 15,
    anchor: 4,
  })
  check(
    "…and a size that regroups it moves the page number with it",
    shape(regrouped) === shape({ page: 2, index: 9 }),
    shape(regrouped)
  )
  // The remap is the identity when nothing changes, and it is reversible:
  // going back to the old size must name the coordinates it started from.
  const back = remapPageAnchor({
    page: regrouped.page,
    pageSize: 15,
    nextPageSize: 10,
    anchor: regrouped.index,
  })
  check(
    "…and remapping back to the old size returns the original coordinates",
    shape(back) === shape({ page: 3, index: 4 }),
    shape(back)
  )
}

// ---- the invariant the whole design rests on --------------------------
//
// floor(top_global / k) === page - 1, with the same k on both sides: the
// highlighted page number does not move across a mode switch.

{
  let ok = true
  let firstBad = ""
  for (const pageSize of [1, 7, 10, 25, 100]) {
    for (const page of [1, 2, 3, 17, 37, 1000]) {
      for (const local of [0, 1, pageSize - 1]) {
        if (local < 0 || local >= pageSize) continue
        const global = scrollAnchorFromPage({ page, pageSize, anchor: local })
        const derivedPage = Math.floor(global / pageSize) + 1
        const back = pageStateFromScrollAnchor({ anchor: global, pageSize })
        const good =
          derivedPage === page && back.page === page && back.index === local
        if (!good && !firstBad) {
          firstBad = `k=${pageSize} page=${page} local=${local} -> global=${global} back=${shape(back)}`
        }
        ok &&= good
      }
    }
  }
  check("floor(top/k) === page-1 and the round trip is identity", ok, firstBad)
}

{
  // The same claim stated the other way: a switch out and back leaves the URL
  // naming the same coordinates it started from.
  const start = { page: 37, pageSize: 10, anchor: 4 }
  const global = scrollAnchorFromPage(start)
  const back = pageStateFromScrollAnchor({ anchor: global, pageSize: start.pageSize })
  check(
    "pages -> scroll -> pages lands on the same page and local anchor",
    back.page === start.page && back.index === start.anchor,
    shape(back)
  )
}

{
  check(
    "clampToPage still brings a stale index inside its page",
    clampToPage(999, 10) === 9 && clampToPage(-3, 10) === 0 && clampToPage(999, 0) === 999,
    `${clampToPage(999, 10)} ${clampToPage(-3, 10)} ${clampToPage(999, 0)}`
  )
}

// ---- the chunk lattice ------------------------------------------------

{
  const k = SCROLL_CHUNK_SIZE
  check("SCROLL_CHUNK_SIZE is the span-cache unit", k === 320, `${k}`)
  check(
    "item -> (chunk, offset) is the offset-aligned split",
    chunkIndexOf(0, k) === 0 &&
      chunkOffsetOf(0, k) === 0 &&
      chunkIndexOf(k - 1, k) === 0 &&
      chunkOffsetOf(k - 1, k) === k - 1 &&
      chunkIndexOf(k, k) === 1 &&
      chunkOffsetOf(k, k) === 0 &&
      chunkIndexOf(k * 7 + 13, k) === 7 &&
      chunkOffsetOf(k * 7 + 13, k) === 13
  )
}

{
  const k = SCROLL_CHUNK_SIZE
  check(
    "a range inside one chunk warms one chunk",
    shape(chunkRangeFor(10, 40, k)) === shape([0]),
    shape(chunkRangeFor(10, 40, k))
  )
  check(
    "a range across a seam warms both sides",
    shape(chunkRangeFor(k - 1, k, k)) === shape([0, 1]),
    shape(chunkRangeFor(k - 1, k, k))
  )
  check(
    "the last item of a chunk alone stays on that chunk",
    shape(chunkRangeFor(k - 1, k - 1, k)) === shape([0]),
    shape(chunkRangeFor(k - 1, k - 1, k))
  )
  check(
    "a wide range warms every chunk it covers, inclusive",
    shape(chunkRangeFor(k * 2 + 5, k * 5, k)) === shape([2, 3, 4, 5]),
    shape(chunkRangeFor(k * 2 + 5, k * 5, k))
  )
  // The ordinary case at the top of the list: the caller subtracts an
  // overscan from the first visible item and gets a negative start.
  check(
    "a negative start clamps to the first chunk",
    shape(chunkRangeFor(-500, 10, k)) === shape([0]),
    shape(chunkRangeFor(-500, 10, k))
  )
  check(
    "a range that ends before the set begins warms nothing",
    shape(chunkRangeFor(-500, -1, k)) === shape([]),
    shape(chunkRangeFor(-500, -1, k))
  )
  check(
    "an inverted range warms nothing",
    shape(chunkRangeFor(900, 100, k)) === shape([]),
    shape(chunkRangeFor(900, 100, k))
  )
  check(
    "chunkSize < 1 degenerates to a single chunk",
    shape(chunkRangeFor(0, 10_000, 0)) === shape([0]),
    shape(chunkRangeFor(0, 10_000, 0))
  )
}

// ---- the chunk request ------------------------------------------------
//
// Byte-identical bodies are the standing rule (lib/searchRequest.ts): a chunk
// request must differ from any other results request in `page`/`page_size`
// and in NOTHING else, or the same rows end up cached under two keys.

{
  const parts = {
    searchQuery: {
      query: { filters: [] },
      order_by: "last_modified",
      page: 3,
      page_size: 10,
    },
    dbs: { index_db: "index", user_data_db: "user" },
    bookmarkNs: "default",
    partitionBy: ["item_id"],
  }
  const chunk = buildChunkRequest(parts, 0)
  check(
    "chunk 0 is page 1 at the chunk size",
    chunk.body.page === 1 && chunk.body.page_size === SCROLL_CHUNK_SIZE,
    shape({ page: chunk.body.page, page_size: chunk.body.page_size })
  )
  const chunk7 = buildChunkRequest(parts, 7)
  check(
    "chunk N is page N+1",
    chunk7.body.page === 8 && chunk7.body.page_size === SCROLL_CHUNK_SIZE,
    shape({ page: chunk7.body.page, page_size: chunk7.body.page_size })
  )
  check(
    "…and it overrides the URL's own page/page_size rather than inheriting them",
    chunk.body.page !== parts.searchQuery.page &&
      chunk.body.page_size !== parts.searchQuery.page_size
  )
  check(
    "chunk requests carry results, no count, and the standing prefetch policy",
    chunk.body.results === true &&
      chunk.body.count === false &&
      chunk.body.prefetch_rows === 0,
    shape({
      results: chunk.body.results,
      count: chunk.body.count,
      prefetch_rows: chunk.body.prefetch_rows,
    })
  )

  // The byte-identical-body rule checked FIELD BY FIELD, against the ordinary
  // results request rather than against the chunk builder's own definition:
  // equal key sets is half the claim, because an absent field and a set one
  // hash to different cache keys — that split is what this guards.
  const main = buildResultsRequest(parts)
  const keysOf = (o) => Object.keys(o).sort()
  check(
    "chunk and results bodies carry exactly the same set of fields",
    shape(keysOf(main.body)) === shape(keysOf(chunk7.body)),
    `${shape(keysOf(main.body))} vs ${shape(keysOf(chunk7.body))}`
  )
  const differing = keysOf(main.body).filter(
    (key) => shape(main.body[key]) !== shape(chunk7.body[key])
  )
  check(
    "…and the values differ in page/page_size and in nothing else",
    shape(differing) === shape(["page", "page_size"]),
    shape(differing)
  )
  check(
    "…while the params (databases, bookmark namespace) are identical",
    shape(main.params) === shape(chunk7.params),
    shape(chunk7.params)
  )

  // The chunk store tags its wanted set with chunk 0's request hash precisely
  // because it must NOT move on a page/page_size relabel. That only holds if
  // no body field derives from the URL's pagination — guard it, or a future
  // page_size-derived field silently reintroduces the teardown-on-relabel bug.
  const relabeled = {
    ...parts,
    searchQuery: { ...parts.searchQuery, page: 9, page_size: 50 },
  }
  check(
    "parts differing only in page/page_size build an identical chunk request",
    shape(buildChunkRequest(parts, 0)) === shape(buildChunkRequest(relabeled, 0)),
    "chunk-0 request must be pagination-independent"
  )
}

{
  // A vector search. `prefetch_rows` is the one body field whose value depends
  // on the query's *content*, so a chunk of one must carry the budget the main
  // query carries — otherwise the first chunk keys apart from the span the SSR
  // prefetch already warmed. The server treats it as LIMIT max(limit,
  // prefetch), so at a chunk size equal to the budget it is inert; carrying it
  // is about the cache key, not about fetching more rows.
  const parts = {
    searchQuery: {
      query: {
        filters: [
          { semantic: { image_embeddings: { model: "clip", query: "cat" } } },
        ],
      },
      order_by: "last_modified",
      page: 1,
      page_size: 10,
    },
    dbs: { index_db: "index", user_data_db: "user" },
    bookmarkNs: "default",
    partitionBy: ["item_id"],
  }
  const chunk = buildChunkRequest(parts, 3)
  check(
    "a vector query's chunk N carries the prefetch row budget",
    chunk.body.prefetch_rows === 320,
    shape({ prefetch_rows: chunk.body.prefetch_rows })
  )
  check(
    "…and it equals the chunk size, which is what makes it inert",
    chunk.body.prefetch_rows === SCROLL_CHUNK_SIZE &&
      chunk.body.page === 4 &&
      chunk.body.page_size === SCROLL_CHUNK_SIZE,
    shape({ page: chunk.body.page, page_size: chunk.body.page_size })
  )
  check(
    "…and the main results request for the same query carries the same budget",
    buildResultsRequest(parts).body.prefetch_rows === chunk.body.prefetch_rows
  )
}

// ---- the scroll-mode page link ----------------------------------------

const params = (search) => new URLSearchParams(search)
const of = (url) => new URLSearchParams(url)

{
  const base = params("tag.pos_match_all=cat&page=3&top=17&gi=5&order=desc")
  const first = of(getScrollPositionURL(base, 1, 10))
  check(
    "page 1 writes no anchor at all (absent means the top row is visible)",
    !first.has("top"),
    first.toString()
  )
  check("…and no page either", !first.has("page"), first.toString())
  // `gi` is a global index in scroll mode and wins over `top` on load, so a
  // carried-over gallery index would open the link at the item the user is
  // looking at now instead of at the page it is labelled with.
  check("…and no carried-over gallery index", !first.has("gi"), first.toString())
  check(
    "…while every unrelated param survives",
    first.get("tag.pos_match_all") === "cat" && first.get("order") === "desc",
    first.toString()
  )
}

{
  const base = params("page=3&top=17")
  const deep = of(getScrollPositionURL(base, 37, 10))
  check(
    "a deep virtual page becomes top = (N-1)*k",
    deep.get("top") === "360",
    deep.toString()
  )
  check("…with page removed", !deep.has("page"), deep.toString())
  check(
    "…and the derived page number survives the round trip",
    Math.floor(Number(deep.get("top")) / 10) + 1 === 37,
    deep.toString()
  )
}

{
  const base = params("top=999")
  const stale = of(getScrollPositionURL(base, 1, 25))
  check(
    "an existing anchor is cleared, not left behind, when the target is the top",
    !stale.has("top"),
    stale.toString()
  )
  const unbounded = of(getScrollPositionURL(params(""), 5, 0))
  check(
    "k < 1 is one unbounded virtual page, so every link is the top",
    !unbounded.has("top") && !unbounded.has("page"),
    unbounded.toString()
  )
}

{
  // Pages mode's link is untouched by any of this.
  const base = params("tag.pos_match_all=cat&top=17")
  const paged = of(getSearchPageURL(base, 4))
  check(
    "getSearchPageURL still writes a page and drops the anchor",
    paged.get("page") === "4" &&
      !paged.has("top") &&
      paged.get("tag.pos_match_all") === "cat",
    paged.toString()
  )
}

// ---- the scrubber: derived page and its inverse -----------------------
//
// The pagination bar in scroll mode is these two functions and nothing else:
// `virtualPageOf` highlights, `virtualPageAnchor` jumps.

{
  check(
    "the top of the set is page 1",
    virtualPageOf(0, 10) === 1 && virtualPageOf(9, 10) === 1,
    `${virtualPageOf(0, 10)} ${virtualPageOf(9, 10)}`
  )
  check(
    "the page number advances at every k-th item",
    virtualPageOf(10, 10) === 2 && virtualPageOf(364, 10) === 37,
    `${virtualPageOf(10, 10)} ${virtualPageOf(364, 10)}`
  )
  check(
    "an absent anchor and a negative one both read as the top",
    virtualPageOf(0, 25) === 1 && virtualPageOf(-5, 25) === 1
  )
  check(
    "k < 1 is one unbounded virtual page",
    virtualPageOf(999999, 0) === 1,
    `${virtualPageOf(999999, 0)}`
  )
}

{
  // THE INVARIANT OF THE WHOLE FEATURE (design §4), stated in scroll-mode
  // terms: the page the bar highlights is the page whose link you clicked,
  // and it is the same number paginated mode would show for the same item.
  let roundTrips = true
  let matchesPagesMode = true
  for (const k of [1, 10, 25, 100]) {
    for (const n of [1, 2, 7, 37, 1000]) {
      const anchor = virtualPageAnchor(n, k)
      if (virtualPageOf(anchor, k) !== n) roundTrips = false
      // ...and identical to what the mode switch computes for that anchor.
      if (pageStateFromScrollAnchor({ anchor, pageSize: k }).page !== n) {
        matchesPagesMode = false
      }
    }
  }
  check("a virtual page link round-trips to its own page number", roundTrips)
  check(
    "…and agrees with the mode switch's page for the same anchor",
    matchesPagesMode
  )
}

{
  check(
    "page 1 anchors at the top, which the caller writes as an absent param",
    virtualPageAnchor(1, 10) === 0,
    `${virtualPageAnchor(1, 10)}`
  )
  check(
    "a page below 1 cannot produce a negative anchor",
    virtualPageAnchor(0, 10) === 0 && virtualPageAnchor(-3, 10) === 0
  )
  check(
    "k < 1 sends every page to the top of the set",
    virtualPageAnchor(50, 0) === 0,
    `${virtualPageAnchor(50, 0)}`
  )
  // The scrubber click and the scrubber link must land on the same item —
  // they are two writers of one destination (see getScrollPositionURL).
  const linked = new URLSearchParams(getScrollPositionURL(new URLSearchParams(""), 37, 10))
  check(
    "the click's anchor and the link's anchor are the same value",
    Number(linked.get("top")) === virtualPageAnchor(37, 10),
    `${linked.get("top")} vs ${virtualPageAnchor(37, 10)}`
  )
}

// ---- the live highlight: rows, not items -------------------------------
//
// The scrubber writes an ITEM anchor of (N-1)*k, but the grid can only ever
// read back a ROW. `topRowHighlightItem` is the bridge, and the property it
// has to have is that a click on page N leaves the bar highlighting page N.

{
  // The lattice failure this exists for: k=10, 3 columns. Page 5's anchor is
  // item 40, which sits at offset 1 of row 13 — so the row STARTS at item 39,
  // on page 4. Read as `startRow * columns` the bar would flip to 4.
  const columns = 3
  const k = 10
  const itemCount = 10_000
  const anchor = virtualPageAnchor(5, k)
  const startRow = Math.floor(anchor / columns)
  check(
    "the naive read really does flip the page (the bug being fixed)",
    virtualPageOf(startRow * columns, k) === 4,
    `${virtualPageOf(startRow * columns, k)}`
  )
  const item = topRowHighlightItem(startRow, columns, itemCount, false)
  check(
    "…and the top row's LAST item keeps it on the clicked page",
    virtualPageOf(item, k) === 5,
    `item=${item} page=${virtualPageOf(item, k)}`
  )
}

{
  // The same claim swept: for every k/columns pair, clicking page N and
  // scrolling that anchor's row to the top must highlight N. `columns` values
  // that share no factor with k are the ones that break the naive read.
  let ok = true
  let firstBad = ""
  const itemCount = 100_000
  for (const k of [1, 7, 10, 25, 100]) {
    for (const columns of [1, 2, 3, 4, 5]) {
      // A row wider than a virtual page spans SEVERAL of them, so no single
      // page number can be "the" answer for it; that degenerate geometry is
      // asserted on its own terms below.
      if (columns > k) continue
      for (const n of [1, 2, 3, 7, 37, 100]) {
        const anchor = virtualPageAnchor(n, k)
        const startRow = Math.floor(anchor / columns)
        const item = topRowHighlightItem(startRow, columns, itemCount, false)
        const derived = virtualPageOf(item, k)
        if (derived !== n) {
          ok = false
          if (!firstBad) {
            firstBad = `k=${k} columns=${columns} n=${n} -> anchor=${anchor} row=${startRow} item=${item} page=${derived}`
          }
        }
      }
    }
  }
  check("a scrubber click to page N highlights page N, at every geometry", ok, firstBad)
}

{
  // A row wider than k: it covers `columns / k` virtual pages at once, and the
  // rule names the LAST one it contains. Stated rather than avoided — this is
  // page_size = 1 on a multi-column grid, and the bar is then labelling
  // individual items.
  check(
    "a row spanning several virtual pages highlights the last one it covers",
    virtualPageOf(topRowHighlightItem(0, 4, 1000, false), 1) === 4,
    `${virtualPageOf(topRowHighlightItem(0, 4, 1000, false), 1)}`
  )
}

{
  // The bottom of the set. Scrolling CLAMPS: the top row can never go past
  // `rowCount - visibleRows`, so the final virtual pages are unreachable by
  // the top row at any scroll position — which is what the last-row rule is
  // for. 95 items over 4 columns is 24 rows and 10 virtual pages at k = 10;
  // with three rows in view the top row stops at 21.
  const columns = 4
  const k = 10
  const itemCount = 95
  const rowCount = Math.ceil(itemCount / columns)
  const maxTopRow = rowCount - 3
  check(
    "…so at maximum scroll the top row alone falls short of the last page",
    virtualPageOf(topRowHighlightItem(maxTopRow, columns, itemCount, false), k) < 10,
    `${virtualPageOf(topRowHighlightItem(maxTopRow, columns, itemCount, false), k)}`
  )
  const item = topRowHighlightItem(maxTopRow, columns, itemCount, true)
  check(
    "the last row being visible highlights the last page instead",
    item === itemCount - 1 && virtualPageOf(item, k) === 10,
    `item=${item} page=${virtualPageOf(item, k)}`
  )
}

{
  check(
    "the top of the set is page 1's first row, not an off-by-one into page 2",
    virtualPageOf(topRowHighlightItem(0, 5, 1000, false), 10) === 1,
    `${virtualPageOf(topRowHighlightItem(0, 5, 1000, false), 10)}`
  )
  check(
    "a short set never derives past its own last item",
    topRowHighlightItem(0, 5, 3, false) === 2 &&
      topRowHighlightItem(4, 5, 3, false) === 2,
    `${topRowHighlightItem(0, 5, 3, false)} ${topRowHighlightItem(4, 5, 3, false)}`
  )
  check(
    "an empty set and a not-yet-measured layout both degenerate safely",
    topRowHighlightItem(0, 5, 0, false) === 0 &&
      topRowHighlightItem(0, 5, 0, true) === 0 &&
      topRowHighlightItem(3, 0, 1000, false) === 3,
    `${topRowHighlightItem(0, 5, 0, false)} ${topRowHighlightItem(3, 0, 1000, false)}`
  )
}

// ---- fetch margin ------------------------------------------------------

{
  check(
    "the warm margin is two rows of overscan on each side, in items",
    overscanItemsFor(4, 3) === 24,
    `${overscanItemsFor(4, 3)}`
  )
  check(
    "a not-yet-measured layout (columns 0) still warms something",
    overscanItemsFor(0, 3) === 6,
    `${overscanItemsFor(0, 3)}`
  )
  check("no overscan means no margin", overscanItemsFor(5, 0) === 0)
  // The margin only earns its name if it reaches past the chunk the visible
  // range sits in — otherwise the overscan rows are the ones showing
  // skeletons, which is the failure it exists to prevent.
  const columns = 5
  const margin = overscanItemsFor(columns, 3)
  const warmed = chunkRangeFor(319 - margin, 320 + margin, SCROLL_CHUNK_SIZE)
  check(
    "a range straddling a chunk seam warms both chunks",
    warmed.length === 2 && warmed[0] === 0 && warmed[1] === 1,
    shape(warmed)
  )
}

// ---- the advance scan --------------------------------------------------
//
// The forward scan behind the gallery's auto-advance and its ahead-of-turn
// prefetch (docs/video-end-action-design.md §3, generalized onto ResultsSource
// by docs/search-scroll-mode-design.md §8). Two block shapes stand in for the
// two modes: ONE block covering the whole page (what arrayResultsSource
// serves) and a chunk lattice with holes in it (what the chunk store serves).

// Pages mode: the source's single block is the page's array.
const pageBlocks = (rows) => (i) =>
  i >= 0 && i < rows.length ? { start: 0, rows } : undefined
// Scroll mode: a sparse lattice. `chunks` maps a chunk index to its rows;
// anything absent is "not loaded".
const chunkBlocks = (chunks, size) => (i) => {
  const chunkIndex = Math.floor(Math.max(i, 0) / size)
  const rows = chunks[chunkIndex]
  return rows ? { start: chunkIndex * size, rows } : undefined
}
const isVideo = (row) => row === "v"

{
  check("the chunk start of an index is its chunk's first item",
    chunkStartOf(0, 320) === 0
    && chunkStartOf(319, 320) === 0
    && chunkStartOf(320, 320) === 320
    && chunkStartOf(1000, 320) === 960,
    `${chunkStartOf(1000, 320)}`)
  check("an unpaginated chunk size is one chunk starting at 0",
    chunkStartOf(500, 0) === 0)
}

{
  // Pages mode, a match ahead: exactly the `for (i = index + 1; ...)` loop
  // this replaced, including that the scan starts AFTER the current item.
  const rows = ["v", "i", "i", "v", "i"]
  const scan = scanLoadedForward(pageBlocks(rows), 1, rows.length, isVideo)
  check("the next playable item ahead is the match",
    scan.match === 3 && scan.stopped === 3, shape(scan))
  const fromMatch = scanLoadedForward(pageBlocks(rows), 3, rows.length, isVideo)
  check("a match at the scan's own start is found there",
    fromMatch.match === 3, shape(fromMatch))
}

{
  // Pages mode, nothing ahead: `stopped` is the end of the page, which is the
  // signal that the turn (if any) is a PAGE turn. The chunked continuation is
  // unreachable in pages mode precisely because this can never be less.
  const rows = ["v", "i", "i"]
  const scan = scanLoadedForward(pageBlocks(rows), 1, rows.length, isVideo)
  check("no match on the page stops at the end of the page",
    scan.match === null && scan.stopped === rows.length, shape(scan))
}

{
  // Scroll mode: chunk 0 loaded and videoless, chunk 1 never fetched, the set
  // far longer. The scan must stop at the seam and name it — that index is
  // what the continuation fetches.
  const size = 4
  const scan = scanLoadedForward(
    chunkBlocks({ 0: ["v", "i", "i", "i"] }, size),
    1,
    100,
    isVideo
  )
  check("running off the loaded range stops at the first unloaded index",
    scan.match === null && scan.stopped === 4, shape(scan))
}

{
  // A hole between two loaded chunks: the scan must stop AT the hole rather
  // than jump it, or the continuation would fetch the wrong chunk and the
  // chain would skip a stretch of the set unseen.
  const size = 4
  const scan = scanLoadedForward(
    chunkBlocks({ 0: ["v", "i", "i", "i"], 2: ["v", "v", "v", "v"] }, size),
    1,
    100,
    isVideo
  )
  check("a hole stops the scan even with loaded rows beyond it",
    scan.match === null && scan.stopped === 4, shape(scan))
}

{
  // The count is the bound, not the lattice: a last chunk longer than the
  // remaining results must not be scanned past the end of the set.
  const size = 4
  const scan = scanLoadedForward(
    chunkBlocks({ 0: ["i", "i", "i", "v"] }, size),
    0,
    3,
    isVideo
  )
  check("the scan never looks past the result count",
    scan.match === null && scan.stopped === 3, shape(scan))
}

{
  // The past-the-end chunk: a request beyond the last result answers with an
  // empty page, and an empty block covers nothing. It must terminate the scan
  // rather than loop on an index its own block does not reach.
  const size = 4
  const scan = scanLoadedForward(
    chunkBlocks({ 0: ["v", "i", "i", "i"], 1: [] }, size),
    1,
    100,
    isVideo
  )
  check("an empty block ends the scan instead of spinning",
    scan.match === null && scan.stopped === 4, shape(scan))
}

{
  // The continuation's own scan of the chunk it just fetched: ONE block, read
  // from the index that ended the session forward — never from the block's
  // start, which can lie behind it.
  const block = { start: 8, rows: ["i", "v", "i", "v"] }
  const scan = scanLoadedForward(() => block, 10, 12, isVideo)
  check("the fetched chunk is scanned forward from the landing index",
    scan.match === 11, shape(scan))
  const none = scanLoadedForward(
    () => ({ start: 8, rows: ["i", "i", "i", "i"] }),
    10,
    12,
    isVideo
  )
  check("a videoless fetched chunk reports no match, which ends the chain",
    none.match === null && none.stopped === 12, shape(none))
}

{
  // A scan starting at the end of the set has nothing to do, and one starting
  // past it is the last item's own advance: both must terminate immediately.
  check("a scan at the end of the set finds nothing",
    scanLoadedForward(pageBlocks(["v"]), 1, 1, isVideo).stopped === 1)
  // …and one starting past the end reports the END, not its own start: the
  // caller reads `stopped < count` as "there are unfetched items ahead", and
  // an out-of-range start must never be mistaken for one.
  check("a scan past the end of the set reports the end of the set",
    scanLoadedForward(pageBlocks(["v"]), 5, 1, isVideo).stopped === 1)
}

// ---- creation defaults -------------------------------------------------
//
// The layer that stamps a user's saved presentation into a brand-new search
// session (docs/search-scroll-mode-design.md §7, lib/searchDefaults.ts).

{
  // THE property, stated so it survives any future change of a creation
  // default: with nothing saved, the stamp is exactly the keys whose
  // creation default differs from the codec default — no more (a stamped
  // codec value is noise in every URL of the session) and no less (a
  // differing default that never reaches the URL is a default that does
  // nothing). As shipped both sides are empty, which is the same statement
  // as "a user who saved nothing gets byte-identical URLs to the ones they
  // got before this layer existed".
  const stamped = Object.keys(creationStamp(effectiveCreationDefaultsFrom({})))
    .sort()
  const differing = SEARCH_DEFAULTABLE_KEYS
    .filter((key) => SEARCH_DEFAULTABLE_PARAMS[key].creationDefault
      !== SEARCH_DEFAULTABLE_PARAMS[key].codecDefault)
    .sort()
  check(
    "with nothing saved, the stamp is exactly the keys whose creation default differs from the codec default",
    shape(stamped) === shape(differing),
    `${shape(stamped)} vs ${shape(differing)}`
  )
  // The single line this release's rollout decision is written on. Flipping
  // vm's creation default to "scroll" (design §7) means deleting this line
  // and nothing else in this file — the property above already covers the
  // flipped state. It cannot rewrite anybody's URLs either way: creation
  // defaults only touch sessions created after the flip, and the codec
  // default stays "pages" forever.
  check(
    "vm ships opt-in this release (delete this line with the creation-default flip; design §7 rollout)",
    SEARCH_DEFAULTABLE_PARAMS.vm.creationDefault === "pages",
    shape(SEARCH_DEFAULTABLE_PARAMS.vm.creationDefault)
  )
}

{
  // A saved default that differs from the codec default is what a stamp is
  // FOR, and only the differing parameter is written: stamping a value the
  // absent parameter already means would add noise to every URL of the
  // session (and nuqs would strip `vm=pages` on the next write anyway).
  const scrollOnly = creationStamp(effectiveCreationDefaultsFrom({ vm: "scroll" }))
  check(
    "a saved scroll default stamps vm and nothing else",
    scrollOnly.vm === "scroll" && scrollOnly.page_size === undefined,
    shape(scrollOnly)
  )
  const sized = creationStamp(effectiveCreationDefaultsFrom({ page_size: 40 }))
  check(
    "a saved page size stamps page_size and nothing else",
    sized.page_size === 40 && sized.vm === undefined,
    shape(sized)
  )
  const both = creationStamp(
    effectiveCreationDefaultsFrom({ vm: "scroll", page_size: 40 })
  )
  check(
    "both saved, both stamped",
    both.vm === "scroll" && both.page_size === 40,
    shape(both)
  )
  // Saving the built-in values explicitly is not the same gesture as saving
  // nothing — the payload exists — but it must produce the same URLs.
  const asShipped = creationStamp(
    effectiveCreationDefaultsFrom({ vm: "pages", page_size: 10 })
  )
  check(
    "saving the built-in values stamps nothing",
    Object.keys(asShipped).length === 0,
    shape(asShipped)
  )
}

{
  // Partial payloads: a user who saved defaults before a key existed must
  // resolve the missing one to its creation default rather than undefined —
  // an undefined reaching the stamp would write "undefined" into a URL.
  const resolved = effectiveCreationDefaultsFrom({ vm: "scroll" })
  check(
    "an absent key resolves to its creation default",
    resolved.page_size === SEARCH_DEFAULTABLE_PARAMS.page_size.creationDefault,
    shape(resolved)
  )
}

{
  // The allowlist. Stale or hand-edited localStorage is the input here, and
  // its whole output ends up in URLs, so anything not exactly in domain is
  // dropped rather than coerced.
  check(
    "junk keys never survive",
    shape(sanitizeSearchDefaults({ vm: "scroll", page: 3, tag: "x", gi: 7 }))
      === shape({ vm: "scroll" })
  )
  check(
    "vm must be one of the two enum members",
    shape(sanitizeSearchDefaults({ vm: "Scroll" })) === shape({})
      && shape(sanitizeSearchDefaults({ vm: "" })) === shape({})
      && shape(sanitizeSearchDefaults({ vm: true })) === shape({})
  )
  check(
    "a non-object payload is no defaults at all",
    shape(sanitizeSearchDefaults(null)) === shape({})
      && shape(sanitizeSearchDefaults("scroll")) === shape({})
      && shape(sanitizeSearchDefaults(undefined)) === shape({})
      && shape(sanitizeSearchDefaults([])) === shape({})
  )
  check(
    "page_size is floored to an integer",
    sanitizeSearchDefaults({ page_size: 12.7 }).page_size === 12
  )
  check(
    "page_size is clamped into the control's own range",
    sanitizeSearchDefaults({ page_size: 99999 }).page_size === 10000
      && sanitizeSearchDefaults({ page_size: 0 }).page_size === undefined
      && sanitizeSearchDefaults({ page_size: -5 }).page_size === undefined
  )
  check(
    "a non-numeric page size is dropped, not parsed",
    sanitizeSearchDefaults({ page_size: "40" }).page_size === undefined
      && sanitizeSearchDefaults({ page_size: NaN }).page_size === undefined
      && sanitizeSearchDefaults({ page_size: Infinity }).page_size === undefined
  )
}

{
  // The presence check that decides whether a load creates a session. Every
  // defaultable key must be in it — a parameter that can be stamped but does
  // not block stamping would be overwritten on the very next load of a URL
  // carrying it.
  for (const key of SEARCH_DEFAULTABLE_KEYS) {
    check(
      `${key} blocks stamping when it is already in the URL`,
      SESSION_PARAM_KEYS.includes(key)
    )
  }
  // The position parameters belong to a session that is already under way,
  // and `page` is the legacy paginated link the design refuses to convert.
  check(
    "the position parameters block stamping too",
    ["page", "top", "gi"].every((key) => SESSION_PARAM_KEYS.includes(key))
  )
  // The predicate itself, on real URLSearchParams — the same function both
  // call sites in app/search/SearchPage.tsx use (the mount snapshot and the
  // live window.location.search re-check).
  //
  // Filters deliberately do NOT block a stamp: a shared filter link gets the
  // recipient's presentation over an identical result set (design §7).
  check(
    "an empty URL is a fresh session",
    isFreshSession(new URLSearchParams(""))
  )
  check(
    "a filter-only URL is still a fresh session",
    isFreshSession(new URLSearchParams("tag.pos_match_all=cat&at.query=hello"))
  )
  check(
    "a filter URL carrying a page is not",
    !isFreshSession(new URLSearchParams("tag.pos_match_all=cat&page=3"))
  )
  // PRESENCE, never value. A zero is a parameter something wrote — `page=0`
  // survives from a hand-edited or generated link, `top=0` is the top of the
  // set in scroll mode, `gi=0` is the gallery open on the first item — and
  // each of them states a presentation the stamp must not overwrite.
  check(
    "?page=0 is present, so not a fresh session",
    !isFreshSession(new URLSearchParams("page=0"))
  )
  check(
    "?top=0 is present, so not a fresh session",
    !isFreshSession(new URLSearchParams("top=0"))
  )
  check(
    "?gi=0 is present, so not a fresh session",
    !isFreshSession(new URLSearchParams("gi=0"))
  )
}

console.log(all ? "\nALL PASS" : "\nFAILURES")
process.exit(all ? 0 : 1)
