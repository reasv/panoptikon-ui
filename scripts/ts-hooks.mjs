// Module-resolution hooks so a plain node script can import the app's .ts
// modules by the specifiers they actually use.
//
// Node's ESM resolver requires file extensions; the app's imports are
// extensionless (bundler resolution, as TypeScript and Next.js want them).
// This hook retries any extensionless relative specifier with ".ts", which
// is all the pure-math test scripts need — with --experimental-strip-types
// node then loads the module directly.

import { fileURLToPath, pathToFileURL } from "node:url"
import { dirname, resolve as resolvePath } from "node:path"

// The app root, so the "@/..." path alias tsconfig declares resolves for a
// plain node run too. Only the modules a test actually imports are loaded, so
// this stays as cheap as the extension retry below.
const APP_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..")

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const target = pathToFileURL(resolvePath(APP_ROOT, specifier.slice(2))).href
    return resolve(target, context, next)
  }
  if (specifier.startsWith("file://") && !/\.[mc]?[jt]s$/.test(specifier)) {
    try {
      return await next(`${specifier}.ts`, context)
    } catch {
      // Fall through, as below
    }
  }
  if (specifier.startsWith(".") && !/\.[mc]?[jt]s$/.test(specifier)) {
    try {
      return await next(`${specifier}.ts`, context)
    } catch {
      // Fall through to the normal resolution, whose error is the useful one
    }
  }
  return next(specifier, context)
}
