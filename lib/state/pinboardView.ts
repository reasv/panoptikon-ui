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
