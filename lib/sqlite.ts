"use client"
import type { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm"

function stripErrorMessage(errorMessage: string): string {
  const fts5Index = errorMessage.indexOf("fts5:")
  // If 'fts5:' is found, return the substring starting from 'fts5:'
  if (fts5Index !== -1) {
    return errorMessage.substring(fts5Index)
  }
  return errorMessage
}
const start = (sqlite3: Sqlite3Static): Database => {
  console.log("Running SQLite3 version", sqlite3.version.libVersion)
  const db = new sqlite3.oo1.DB(":memory:", "c")
  db.exec("CREATE VIRTUAL TABLE documents USING fts5(content)")
  db.exec(`INSERT INTO documents(content) VALUES
        ('SQLite is a C-language library that implements a small, fast, self-contained, high-reliability, full-featured, SQL database engine.')
    `)
  return db
}

export const initializeSQLite = async () => {
  if (typeof window === "undefined") {
    console.log("SQLite initialization skipped on server-side")
    return
  }
  console.time("SQlite3Init")
  try {
    console.log("Loading and initializing SQLite3 module...")
    // Imported natively by the browser from public/ (see
    // scripts/sync-sqlite-wasm.mjs) — bundlers can't handle the package's
    // dynamic worker URLs, and this module only ever runs client-side.
    const sqlite3ModuleUrl = "/sqlite-wasm/index.mjs"
    const sqlite3Module = await import(
      /* webpackIgnore: true */ sqlite3ModuleUrl
    )
    const sqlite3: Sqlite3Static = await sqlite3Module.default()
    return start(sqlite3)
  } catch (err) {
    console.error(
      "Initialization error:",
      (err as Error).name,
      (err as Error).message
    )
  }
  console.timeEnd("SQlite3Init")
}

export const testFTS5Query = (db: Database, query: string) => {
  try {
    db.exec(
      `SELECT rowid, content FROM documents WHERE content MATCH '${query}';`
    )
    return { success: true, errorMsg: "" }
  } catch (e) {
    const msg = stripErrorMessage((e as Error).message)
    console.log(msg)
    return { success: false, errorMsg: msg }
  }
}
