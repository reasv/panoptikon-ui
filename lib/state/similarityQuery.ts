import { pm, factoryParameters, serializers } from "geschichte"

const parameterConfig = {
  item: pm("item", serializers.string),
}

const defaultValue = {
  item: null,
}

const { useQuery, createQueryString, parseQueryString } = factoryParameters(
  parameterConfig,
  defaultValue,
  "similarity"
)

export const useSimilarityQuery = useQuery
export const createSimilarityQueryString = createQueryString
export const parseSimilarityQueryString = parseQueryString
