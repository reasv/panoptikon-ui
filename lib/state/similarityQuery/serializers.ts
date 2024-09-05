import * as def from "nuqs/server"
import {
  similarityQueryOptionsKeymap,
  similarityQuerySourceKeymap,
} from "./similarityQueryKeyMaps"
import { createScopedSerializer } from "../nuqsScopedWrappers/scopedSerializer"

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
