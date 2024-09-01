import { createSearchParamsCache, parseAsString } from "nuqs/server"

export const selectedDBsServer = createSearchParamsCache({
  index_db: parseAsString,
  user_data_db: parseAsString,
})
