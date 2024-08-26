// hooks/useSQLite.ts
import { useEffect, useState, useCallback } from "react"
import { initializeSQLite, testFTS5Query } from "@/lib/sqlite"
import { Database } from "@sqlite.org/sqlite-wasm"

export const useSQLite = (enabled: boolean) => {
  const [db, setDb] = useState<Database | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialize the database if enabled is true
  useEffect(() => {
    if (enabled) {
      if (!db && !loading) {
        setLoading(true)
        initializeSQLite()
          .then((initializedDb: Database | undefined) => {
            if (initializedDb) {
              setDb(initializedDb)
            }
          })
          .catch((err) => setError(err.message))
          .finally(() => setLoading(false))
      }
    } else {
      // Reset the error if enabled is set to false
      setError(null)
    }
  }, [enabled, db, loading])

  // Test FTS5 query function
  const executeQuery = useCallback(
    (query: string) => {
      if (!db) {
        // If the database is not initialized, initialize it first
        if (!loading) {
          setLoading(true)
          initializeSQLite()
            .then((initializedDb: Database | undefined) => {
              if (initializedDb) {
                setDb(initializedDb)
                const { success, errorMsg } = testFTS5Query(
                  initializedDb,
                  query
                )
                setError(errorMsg)
                return success
              }
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false))
        }
        return false
      } else {
        const { success, errorMsg } = testFTS5Query(db, query)
        setError(errorMsg)
        return success
      }
    },
    [db, loading]
  )

  return {
    executeQuery,
    loading,
    error,
  }
}
