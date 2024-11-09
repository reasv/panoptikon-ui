import { UseQueryStatesKeysMap } from "nuqs"

export function getScopedUrlKeys<KeyMap extends UseQueryStatesKeysMap>(
  keyMap: KeyMap,
  namespace: string,
  separator = "."
): Record<keyof KeyMap, string> {
  return Object.keys(keyMap).reduce((acc, key: keyof KeyMap) => {
    acc[key] = `${namespace}${separator}${String(key)}`
    return acc
  }, {} as Record<keyof KeyMap, string>)
}
