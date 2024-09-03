import {
  createSerializer,
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
        clearOnDefault: true,
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
      history: "push",
    })
  )

const gallerySearchParams = (name: Gallery) => ({
  [`${name}.gi`]: parseAsInteger,
  [`${name}.gt`]: parseAsBoolean,
})
interface ConcreteGalleryOptions {
  index?: number
  thumbnail?: boolean
}

const mapConcreteGalleryOptions = (
  name: Gallery,
  options: ConcreteGalleryOptions
) => ({
  [`${name}.gi`]: options.index,
  [`${name}.gt`]: options.thumbnail,
})

const getGalleryOptionsSerializer = (name: Gallery) => {
  const serialize = createSerializer(gallerySearchParams(name))
  return (base: URLSearchParams, options: ConcreteGalleryOptions) =>
    serialize(base, mapConcreteGalleryOptions(name, options))
}

export {
  useGalleryIndex,
  useGalleryThumbnail,
  useGalleryName,
  Gallery,
  getGalleryOptionsSerializer,
}
