// EVERY test script in this directory, in one command: `npm test`.
//
// Why it exists: the scripts are individually runnable and individually named
// in package.json, and that list is where a new one gets forgotten. This
// globs the directory instead, so a file that exists is a file that runs —
// there is nothing to remember to add.
//
// Each script is a SEPARATE PROCESS, which is not incidental: they register a
// TypeScript loader hook, they exit with a code, and several of them install
// globals (a fake `window`, a fake `matchMedia`) that would otherwise leak into
// whatever ran next. Output is streamed through so a failure reads exactly as
// it does when the script is run on its own.
//
// Sequential rather than parallel. The whole suite is a couple of seconds, and
// interleaved output from twenty processes is not something anyone wants to
// read at the moment a test has just failed.

import { spawn } from "node:child_process"
import { readdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const self = path.basename(fileURLToPath(import.meta.url))

const scripts = (await readdir(here))
  .filter((name) => name.endsWith(".test.mjs") && name !== self)
  .sort()

function run(name) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", path.join(here, name)],
      // The child writes straight to this process's streams, so nothing is
      // buffered and nothing is reformatted.
      { stdio: "inherit" }
    )
    // A signal death (`code` null) is a failure like any other — it must not
    // fall through as a zero.
    child.on("close", (code) => resolve(code === 0))
    child.on("error", () => resolve(false))
  })
}

const failed = []
for (const name of scripts) {
  console.log(`\n${"=".repeat(72)}\n== ${name}\n${"=".repeat(72)}`)
  if (!(await run(name))) failed.push(name)
}

console.log(`\n${"=".repeat(72)}`)
if (failed.length === 0) {
  console.log(`ALL ${scripts.length} SCRIPTS PASS`)
  process.exit(0)
}
console.log(`${failed.length} of ${scripts.length} SCRIPTS FAILED:`)
for (const name of failed) console.log(`  ${name}`)
process.exit(1)
