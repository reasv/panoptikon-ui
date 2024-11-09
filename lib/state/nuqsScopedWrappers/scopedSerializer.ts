import { createSerializer, Options } from "nuqs"
import { ParserBuilder } from "nuqs/server"
import { getScopedUrlKeys } from "./getScopedQueryStates"

interface ScopedSearializerOptions extends Pick<Options, "clearOnDefault"> {
  separator?: string
}

export function createScopedSerializer<
  Parsers extends Record<string, ParserBuilder<any>>
>(namespace: string, parsers: Parsers, options: ScopedSearializerOptions = {}) {
  return createSerializer(parsers, {
    urlKeys: getScopedUrlKeys(parsers, namespace, options.separator || "."),
    ...options,
  })
}
