"use client"

import { createContext, useContext } from "react"
import type { FileActionTarget } from "@/lib/relayContext"

/**
 * THE per-row action surface, published ONCE by CellActionsHost
 * (components/CellActionsHost.tsx) and consumed by every component that is
 * mounted per grid cell, per pin and per filmstrip card.
 *
 * WHY THIS EXISTS. `SearchResultImage` is `React.memo`'d because the
 * virtualized grid re-renders on every scroll frame (TanStack Virtual mutates
 * state under `"use no memo"`). That memo was being defeated FROM THE INSIDE:
 * the card and its four overlay buttons owned ~19 nuqs hook instances and ~5
 * toast listeners between them, and every nuqs hook is its own
 * `useSearchParams` subscriber — so ANY URL write (notably scroll mode's
 * `top` write on scroll stop, a `history: "replace"` that happens every time
 * the user stops scrolling) re-rendered every visible card body regardless of
 * its props.
 *
 * The remedy is the FindNavigator idiom one level further
 * (components/gallery/FindButton.tsx, lib/state/findNavigatorApi.ts): ONE
 * owner holds the hooks, the rows read what they need through a handle. Two
 * channels, and the split is the whole design:
 *
 *   - CALLBACKS (`useCellCallbacks`) — a stable object, `useMemo`'d with an
 *     empty dep list, whose methods read the owner's live values off a ref at
 *     INVOCATION time. Its identity never changes for the life of the host,
 *     so consuming it can never re-render anything. Everything a row only
 *     needs when the user actually presses something lives here.
 *   - FLAGS (`useCellFlags`) — the values a row RENDERS from (a bookmark's
 *     namespace in a title, whether the pane is open, whether this item is
 *     pinned). Consumers DO re-render when these change, which is correct and
 *     is what they did before; the point is that the object is memoized on
 *     the primitives themselves, so a URL write that touches none of them
 *     produces no new value and therefore no re-render.
 *
 * Context rather than a store, for the same reason usePaneRouting gave for
 * PinboardMaximizedContext before it: a store written from an effect is one
 * commit behind the URL, and context carries the value in the same render
 * pass that computed it. It also propagates through the `React.memo`
 * boundaries the rows sit behind, which is the entire point.
 */
export interface CellFlags {
  /** The selected databases, for per-row queries that still need them. */
  dbs: { index_db: string | null; user_data_db: string | null }
  /** The active bookmark group (zustand `useBookmarkNs`). */
  bookmarkNamespace: string
  /** `bk-show`: keep bookmarked cards' buttons visible without hover. */
  alwaysShowBookmark: boolean
  /** Client config's `disableBackendOpen`. */
  disableBackendOpen: boolean
  relayDetected: boolean
  relayPaired: boolean
  relayPairing: boolean
  relayPairingPending: boolean
  actionTarget: FileActionTarget
  /**
   * Whether a copy-as-file route exists at all (relay copy or server copy) —
   * `useFileShare`'s `primaryVerb === "copy"`, hoisted. Decides whether the
   * action cluster offers a Copy slot.
   */
  canCopy: boolean
  /** Is a details pane on screen at all? (see useDataViewPane) */
  paneOpen: boolean
  /** Is the pane on screen AND showing the per-item Data View? */
  dataViewOpen: boolean
  /**
   * The 10-char sha256 prefixes currently on the pinboard — the same prefix
   * comparison PinButton used to run over `records` itself. A Set so the
   * per-row test is a hash lookup rather than a scan of the whole board, and
   * built once per layout change instead of once per pin per render.
   */
  pinnedPrefixes: ReadonlySet<string>
}

/** A file a row action addresses. */
export interface CellFileRef {
  sha256: string
  path?: string
}

export interface CellCallbacks {
  /**
   * Toggle the item's membership in the active bookmark group, patching the
   * search cache and toasting exactly as the per-card handler did.
   */
  toggleBookmark(sha256: string, isBookmarked: boolean): void
  openFile(file: CellFileRef): void
  showInFolder(file: CellFileRef): void
  setActionTarget(target: FileActionTarget): void
  pairRelay(): Promise<void>
  /** The adaptive share verb: relay copy, server copy, or download. */
  shareFile(file: CellFileRef): Promise<void>
  downloadFile(file: CellFileRef): Promise<void>
  openDataView(item?: SearchResult): void
  closeDataView(): void
  /**
   * Pin/unpin. `layoutKey` binds the press to one board copy (the board's own
   * unpin buttons); `shiftKey` is the sticky-carry gesture, which only applies
   * to the unbound form.
   */
  togglePin(sha256: string, opts?: { layoutKey?: string; shiftKey?: boolean }): void
  /**
   * The gallery href for a row at `index`: the CURRENT URL with `gi` set.
   *
   * Built here rather than in the card because the card's version copied the
   * whole `URLSearchParams` and re-ran the serializer per card per render,
   * behind a `useMemo` keyed on `params` — i.e. it recomputed on every URL
   * write, for every visible card. The host holds the params; a card that
   * does not re-render therefore keeps the href it last computed, and
   * refreshes it on hover (see SearchResultImage) — which is ahead of every
   * gesture that can consume an href (middle click, "open in new tab", copy
   * link address, drag).
   */
  galleryHref(index: number): string
}

/**
 * The inert defaults, for a consumer mounted with no host above it. Nothing
 * ships in that position today — the host wraps the whole search page, which
 * is the only page that mounts any of these — but a silent no-op beats a
 * crash if a future surface forgets the host, and the console line names the
 * cause.
 */
export const INERT_CELL_FLAGS: CellFlags = {
  dbs: { index_db: null, user_data_db: null },
  bookmarkNamespace: "default",
  alwaysShowBookmark: false,
  disableBackendOpen: false,
  relayDetected: false,
  relayPaired: false,
  relayPairing: false,
  relayPairingPending: false,
  actionTarget: "existing",
  canCopy: false,
  paneOpen: false,
  dataViewOpen: false,
  pinnedPrefixes: new Set<string>(),
}

const missing = (verb: string) => {
  console.error(
    `Cell action "${verb}" was invoked with no CellActionsHost mounted above it`
  )
}

export const INERT_CELL_CALLBACKS: CellCallbacks = {
  toggleBookmark: () => missing("toggleBookmark"),
  openFile: () => missing("openFile"),
  showInFolder: () => missing("showInFolder"),
  setActionTarget: () => missing("setActionTarget"),
  pairRelay: async () => missing("pairRelay"),
  shareFile: async () => missing("shareFile"),
  downloadFile: async () => missing("downloadFile"),
  openDataView: () => missing("openDataView"),
  closeDataView: () => missing("closeDataView"),
  togglePin: () => missing("togglePin"),
  galleryHref: () => "",
}

export const CellFlagsContext = createContext<CellFlags>(INERT_CELL_FLAGS)
export const CellCallbacksContext =
  createContext<CellCallbacks>(INERT_CELL_CALLBACKS)

/** Values a row RENDERS from. Reading these re-renders the row when they change. */
export const useCellFlags = () => useContext(CellFlagsContext)

/**
 * The imperative half. The value's identity is fixed for the host's lifetime,
 * so reading it costs a row nothing and never re-renders it — read it freely
 * even in components that must stay out of every re-render path.
 */
export const useCellCallbacks = () => useContext(CellCallbacksContext)
