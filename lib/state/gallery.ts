import {
  createSerializer,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  useQueryState,
} from "nuqs"
import type { TrimRange } from "@/lib/pinboardCrop"
import { encodeGalleryTrim, parseGalleryTrim } from "@/lib/galleryTrim"
import { isPinboardMaximized, isSearchSuppressed } from "./pinboardView"
import { useSearchOverlayReveal } from "./searchOverlayReveal"
import { useGridScrollAnchor } from "./gridScroll"

const useGalleryIndex = () =>
  useQueryState(
    "gi",
    parseAsInteger.withOptions({
      history: "push",
    })
  )

// MANUAL navigation's position write, shared by every surface that moves the
// gallery position by item: the gallery's arrows, the click-through halves of
// the large image, the ← / → keys and the filmstrip — and the maximized
// board's search-overlay strip, which is why it lives here rather than inside
// ImageGallery (docs/maximized-pinboard-search-overlay-design.md §5.3: one
// write, two mounts, so they cannot drift).
//
// In scroll mode the grid's anchor FOLLOWS `gi`, the same rule the advance
// chain already states for its own landings ("the anchor follows the
// position", and absent while that position is the top of the set): the grid
// is unmounted while the gallery is open, so the anchor is the only record of
// where the user got to, and without this a binge from item 5000 to item 8000
// would put the grid back at 5000 on close — outside the ensure-visible scan
// window, so not even the selected item would be found
// (docs/search-scroll-mode-design.md §8). It also gives the pagination bar
// under the open gallery (and under the maximized board's search overlay) the
// only position signal it can have while the grid is gone (see
// useDerivedVirtualPage in SearchPage).
//
// "replace", like every other position write on this path: stepping is not
// navigation to bury the Back button under.
//
// PAGES MODE writes nothing here. `top` is a within-page index there, kept by
// the grid from its own scroll position, and the value of a step within a
// page is not it — that mode's `gi` and `top` answer different questions.
const useGalleryNavigate = (scrollMode: boolean) => {
  const setIndex = useGalleryIndex()[1]
  const setScrollAnchor = useGridScrollAnchor()[1]
  // `options` exists for the ONE caller whose write is not a user gesture:
  // the maximized viewer's auto-advance chain, which must land with
  // "replace" or an unattended binge buries the back button under one entry
  // per video (the rule the gallery's own chain already follows,
  // docs/video-end-action-design.md §4). Omitted, nuqs uses the param's own
  // history mode — so every existing call site is unchanged.
  return (target: number, options?: { history: "push" | "replace" }) => {
    setIndex(target, options)
    if (!scrollMode) return
    setScrollAnchor(target > 0 ? target : null, { history: "replace" })
  }
}

const useGalleryThumbnail = () =>
  useQueryState(
    "gt",
    parseAsBoolean.withDefault(true).withOptions({
      clearOnDefault: true,
      history: "push",
    })
  )
const useGalleryFullscreen = () =>
  useQueryState(
    "gf",
    parseAsBoolean.withDefault(false).withOptions({
      clearOnDefault: false,
      history: "push",
    })
  )

// The maximized board's bottom search overlay PINNED flag
// (docs/maximized-pinboard-search-overlay-design.md §2): pinned means the
// open panel SURVIVES an outside click or Esc, which an open-but-unpinned
// one does not — plus reload and Back, since pin is URL state while open is
// not. The ephemeral OPEN state is client state in
// lib/state/searchOverlayReveal.ts, not here — opening the dock for one
// search must never rewrite history. history "push" so Back unpins;
// clearOnDefault so clean board links stay clean and "open maximized in a
// new tab" carries no stray flag. The default is mirrored by the
// server-side parser in lib/state/pinboardView.ts — wire format, like
// every flag in this file.
const useSearchOverlayOpen = () =>
  useQueryState(
    "gso",
    parseAsBoolean.withDefault(false).withOptions({
      history: "push",
      clearOnDefault: true,
    })
  )

