// Module-resolution hooks so a plain node script can import the app's .ts
// modules by the specifiers they actually use.
//
// Node's ESM resolver requires file extensions; the app's imports are
// extensionless (bundler resolution, as TypeScript and Next.js want them).
// This hook retries any extensionless relative specifier with ".ts", which
// is all the pure-math test scripts need — with --experimental-strip-types
// node then loads the module directly.

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\.[mc]?[jt]s$/.test(specifier)) {
    try {
      return await next(`${specifier}.ts`, context)
    } catch {
      // Fall through to the normal resolution, whose error is the useful one
    }
  }
  return next(specifier, context)
}
