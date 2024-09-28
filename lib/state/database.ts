import { createSerializer, useQueryStates } from "nuqs"

import { parseAsString } from "nuqs"

export const useSelectedDBs = () =>
  useQueryStates(
    {
      index_db: parseAsString,
      user_data_db: parseAsString,
    },
    {
      history: "push",
      clearOnDefault: true,
    }
  )

export const selectedDBsSerializer = createSerializer({
  index_db: parseAsString,
  user_data_db: parseAsString,
})