// The maximized board's PINNED ITEM VIEWER flag
// (docs/maximized-pinboard-search-overlay-design.md §8.3): true while the
// centered viewer — GalleryImageLarge over the board, which is how video
// playback reaches the maximized workspace — is open. In the URL because
// the viewer is a place the user IS, not a hover: it survives refresh, and
// history "push" makes Back close it, which is the gesture people reach for
// first. clearOnDefault so a clean board link carries no stray flag.
//
// WHICH item it shows is not stored here: "selected" (`gi`, the blue ring)
// and "the item in the viewer" are the same thing by §8's identity rule, so
// this flag is open/closed and nothing else. Unlike `gsb` it DOES take part
// in the search-suppression gate — the viewer paints a result row and
// browses the set, so it is a consumer on screen (see
// lib/state/pinboardView.ts).
const useSearchViewerOpen = () =>
  useQueryState(
    "gsv",
    parseAsBoolean.withDefault(false).withOptions({
      history: "push",
      clearOnDefault: true,
    })
  )

// The maximized board's LEFT-edge sidebar overlay PINNED flag
// (docs/maximized-pinboard-search-overlay-design.md §9): the same dock
// model as `gso`, rotated, revealing the search sidebar over the board.
// Deliberately NOT `sb` (lib/state/sideBar.ts): maximize leaves `sb`
// untouched so the page sidebar returns on restore — this flag names a
// different surface with its own lifetime. Unlike `gso` it plays NO part
// in the search-suppression gate: the sidebar EDITS the query, it does not
// consume results, so opening it enables nothing (useSearchSuppressed
// below stays gso-only). Its ephemeral OPEN half lives in
// lib/state/searchOverlayReveal.ts beside the bottom dock's.
const useSidebarOverlayOpen = () =>
  useQueryState(
    "gsb",
    parseAsBoolean.withDefault(false).withOptions({
      history: "push",
      clearOnDefault: true,
    })
  )

// BOARD FLAG DEFAULTS ARE WIRE FORMAT: the withDefault values on the
// pinboard flags below define what an ABSENT parameter means in every
// board URL ever shared, forever — never change them, or existing links
// silently change behavior. Opinionated defaults for NEW boards live in
// lib/pinboardDefaults.ts (dev + user layers) and are stamped into the URL
// as explicit parameters when the first pin creates a board (see
// usePinBoard). New flags added later follow the same split: codec default
// = the legacy implicit behavior, creation default = the opinionated one.
const useGalleryHidePinBoard = () =>
  useQueryState(
    "ghp",
    parseAsBoolean.withDefault(false).withOptions({
      clearOnDefault: false,
      history: "push",
    })
  )
export type ViewMode = "pages" | "scroll"

// THE VIEW MODE DEFAULT IS WIRE FORMAT, exactly like the board flags above:
// "pages" is what an ABSENT `vm` means in every search URL ever shared, and
// it is frozen forever. Making scroll the product default is a CREATION
// default flip — a stamped explicit parameter at session creation
// (lib/searchDefaults.ts, the lib/pinboardDefaults.ts pattern) — never a flip
// of the withDefault below, which would silently re-render every existing
// link and bookmark in the other mode. The accepted cost is that scroll-mode
// URLs always carry `vm=scroll` explicitly.
//
// history "push": switching modes is navigation, so Back undoes it. The
// position params that ride along with the switch write "replace" and nuqs
// escalates the batch to a single pushed entry — see useCommitViewMode.
const useViewMode = () =>
  useQueryState(
    "vm",
    parseAsStringEnum<ViewMode>(["pages", "scroll"])
      .withDefault("pages")
      .withOptions({
        clearOnDefault: true,
        history: "push",
      })
  )

// The grid results view's tab choice (gallery closed): true shows the
// pinboard in place of the results. Deliberately separate from ghp, with
// the opposite default: the gallery shows the board as soon as pins exist,
// but pinning from the grid must not yank the results away — here the
// Pinboard tab is an explicit destination. The flag is scoped to the
// board's lifetime: unpinning the last item destroys the board and clears
// it (see usePinBoard), so a future first pin can never context-switch
// the grid into a board the user didn't ask to see.
const useGridPinboardTab = () =>
  useQueryState(
    "gpb",
    parseAsBoolean.withDefault(false).withOptions({
      clearOnDefault: true,
      history: "push",
    })
  )
