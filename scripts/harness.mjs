// The three lines every test script in this directory used to spell for
// itself: a pass/fail line, an accumulator, and an exit code.
//
// There is no test runner in this repo, deliberately — every module under
// assertion is pure and import-free precisely so `node
// --experimental-strip-types` can execute it — and that is not what this
// changes. What it changes is that twenty copies of the same four-line `check`
// had already drifted: some returned `ok` (so a caller can `break` on a
// failure), some returned nothing; some printed the ALL PASS / FAILURES
// summary, some exited silently. One helper ends both.
//
// Plain `.mjs` with no imports of its own, so a test file can pull it in
// statically before it registers the TypeScript loader hook.

/**
 * A checker for one script. Returns the two things a script needs and nothing
 * else, so the accumulator cannot be read or written from outside.
 *
 *   check(name, ok, detail?) -> boolean   prints, accumulates, ANSWERS
 *   finish()                              prints the summary and exits
 *
 * `check` RETURNS THE VERDICT, always: a loop that asserts per case wants to
 * `break` on the first failure rather than print a hundred identical lines, and
 * a helper that answered `undefined` for some callers and a boolean for others
 * is a trap waiting for the next one.
 *
 * `detail` is printed indented under the line, and only when it is non-empty —
 * so a caller may pass the value under test unconditionally and it shows up
 * where it is useful without adding a blank line where it is not.
 */
export function createChecker() {
  let all = true
  const check = (name, ok, detail = "") => {
    const verdict = !!ok
    console.log(`${verdict ? "PASS" : "FAIL"} ${name}${detail ? `\n  ${detail}` : ""}`)
    all &&= verdict
    return verdict
  }
  const finish = () => {
    console.log(all ? "\nALL PASS" : "\nFAILURES")
    process.exit(all ? 0 : 1)
  }
  return { check, finish }
}
