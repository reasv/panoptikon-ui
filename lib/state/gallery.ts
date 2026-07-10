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
// Auto-crop rides on auto-layout: the flag is stored independently (so it
// survives auto-layout being toggled off and back on) but only takes effect
// while auto-layout is on — every consumer must check both flags
const useGalleryPinAutoCrop = () =>
  useQueryState(
    "pbc",
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
  useGalleryFullscreen,
  useGalleryHidePinBoard,
  useGalleryPinGrid,
  useGalleryPinAutoLayout,
  useGalleryPinAutoCrop,
}