// The grid results view's Library tab: true shows the pinboard-library
// search (boards whose images match the current search) in place of the
// results. Unlike gpb this flag is board-lifecycle-INDEPENDENT — the
// library exists whether or not a board is open, so nothing clears it when
// the current board is destroyed — and it is never read by
// isPinboardMaximized: the Library tab is a search consumer, not a board.
// Precedence lives in the tab host (GridPanel): pins > library > results.
const useGridLibraryTab = () =>
  useQueryState(
    "gpl",
    parseAsBoolean.withDefault(false).withOptions({
      clearOnDefault: true,
      history: "push",
    })
  )
const useGalleryPinGrid = () =>
  useQueryState(
    "pg",
    parseAsBoolean.withDefault(false).withOptions({
      clearOnDefault: true,
      history: "push",
    })
  )
const useGalleryPinAutoLayout = () =>
  useQueryState(
    "pba",
    parseAsBoolean.withDefault(false).withOptions({
      clearOnDefault: true,
      history: "push",
    })
  )
// The standing auto-crop setting for the board-layout verb family (fills,
// reroll, refit, reflow, rows, justify, grow — manual or auto-triggered):
// on, those verbs fit every item they lay out to its cell; off, they drop
// the auto crops their writes make stale. Stored independently of
// auto-layout so it survives pba being toggled off and back on.
const useGalleryPinAutoCrop = () =>
  useQueryState(
    "pbc",
    parseAsBoolean.withDefault(false).withOptions({
      clearOnDefault: true,
      history: "push",
    })
  )
// The same standing setting for the multi-select verbs (arrange, swap),
// toggled from the selection toolbar. Default ON; in the URL like every
// board flag so links and back/forward reproduce behavior.
const useGalleryPinSelectionCrop = () =>
  useQueryState(
    "psc",
    parseAsBoolean.withDefault(true).withOptions({
      clearOnDefault: true,
      history: "push",
    })
  )
// Proportional grid ("Scale With Window"): the board's cell aspect is
// frozen at the reference width stored in the layout token (see
// pinboardGrid.ts) and the whole grid — row height, margin, padding —
// scales by currentWidth/refWidth instead of letterboxing. Board-scoped
// like the other flags; the reference width itself is version-scoped
// because it is a property of the arrangement, not of the board.
const useGalleryPinProportional = () =>
  useQueryState(
    "pbp",
    parseAsBoolean.withDefault(false).withOptions({
      clearOnDefault: true,
      history: "push",
    })
  )
// All resize handles ("All Resize Handles"): with it on, a normal pin
// carries all eight react-resizable handles instead of the default
// bottom-right corner alone. A pure view preference like the grid overlay
// — nothing about it touches the layout token — so it is a plain board
// flag with no empty-board gate.
const useGalleryPinResizeHandles = () =>
  useQueryState(
    "prh",
    parseAsBoolean.withDefault(false).withOptions({
      clearOnDefault: true,
      history: "push",
    })
  )
const useGalleryPinBoardLayout = () =>
  useQueryState(
    "pinboard",
    parseAsArrayOf(parseAsString).withDefault([]).withOptions({
      clearOnDefault: true,
      history: "push",
    })
  )
// The saved-pinboard id the current board was loaded from (or last saved
// to). Save updates this board; absent means Save creates a new one. Lives
// in the URL like all board state, so refresh and back/forward keep the
// document identity together with the layout it belongs to.
const useGalleryPinBoardId = () =>
  useQueryState(
    "pbid",
    parseAsInteger.withOptions({
      history: "push",
    })
  )

// A deferred board-load reference: "head" or a version id, always paired
// with pbid. Links (library cards, history rows) carry it so boards open in
// new tabs without the layout being known up front; usePinboardURLLoader
// resolves it to a layout and clears it (see lib/pinboardLinks.ts).
const useGalleryPinBoardLoad = () =>
  useQueryState(
    "pbl",
    parseAsString.withOptions({
      history: "replace",
    })
  )

