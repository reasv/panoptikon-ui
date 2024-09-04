import {
  createSearchParamsCache,
  ParserBuilder,
  SearchParams,
} from "nuqs/server"

// Utility type to prepend namespace to keys of any object
type ScopedKeyMap<T, N extends string, S extends string> = {
  [K in keyof T as `${N}${S}${string & K}`]: T[K]
}

// Updated utility type to extract the return type from a ParserBuilder
type ExtractParserType<T extends ParserBuilder<any>> = T extends ParserBuilder<
  infer U
>
  ? U extends { parse: (...args: any) => infer R }
    ? R extends (...args: any) => infer V
      ? V
      : never
    : never
  : never

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
  // Maps for converting between scoped and unscoped keys
  const scopedToUnscopedMap: Record<string, string> = {}
  const unscopedToScopedMap: Record<string, string> = {}

  // Create a scoped version of the parsers map
  const scopedParsers: ScopedKeyMap<
    Parsers,
    typeof namespace,
    typeof separator
  > = Object.keys(parsers).reduce((acc, key) => {
    const scopedKey = `${namespace}${separator}${key}` as keyof ScopedKeyMap<
      Parsers,
      typeof namespace,
      typeof separator
    >
    // Map between scoped and unscoped keys
    scopedToUnscopedMap[String(scopedKey)] = key
    unscopedToScopedMap[key] = String(scopedKey)

    // Safely assign the parser to the scoped key
    acc[scopedKey] = parsers[key] as (typeof scopedParsers)[typeof scopedKey]
    return acc
  }, {} as ScopedKeyMap<Parsers, typeof namespace, typeof separator>)

  // Create the cache using the original function with the scoped parsers
  const cache = createSearchParamsCache(scopedParsers)

  // Convert scoped keys back to unscoped keys in the result
  const convertScopedToUnscoped = <T extends Record<string, any>>(
    scopedValues: T
  ) => {
    return Object.keys(scopedValues).reduce((acc, scopedKey) => {
      const unscopedKey = scopedToUnscopedMap[scopedKey] as keyof Parsers
      acc[unscopedKey] = scopedValues[scopedKey]
      return acc
    }, {} as Record<keyof Parsers, ExtractParserType<Parsers[keyof Parsers]>>)
  }

  // Wrap the cache functions to convert the keys back to unscoped format
  return {
    parse: (searchParams: SearchParams) =>
      convertScopedToUnscoped(cache.parse(searchParams)),
    get: <Key extends keyof Parsers>(key: Key) =>
      cache.get(unscopedToScopedMap[String(key)] as keyof typeof scopedParsers),
    all: () => convertScopedToUnscoped(cache.all()),
  }
}
