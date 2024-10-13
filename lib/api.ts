import createFetchClient from "openapi-fetch"
import createClient from "openapi-react-query"
import type { paths } from "@/lib/panoptikon" // generated by openapi-typescript

export const fetchClient = createFetchClient<paths>({
  baseUrl: "/",
})
export const serverFetchClient = createFetchClient<paths>({
  baseUrl: process.env.API_URL || "http://127.0.0.1:6342",
  fetch: fetch,
  cache: "no-cache",
})
export const $api = createClient(fetchClient)