// The gallery's playback trim for the video being watched, keyed by the
// item's sha256 prefix. THE VALUE'S GRAMMAR IS WIRE FORMAT — it is frozen
// like the pinboard h field's (see lib/galleryTrim.ts, which owns the
// codec); this file only decides the slot's URL behavior. No default and
// no clearOnDefault: the empty trim IS the absent param, which is what the
// setter writes to clear it.
//
// History is "push" because the setter is only ever called on commit
// gestures — marker release, set/clear button presses — never per
// pointermove, so back is an undo of one trim edit (the pinboard's
// convention).
const useGalleryTrim = () => {
  const [value, setValue] = useQueryState(
    "vt",
    parseAsString.withOptions({
      history: "push",
    })
  )
  const slot = parseGalleryTrim(value)
  return {
    sha10: slot?.sha10 ?? null,
    trim: slot?.trim ?? null,
    setTrim: (sha256: string, trim: TrimRange | null) =>
      setValue(encodeGalleryTrim(sha256, trim)),
  }
}

// Whether the board is currently maximized over the whole view — see
// lib/state/pinboardView.ts for what that means and why it gates searching.
const usePinboardMaximized = () =>
  isPinboardMaximized({
    fs: useGalleryFullscreen()[0],
    hidePinBoard: useGalleryHidePinBoard()[0],
    gridTab: useGridPinboardTab()[0],
    pinboard: useGalleryPinBoardLayout()[0],
    pbl: useGalleryPinBoardLoad()[0],
  })

// Whether the search queries should be withheld: the board is maximized AND
// nothing on screen consumes the results — the bottom dock is neither
// pinned (`gso`), nor holding the item viewer open (`gsv`), nor OPEN (the
// ephemeral click-to-open state in the client-only store).
// That last read is the one client-only addition over the pure predicate:
// an open dock is a consumer and enables the query exactly like a pinned
// one, while the SSR twin (isSearchSuppressedFromParams) consults `gso`
// alone — a cold load is either pinned-open or closed
// (docs/maximized-pinboard-search-overlay-design.md §2). Deliberately reads
// the BOTTOM dock's flag only: the sidebar dock has its own open flag in
// the same store and does NOT take part in this gate (§9). The search gates
// read this, not usePinboardMaximized — see lib/state/pinboardView.ts.
const useSearchSuppressed = () => {
  // Subscribed unconditionally, before the predicate: hooks may not hide
  // behind a short-circuit.
  const revealed = useSearchOverlayReveal((s) => s.revealed)
  return (
    isSearchSuppressed({
      fs: useGalleryFullscreen()[0],
      hidePinBoard: useGalleryHidePinBoard()[0],
      gridTab: useGridPinboardTab()[0],
      pinboard: useGalleryPinBoardLayout()[0],
      pbl: useGalleryPinBoardLoad()[0],
      searchOverlay: useSearchOverlayOpen()[0],
      viewer: useSearchViewerOpen()[0],
    }) && !revealed
  )
}

const gallerySearchParams = () => ({
  gi: parseAsInteger,
  gt: parseAsBoolean,
})

const getGalleryOptionsSerializer = () => {
  return createSerializer(gallerySearchParams())
}

export {
  useGalleryIndex,
  useGalleryNavigate,
  useGalleryThumbnail,
  getGalleryOptionsSerializer,
  useGalleryPinBoardLayout,
  useGalleryPinBoardId,
  useGalleryPinBoardLoad,
  useGalleryFullscreen,
  useGalleryHidePinBoard,
  useGridPinboardTab,
  useGridLibraryTab,
  useGalleryPinGrid,
  useGalleryPinAutoLayout,
  useGalleryPinAutoCrop,
  useGalleryPinSelectionCrop,
  useGalleryPinProportional,
  useGalleryPinResizeHandles,
  useGalleryTrim,
  usePinboardMaximized,
  useSearchOverlayOpen,
  useSearchViewerOpen,
  useSidebarOverlayOpen,
  useSearchSuppressed,
  useViewMode,
}
