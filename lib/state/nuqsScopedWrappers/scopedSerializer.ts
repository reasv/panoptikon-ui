import { createSerializer, Parser } from "nuqs"
import { ParserBuilder } from "nuqs/server"

type KeyMapValue<Type> = Parser<Type> & {
  defaultValue?: Type
}
type Base = string | URLSearchParams | URL

type UseQueryStatesKeysMap<Map = any> = {
  [Key in keyof Map]: KeyMapValue<Map[Key]>
}

type Values<T extends UseQueryStatesKeysMap> = {
  [K in keyof T]: T[K]["defaultValue"] extends NonNullable<
    ReturnType<T[K]["parse"]>
  >
    ? NonNullable<ReturnType<T[K]["parse"]>>
    : ReturnType<T[K]["parse"]> | null
}

export function createScopedSerializer<
  Parsers extends Record<string, ParserBuilder<any>>
>(
  namespace: string,
  parsers: Parsers,
  separator: string = "."
): {
  (values: Values<Parsers>): string
  (base: Base, values: Values<Parsers>): string
} {
  // A function to scope the keys in the values map
  const scopeValues = (values: Values<Parsers>) => {
    const scopedValues: Partial<Values<Parsers>> = {}
    for (const key in values) {
      if (values.hasOwnProperty(key)) {
        const scopedKey =
          `${namespace}${separator}${key}` as keyof Values<Parsers>
        scopedValues[scopedKey] = values[key] as Values<Parsers>[keyof Parsers]
      }
    }

    // Filter out null values (this resolves the type issue)
    Object.keys(scopedValues).forEach((key) => {
      if (scopedValues[key as keyof Values<Parsers>] === null) {
        delete scopedValues[key as keyof Values<Parsers>]
      }
    })

    return scopedValues as Values<Parsers>
  }

  const scopeParsers = (parsers: Parsers) => {
    const scopedParsers: Partial<Parsers> = {} as Parsers
    for (const key in parsers) {
      if (parsers.hasOwnProperty(key)) {
        const scopedKey = `${namespace}${separator}${key}` as keyof Parsers
        scopedParsers[scopedKey] = parsers[key]
      }
    }
    return scopedParsers as Parsers
  }

  // Get the original serializer
  const serialize = createSerializer(scopeParsers(parsers))

  // Wrapper function that handles scoping of keys before calling the original serializer
  return (...args: [Base | Values<Parsers>, Values<Parsers>?]): string => {
    // Check if the first argument is the base or values
    if (args.length === 1) {
      const [values] = args
      // Serialize with scoped keys, but remove null values
      const scopedValues = scopeValues(values as Values<Parsers>) as Parameters<
        typeof serialize
      >[1]
      return serialize(scopedValues)
    } else if (args.length === 2) {
      const [base, values] = args
      const scopedValues = scopeValues(values as Values<Parsers>) as Parameters<
        typeof serialize
      >[1]
      // Serialize with scoped keys and base, but remove null values
      return serialize(base as Base, scopedValues)
    }
    throw new Error("Invalid arguments passed to createScopedSerializer")
  }
}
