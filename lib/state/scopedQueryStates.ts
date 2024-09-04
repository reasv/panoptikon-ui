import {
  Options,
  Parser,
  useQueryStates,
  UseQueryStatesKeysMap,
  UseQueryStateReturn,
  UseQueryStatesOptions,
} from "nuqs"

type Nullable<T> = {
  [K in keyof T]: T[K] | null
}

type UpdaterFn<T> = (old: T) => Partial<Nullable<T>>

type SetFn<T> = (
  values: Partial<Nullable<T>> | UpdaterFn<T>,
  options?: Options
) => Promise<URLSearchParams>

type KeyMapValue<Type> = Parser<Type> & {
  defaultValue?: Type
}

// Utility type to prepend namespace to keys of any object
type ScopedKeyMap<T, N extends string> = {
  [K in keyof T as `${N}_${string & K}`]: T[K]
}

export function useScopedQueryStates<KeyMap extends UseQueryStatesKeysMap>(
  namespace: string,
  keyMap: KeyMap,
  {
    history,
    scroll,
    shallow,
    throttleMs,
    clearOnDefault,
    startTransition,
  }: Partial<UseQueryStatesOptions> = {}
): [
  {
    [K in keyof KeyMap]: KeyMap[K] extends KeyMapValue<infer R> ? R : never
  },
  SetFn<{
    [K in keyof KeyMap]: KeyMap[K] extends KeyMapValue<infer R> ? R : never
  }>
] {
  // Create a namespaced keyMap by prepending the namespace to each key
  const scopedKeyMap = Object.keys(keyMap).reduce((acc, key) => {
    // Define the scoped key with a namespace
    const scopedKey = `${namespace}_${key}` as keyof ScopedKeyMap<
      KeyMap,
      typeof namespace
    >

    // Assign to the accumulator with type casting to ensure compatibility
    ;(acc as any)[scopedKey] = keyMap[key as keyof KeyMap]

    return acc
  }, {} as ScopedKeyMap<KeyMap, typeof namespace>)

  // Call useQueryStates with the scoped keyMap
  const [scopedState, setScopedState] = useQueryStates(scopedKeyMap, options)

  // Convert the scoped state back to the original key structure
  const unscopedState = Object.keys(scopedState).reduce(
    (acc, scopedKey) => {
      // Remove the namespace prefix from the key to get the original key
      const unscopedKey = scopedKey.replace(`${namespace}_`, "") as keyof KeyMap

      // Safely assign the state values back
      acc[unscopedKey] = scopedState[
        scopedKey as keyof typeof scopedState
      ] as any

      return acc
    },
    {} as {
      [K in keyof KeyMap]: KeyMap[K] extends KeyMapValue<infer R> ? R : never
    }
  )

  // Set function with scoped keys
  const setUnscopedState: SetFn<{
    [K in keyof KeyMap]: KeyMap[K] extends KeyMapValue<infer R> ? R : never
  }> = (values, options) => {
    const scopedValues = Object.keys(values).reduce((acc, key) => {
      const scopedKey = `${namespace}_${key}` as keyof ScopedKeyMap<
        KeyMap,
        typeof namespace
      >

      // Align the scoped values to match the expected type by casting as any
      ;(acc as any)[scopedKey] = values[key as keyof typeof values]
      return acc
    }, {} as Partial<Nullable<ScopedKeyMap<KeyMap, typeof namespace>>>) // Updated the type here

    // Ensure the correct type is passed into setScopedState
    return setScopedState(scopedValues as any, options)
  }

  return [unscopedState, setUnscopedState]
}
