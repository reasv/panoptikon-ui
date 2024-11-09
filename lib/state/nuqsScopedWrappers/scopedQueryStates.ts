import {
  useQueryStates,
  UseQueryStatesKeysMap,
  UseQueryStatesOptions,
  UseQueryStatesReturn,
} from "nuqs"
import { getScopedUrlKeys } from "./getScopedQueryStates"

interface UseNamespacesQueryStateOptions<KeyMap extends UseQueryStatesKeysMap>
  extends UseQueryStatesOptions<KeyMap> {
  separator?: string
}
/**
 * Synchronise multiple query string arguments to React state in Next.js, scoped under a namespace
 *
 * @param namespace - A string to namespace the keys under when serializing them as query parameters
 *
 * @param keys - An object describing the keys to synchronise and how to
 *               serialise and parse them.
 *               Use `queryTypes.(string|integer|float)` for quick shorthands.
 *
 * @param options - Optional history mode, shallow routing and scroll restoration options. Also accepts a separator string to use between the namespace and key.
 */
export function useScopedQueryStates<KeyMap extends UseQueryStatesKeysMap>(
  namespace: string,
  keyMap: KeyMap,
  options: Partial<UseNamespacesQueryStateOptions<KeyMap>> = {}
): UseQueryStatesReturn<KeyMap> {
  return useQueryStates(keyMap, {
    ...options,
    urlKeys: getScopedUrlKeys(keyMap, namespace, options.separator || "."),
  })
}
