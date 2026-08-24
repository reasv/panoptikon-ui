// "The pinboard is maximized" — the predicate that decides whether running
// a search is worth anything.
//
// Maximizing (the Maximize Pinboard verb, Ctrl+Shift+M — both just set
// ?gf=true) hides every consumer of the search results: the search bar, the
// result count, the pagination and the result grid itself. Nothing on
// screen is derived from the search, yet the queries stayed mounted, so a
// window refocus — or merely opening a saved board URL — re-ran the whole
// query. For an embedding query that means loading a model to produce
// results nobody can see. Both the client hook (useSearch) and the SSR
// prefetch gate on this, so opening a board link costs no search on either
// side.
//
// gf alone is not the signal: in the gallery host it also means "fullscreen
// image", which still needs the results for prev/next. The board must
// actually BE what's on screen — ghp off in the gallery host, gpb on in the
// grid host — and a board must exist, either resolved (pinboard) or still
// being fetched from a deferred link (pbl).
//
// Lives apart from state/gallery.ts because that module is client-only
// ("nuqs"); this one is imported by the server prefetch too and may only
// touch nuqs/server.

import { parseAsArrayOf, parseAsBoolean, parseAsString } from "nuqs/server"

export interface PinboardViewState {
  /** gf */
  fs: boolean
  /** ghp — the gallery host's board/image tab choice */
  hidePinBoard: boolean
  /** gpb — the grid host's board/results tab choice */
  gridTab: boolean
  /** pinboard */
  pinboard: string[]
  /** pbl — a deferred board load that hasn't resolved into a layout yet */
  pbl: string | null
}

export function isPinboardMaximized(state: PinboardViewState): boolean {
  const hasBoard = state.pinboard.length > 0 || state.pbl != null
  return state.fs && hasBoard && (!state.hidePinBoard || state.gridTab)
}

/**
 * The same predicate over raw search params, for the server render. The
 * parsers and defaults must mirror state/gallery.ts exactly — those
 * defaults are wire format (see the note there).
 */
export function isPinboardMaximizedFromParams(params: {
  [key: string]: string | string[] | undefined
}): boolean {
  return isPinboardMaximized({
    fs: parseAsBoolean.withDefault(false).parseServerSide(params.gf),
    hidePinBoard: parseAsBoolean.withDefault(false).parseServerSide(params.ghp),
    gridTab: parseAsBoolean.withDefault(false).parseServerSide(params.gpb),
    pinboard: parseAsArrayOf(parseAsString)
      .withDefault([])
      .parseServerSide(params.pinboard),
    pbl: parseAsString.parseServerSide(params.pbl),
  })
}

// "Search is suppressed" — the maximize rationale above, scoped to "no
// consumer is on screen": the maximized board's bottom search overlay
// puts a search bar and result count OVER the board, so a shown overlay is
// a consumer and the queries must run for it. `gso` is the overlay's
// PINNED flag; the transient hover/focus reveal is client-only state
// (lib/state/searchOverlayReveal.ts) that the client hook
// useSearchSuppressed (lib/state/gallery.ts) layers on top of this pure
// predicate — suppressed = maximized && !pinned && !revealed. This module
// stays `gso`-only on purpose: the SSR prefetch has no reveal to consult,
// so a cold load is either pinned-open or closed. The search gates
// (useSearch, the chunk store, the SSR prefetch) all switched from
// isPinboardMaximized to this — isPinboardMaximized itself keeps its other
// consumers (sidebar hiding, host latching) unchanged. `gsv`, the pinned
// item viewer (§8.3), joins `gso` here: see below. The SIDEBAR overlay
// (`gsb`) deliberately does not — it edits the query, it does not consume
// results (§9). See docs/maximized-pinboard-search-overlay-design.md §2/§4.
export interface SearchSuppressionState extends PinboardViewState {
  /** gso — the maximized board's search overlay PINNED flag */
  searchOverlay: boolean
  /** gsv — the maximized board's pinned item viewer */
  viewer: boolean
}

// The viewer counts as a consumer for the same reason the dock does, and it
// has to: it PAINTS a result row and browses the set with the arrow keys, so
// with the queries withheld a cold load of `gsv=true` would open onto a
// permanent loading frame — and the flag's whole contract is that it is
// refresh-safe (§8.3). It is reachable without `gso`: opening the viewer
// auto-pins the dock, but Ctrl+Shift+F (or Back) can unpin it again while
// the viewer stays up, and that URL must reload into a working viewer.
export function isSearchSuppressed(state: SearchSuppressionState): boolean {
  return isPinboardMaximized(state) && !state.searchOverlay && !state.viewer
}

/**
 * The suppression predicate over raw search params, for the server render.
 * The gso/gsv parsers mirror state/gallery.ts exactly, like every parser in
 * this file — their defaults are wire format (see the note there).
 */
export function isSearchSuppressedFromParams(params: {
  [key: string]: string | string[] | undefined
}): boolean {
  return (
    isPinboardMaximizedFromParams(params) &&
    !parseAsBoolean.withDefault(false).parseServerSide(params.gso) &&
    !parseAsBoolean.withDefault(false).parseServerSide(params.gsv)
  )
}
