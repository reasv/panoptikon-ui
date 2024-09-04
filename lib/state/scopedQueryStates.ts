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
  const { scopedKeyMap, scopedToUnscopedMap } = Object.keys(keyMap).reduce(
    (acc, key: keyof KeyMap) => {
      const scopedKey = `${namespace}${separator}${String(
        key
      )}` as keyof ScopedKeyMap<KeyMap, typeof namespace, typeof separator>

      acc.scopedToUnscopedMap[scopedKey] = key
      ;(acc.scopedKeyMap as any)[scopedKey] = keyMap[key]

      return acc
    },
    {
      // Maintain a scoped keyMap
      scopedKeyMap: {} as ScopedKeyMap<
        KeyMap,
        typeof namespace,
        typeof separator
      >,
      // Maintain a map between scoped and unscoped keys
      scopedToUnscopedMap: {} as Record<
        keyof ScopedKeyMap<KeyMap, typeof namespace, typeof separator>,
        keyof KeyMap
      >,
    }
  )

  // Call useQueryStates with the scoped keyMap
  const [scopedState, setScopedState] = useQueryStates(scopedKeyMap, {
    history,
    scroll,
    shallow,
    throttleMs,
    clearOnDefault,
    startTransition,
  })

  const convertScopedToUnscoped = (
    scopedValues: Partial<
      Nullable<Values<ScopedKeyMap<KeyMap, typeof namespace, typeof separator>>>
    >
  ) => {
    return Object.keys(scopedValues).reduce(
      (acc, scopedKey: keyof typeof scopedState) => {
        const unscopedKey = scopedToUnscopedMap[scopedKey]

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
    unscopedValues: Partial<Nullable<Values<KeyMap>>>
  ) => {
    return (Object.keys(unscopedValues) as (keyof KeyMap)[]).reduce(
      (acc, key) => {
        const scopedKey = `${namespace}${separator}${String(
          key
        )}` as keyof ScopedKeyMap<KeyMap, typeof namespace, typeof separator>
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
    // Otherwise, convert unscoped keys to scoped keys
    return setScopedState(convertUnscopedToScoped(values), options)
  }

  return [unscopedState, setUnscopedState]
}
