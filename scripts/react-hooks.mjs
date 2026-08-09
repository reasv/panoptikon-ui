// Resolves the bare specifier "react" to scripts/fake-react.mjs, so a node
// script can import a hook module and drive it without a renderer or a DOM.
// Registered ONLY by scripts/endaction.test.mjs, alongside ts-hooks.mjs.

export async function resolve(specifier, context, next) {
  if (specifier === "react") {
    return {
      url: new URL("./fake-react.mjs", import.meta.url).href,
      shortCircuit: true,
    }
  }
  return next(specifier, context)
}
