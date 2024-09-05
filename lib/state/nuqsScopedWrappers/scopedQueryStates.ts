import {
  useQueryStates,
  UseQueryStatesKeysMap,
  UseQueryStatesOptions,
  Values,
  SetValues,
  UseQueryStatesReturn,
} from "nuqs"

type Nullable<T> = {
  [K in keyof T]: T[K] | null
}

// Utility type to prepend namespace to keys of any object
type ScopedKeyMap<T, N extends string, S extends string> = {
  [K in keyof T as `${N}${S}${string & K}`]: T[K]
}

interface UseNamespacesQueryStateOptions extends UseQueryStatesOptions {
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
  {
    separator = ".",
    history,
    scroll,
    shallow,
    throttleMs,
    clearOnDefault,
    startTransition,
  }: Partial<UseNamespacesQueryStateOptions> = {}
): UseQueryStatesReturn<KeyMap> {
  const { scopedKeyMap, scopedToUnscopedMap, unscopedToScopedMap } =
    Object.keys(keyMap).reduce(
      (acc, key: keyof typeof keyMap) => {
        const scopedKey = `${namespace}${separator}${String(
          key
        )}` as keyof ScopedKeyMap<
          typeof keyMap,
          typeof namespace,
          typeof separator
        >

        acc.scopedToUnscopedMap[scopedKey] = key
        acc.unscopedToScopedMap[key] = scopedKey
        acc.scopedKeyMap[scopedKey] = keyMap[
          key
        ] as unknown as (typeof scopedKeyMap)[typeof scopedKey]
        return acc
      },
      {
        // Maintain a scoped keyMap
        scopedKeyMap: {} as ScopedKeyMap<
          typeof keyMap,
          typeof namespace,
          typeof separator
        >,
        // Maintain a map between scoped and unscoped keys
        scopedToUnscopedMap: {} as Record<
          keyof ScopedKeyMap<KeyMap, typeof namespace, typeof separator>,
          keyof KeyMap
        >,
        unscopedToScopedMap: {} as Record<
          keyof KeyMap,
          keyof ScopedKeyMap<KeyMap, typeof namespace, typeof separator>
        >,
      }
    )

  const convertScopedToUnscoped = (
    scopedValues: Partial<Nullable<Values<typeof scopedKeyMap>>>
  ) => {
    return Object.keys(scopedValues).reduce(
      (acc, scopedKey: keyof typeof scopedState) => {
        const unscopedKey: keyof typeof keyMap = scopedToUnscopedMap[scopedKey]

        // Safely assign the state values back
        const defaultValue = keyMap[unscopedKey].defaultValue
        const parsedValue = scopedValues[scopedKey]

        // Respect the structure of Values<KeyMap>
        acc[unscopedKey] =
          defaultValue !== undefined && defaultValue !== null
            ? parsedValue ?? defaultValue // Use non-null defaultValue if available
            : parsedValue ?? null // Otherwise, allow null

        return acc
      },
      {} as Values<KeyMap> // Now correctly typed
    )
  }

  const convertUnscopedToScoped = (
    unscopedValues: Partial<Nullable<Values<typeof keyMap>>>
  ) => {
    return Object.keys(unscopedValues).reduce(
      (acc, key: keyof typeof keyMap) => {
        const scopedKey = unscopedToScopedMap[key]
        acc[scopedKey] = unscopedValues[key]
        return acc
      },
      {} as Partial<
        Nullable<
          Values<ScopedKeyMap<KeyMap, typeof namespace, typeof separator>>
        >
      >
    )
  }

  // Call useQueryStates with the scoped keyMap
  const [scopedState, setScopedState] = useQueryStates(scopedKeyMap, {
    history,
    scroll,
    shallow,
    throttleMs,
    clearOnDefault,
    startTransition,
  })

  // Convert the scoped state back to the original key structure
  const unscopedState = convertScopedToUnscoped(scopedState)

  // Set function with scoped keys
  const setUnscopedState: SetValues<KeyMap> = (values, options) => {
    // Check if values is an updater function
    if (typeof values === "function") {
      // If values is an updater function, we need to convert it to a scoped updater function
      const unscopedUpdater = values

      const scopedUpdater = (oldScopedState: typeof scopedState) =>
        convertUnscopedToScoped(
          unscopedUpdater(convertScopedToUnscoped(oldScopedState))
        )

      return setScopedState(scopedUpdater, options)
    }
    if (values === null) {
      // If values is null or undefined, clear the state
      return setScopedState(null)
    }
    // Otherwise, convert unscoped keys to scoped keys
    return setScopedState(convertUnscopedToScoped(values), options)
  }

  return [unscopedState, setUnscopedState]
}
