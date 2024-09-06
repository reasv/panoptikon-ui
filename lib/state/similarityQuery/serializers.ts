import * as def from "nuqs/server"
import {
  similarityQueryOptionsKeymap,
  similarityQuerySourceKeymap,
} from "./similarityQueryKeyMaps"
import { createScopedSerializer } from "../nuqsScopedWrappers/scopedSerializer"
import { ReadonlyURLSearchParams } from "next/navigation"

export const similaritySerializers = {
  similarityOptions: createScopedSerializer(
    "is",
    similarityQueryOptionsKeymap(def)
  ),
  similaritySource: createScopedSerializer(
    "is.src",
    similarityQuerySourceKeymap(def)
  ),
}

export const getSimilarityPageURL = (
  base: ReadonlyURLSearchParams | URLSearchParams,
  newPage: number
) => {
  const queryParams = new URLSearchParams(base)
  return similaritySerializers.similarityOptions(queryParams, { page: newPage })
}
