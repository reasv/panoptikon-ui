// Copies the @sqlite.org/sqlite-wasm browser runtime into public/ so
// lib/sqlite.ts can import it natively at runtime (import with
// webpackIgnore). Bundlers can't statically resolve the package's dynamic
// `new Worker(new URL(...))` calls — Turbopack fails the build on them —
// and none of that code needs bundling: it only ever runs in the browser.
// Runs automatically via the predev/prebuild hooks so the copy always
// matches the installed package version.
import { copyFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, "node_modules", "@sqlite.org", "sqlite-wasm", "dist")
const dest = join(root, "public", "sqlite-wasm")

const files = [
  "index.mjs",
  "sqlite3-worker1.mjs",
  "sqlite3-opfs-async-proxy.js",
  "sqlite3.wasm",
]

mkdirSync(dest, { recursive: true })
for (const file of files) {
  copyFileSync(join(src, file), join(dest, file))
}
console.log(`Synced ${files.length} sqlite-wasm files to public/sqlite-wasm`)
