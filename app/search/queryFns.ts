"use server"
import { serverFetchClient } from "@/lib/api"
import { components } from "@/lib/panoptikon"

interface queryParams {
  index_db: string | null
  user_data_db: string | null
}
export interface SearchQueryArgs {
  params: {
    query: queryParams
  }
  body: components["schemas"]["PQLQuery"]
}

export interface SimilarityQueryArgs {
  params: {
    query: queryParams
    path: {
      sha256: string
    }
  }
  body: components["schemas"]["SimilarItemsRequest"]
}

export async function fetchSearch(args: SearchQueryArgs) {
  try {
    const { data, error } = await serverFetchClient.POST("/api/search/pql", {
      params: args.params,
      body: args.body,
    })
    if (!data || error) {
      console.error(error)
      console.log("Error fetching search results")
      throw error
    }
    console.log("Fetched search results successfully")
    return data
  } catch (error) {
    console.error(error)
    console.log("Error fetching search results")
    throw error
  }
}

export async function fetchSimilarity(args: SimilarityQueryArgs) {
  try {
    const { data, error } = await serverFetchClient.POST(
      "/api/search/similar/{sha256}",
      {
        params: args.params,
        body: args.body,
      }
    )
    if (!data || error) {
      console.error(error)
      console.log("Error fetching similarity results")
      throw error
    }
    console.log("Fetched similarity results successfully")
    return data
  } catch (error) {
    console.error(error)
    console.log("Error similarity search results")
    throw error
  }
}

export async function fetchStats(args: {
  index_db?: string | null
  user_data_db?: string | null
}) {
  try {
    const { data, error } = await serverFetchClient.GET("/api/search/stats", {
      params: {
        query: {
          index_db: args.index_db,
          user_data_db: args.user_data_db,
        },
      },
    })
    if (!data || error) {
      console.error(error)
      throw error
    }
    return data
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function fetchNs(args: {
  index_db?: string | null
  user_data_db?: string | null
}) {
  try {
    const { data, error } = await serverFetchClient.GET("/api/bookmarks/ns", {
      params: {
        query: {
          index_db: args.index_db,
          user_data_db: args.user_data_db,
        },
      },
    })
    if (!data || error) {
      console.error(error)
      throw error
    }
    return data
  } catch (error) {
    console.error(error)
    throw error
  }
}

export async function fetchDB() {
  try {
    const { data, error } = await serverFetchClient.GET("/api/db")
    if (!data || error) {
      console.error(error)
      throw error
    }
    return data
  } catch (error) {
    console.error(error)
    throw error
  }
}
