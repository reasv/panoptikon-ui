import createFetchClient from "openapi-fetch"
import createClient from "openapi-react-query"
import type { paths } from "@/lib/panoptikon" // generated by openapi-typescript

export const fetchClient = createFetchClient<paths>({
  baseUrl: "/",
})
export const serverFetchClient = createFetchClient<paths>({
  baseUrl: process.env.API_URL,
})
export const $api = createClient(fetchClient)
