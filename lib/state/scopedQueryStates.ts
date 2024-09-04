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
  // Create a namespaced keyMap by prepending the namespace to each key
  const scopedKeyMap = Object.keys(keyMap).reduce((acc, key) => {
    const scopedKey = `${namespace}${separator}${key}` as keyof ScopedKeyMap<
      KeyMap,
      typeof namespace,
      typeof separator
    >
    ;(acc as any)[scopedKey] = keyMap[key as keyof KeyMap]
    return acc
  }, {} as ScopedKeyMap<KeyMap, typeof namespace, typeof separator>)

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
  const unscopedState = Object.keys(scopedState).reduce(
    (acc, scopedKey) => {
      const unscopedKey = scopedKey.replace(
        `${namespace}${separator}`,
        ""
      ) as keyof KeyMap

      // Safely assign the state values back
      const parser = keyMap[unscopedKey].parse
      const defaultValue = keyMap[unscopedKey].defaultValue

      const parsedValue = scopedState[
        scopedKey as keyof typeof scopedState
      ] as ReturnType<typeof parser>

      // Respect the structure of Values<KeyMap>
      acc[unscopedKey] =
        defaultValue !== undefined && defaultValue !== null
          ? parsedValue ?? defaultValue // Use non-null defaultValue if available
          : parsedValue ?? null // Otherwise, allow null

      return acc
    },
    {} as Values<KeyMap> // Now correctly typed
  )

  // Set function with scoped keys
  const setUnscopedState: SetValues<KeyMap> = (values, options) => {
    const scopedValues = Object.keys(values).reduce((acc, key) => {
      const scopedKey = `${namespace}${separator}${key}` as keyof ScopedKeyMap<
        KeyMap,
        typeof namespace,
        typeof separator
      >
      ;(acc as any)[scopedKey] = values[key as keyof typeof values]
      return acc
    }, {} as Partial<Nullable<ScopedKeyMap<KeyMap, typeof namespace, typeof separator>>>)

    return setScopedState(scopedValues as any, options)
  }

  return [unscopedState, setUnscopedState]
}
