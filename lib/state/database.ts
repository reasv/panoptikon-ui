import { createSerializer, useQueryStates } from "nuqs"

import { parseAsString } from "nuqs"
import { useResetPage } from "./searchQuery/clientHooks"

export const useSelectedDBs = () => {
  const [state, set] = useQueryStates(
    {
      index_db: parseAsString,
      user_data_db: parseAsString,
    },
    {
      history: "push",
      clearOnDefault: true,
    }
  )
  return [state, useResetPage(set)] as const
}
export const selectedDBsSerializer = createSerializer({
  index_db: parseAsString,
  user_data_db: parseAsString,
})
