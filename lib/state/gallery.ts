import {
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  useQueryState,
} from "nuqs"

enum Gallery {
  search = "sg",
  similarity = "isg",
}

const useGalleryName = () =>
  useQueryState(
    `g`,
    parseAsStringEnum<Gallery>(Object.values(Gallery))
      .withDefault(Gallery.search)
      .withOptions({
        history: "push",
      })
  )

const useGalleryIndex = (name: Gallery) =>
  useQueryState(
    `${name}.gi`,
    parseAsInteger.withOptions({
      history: "push",
    })
  )

const useGalleryThumbnail = (name: Gallery) =>
  useQueryState(
    `${name}.gt`,
    parseAsBoolean.withDefault(true).withOptions({
      clearOnDefault: true,
    })
  )

export { useGalleryIndex, useGalleryThumbnail, useGalleryName, Gallery }
