import { pm, factoryParameters, serializers } from "geschichte"

const parameterConfig = {
  item: pm("item", serializers.string),
  type: pm("type", serializers.string),
  page: pm("page", serializers.int),
  model: pm("model", serializers.string),
}

const defaultValue = {
  item: "",
  type: "clip",
  model: "",
  page: 1,
}

const { useQuery, createQueryString, parseQueryString } = factoryParameters(
  parameterConfig,
  defaultValue,
  "similarity"
)

export const useSimilarityQuery = useQuery
export const createSimilarityQueryString = createQueryString
export const parseSimilarityQueryString = parseQueryString
