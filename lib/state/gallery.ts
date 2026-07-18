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
  useGalleryPinGrid,
  useGalleryPinAutoLayout,
  useGalleryPinAutoCrop,
  useGalleryPinSelectionCrop,
}
