import {
  createSerializer,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  useQueryState,
} from "nuqs"

const useGalleryIndex = () =>
  useQueryState(
    "gi",
    parseAsInteger.withOptions({
      history: "push",
    })
  )

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

const useGalleryHidePinBoard = () =>
  useQueryState(
    "ghp",
    parseAsBoolean.withDefault(false).withOptions({
      clearOnDefault: false,
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

const gallerySearchParams = () => ({
  gi: parseAsInteger,
  gt: parseAsBoolean,
})

const getGalleryOptionsSerializer = () => {
  return createSerializer(gallerySearchParams())
}

export {
  useGalleryIndex,
  useGalleryThumbnail,
  getGalleryOptionsSerializer,
  useGalleryPinBoardLayout,
  useGalleryPinBoardId,
  useGalleryPinBoardLoad,
  useGalleryFullscreen,
  useGalleryHidePinBoard,
  useGridPinboardTab,
  useGalleryPinGrid,
  useGalleryPinAutoLayout,
  useGalleryPinAutoCrop,
  useGalleryPinSelectionCrop,
}
