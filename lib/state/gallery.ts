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
const useGalleryPinBoardLayout = () =>
  useQueryState(
    "pinboard",
    parseAsArrayOf(parseAsInteger).withDefault([]).withOptions({
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
}
