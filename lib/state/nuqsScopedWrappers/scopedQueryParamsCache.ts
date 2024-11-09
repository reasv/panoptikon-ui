import { createSearchParamsCache, ParserBuilder } from "nuqs/server"
import { getScopedUrlKeys } from "./getScopedQueryStates"
interface CreateScopedSearchParamsCacheOptions {
  separator?: string
}

/**
 * Create a search params cache that namespaces the keys with a given prefix.
 *
 * @param namespace - The namespace to prepend to keys
 * @param parsers - An object mapping keys to parser functions
 * @param options - Optional separator to use between the namespace and key
 */
export function createScopedSearchParamsCache<
  Parsers extends Record<string, ParserBuilder<any>>
>(
  namespace: string,
  parsers: Parsers,
  { separator = "." }: Partial<CreateScopedSearchParamsCacheOptions> = {}
) {
  return createSearchParamsCache(parsers, {
    urlKeys: getScopedUrlKeys(parsers, namespace, separator),
  })
}
