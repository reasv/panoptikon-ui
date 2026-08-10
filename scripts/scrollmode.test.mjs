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
  clampToPage,
  pageStateFromScrollAnchor,
  remapPageAnchor,
  scrollAnchorFromPage,
} = await import("../lib/scrollMode.ts")
const { SCROLL_CHUNK_SIZE, buildChunkRequest, buildResultsRequest } =
  await import("../lib/searchRequest.ts")
const { getScrollPositionURL, getSearchPageURL } = await import(
  "../lib/state/searchQuery/serializers.ts"
)

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
  // The mode switch is the page-size remap with no pagination on one side —
  // the same function, which is why the invariant holds at all.
  const viaRemap = remapPageAnchor({
    page: 37,
    pageSize: 10,
    nextPageSize: 0,
    anchor: 4,
  })
  check(
    "the switch is remapPageAnchor with an unbounded page on the far side",
    viaRemap.index === scrollAnchorFromPage({ page: 37, pageSize: 10, anchor: 4 }),
    shape(viaRemap)
  )
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
    "the chunk body is the ordinary results body with pagination overridden",
    shape(chunk) ===
      shape(buildResultsRequest(parts, { page: 1, pageSize: SCROLL_CHUNK_SIZE })),
    shape(chunk)
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
}

// ---- the scroll-mode page link ----------------------------------------

const params = (search) => new URLSearchParams(search)
const of = (url) => new URLSearchParams(url)

{
  const base = params("tag.pos_match_all=cat&page=3&top=17&order=desc")
  const first = of(getScrollPositionURL(base, 1, 10))
  check(
    "page 1 writes no anchor at all (absent means the top row is visible)",
    !first.has("top"),
    first.toString()
  )
  check("…and no page either", !first.has("page"), first.toString())
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

console.log(all ? "\nALL PASS" : "\nFAILURES")
process.exit(all ? 0 : 1)
