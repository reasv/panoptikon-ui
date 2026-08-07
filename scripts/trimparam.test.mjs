// Assertions for lib/galleryTrim.ts (the `vt` param) and the centisecond
// trim codec it shares with lib/pinboardCrop.ts. No test runner in this
// repo — run it directly from the ui root:
//
//   node --experimental-strip-types scripts/trimparam.test.mjs
//
// (the flag is what lets a .mjs import the .ts module; Node 22+). Exits
// non-zero on the first failing assertion set.

// galleryTrim imports its sibling extensionless, which node's resolver
// rejects; ts-hooks fills that in. register() has to run before the modules
// load, hence the dynamic imports.
import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const {
  encodeGalleryTrim,
  newPinHField,
  parseGalleryTrim,
  trimForSha,
} = await import("../lib/galleryTrim.ts")
const { decodeTime, encodeTime, parseHField } = await import(
  "../lib/pinboardCrop.ts"
)

let all = true
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `\n  ${detail}` : ""}`)
  all &&= !!ok
  return ok
}

const SHA = "0a1b2c3d4e5f60718293a4b5c6d7e8f900112233445566778899aabbccddeeff"
const SHA10 = SHA.slice(0, 10) // "0a1b2c3d4e"
const OTHER = "ff00112233445566778899aabbccddeeff00112233445566778899aabbccddee"

// ---- codec round-trips ----------------------------------------------

// Centisecond resolution: everything below is exact on the lattice, so the
// round-trip must be equality, not a tolerance.
for (const [label, seconds] of [
  ["zero", 0],
  ["sub-second", 0.07],
  ["one centisecond", 0.01],
  ["seconds", 42.35],
  ["minutes", 96.1],
  ["hours", 7384.56],
]) {
  const encoded = encodeTime(seconds)
  const back = decodeTime(encoded)
  check(
    `codec round-trip ${label}`,
    back === seconds && /^[0-9a-z]+$/.test(encoded),
    `${seconds}s -> "${encoded}" -> ${back}`
  )
}

check("codec rounds to centiseconds", encodeTime(1.234) === (123).toString(36))
check("codec clamps negatives to 0", encodeTime(-5) === "0")
check("decodeTime of empty is null", decodeTime("") === null)

// ---- vt encode -------------------------------------------------------

check(
  "encode both bounds",
  encodeGalleryTrim(SHA, { start: 2.0, end: 100.0 }) ===
    `${SHA10}~${encodeTime(2)}.${encodeTime(100)}`,
  encodeGalleryTrim(SHA, { start: 2.0, end: 100.0 })
)
check(
  "encode start only",
  encodeGalleryTrim(SHA, { start: 2.0, end: null }) === `${SHA10}~5k.`
)
check(
  "encode end only",
  encodeGalleryTrim(SHA, { start: null, end: 2.0 }) === `${SHA10}~.5k`
)
check(
  "encode freeze frame",
  encodeGalleryTrim(SHA, { start: 2.0, end: 2.0 }) === `${SHA10}~5k.5k`
)
check(
  "encode zero start is a bound, not absence",
  encodeGalleryTrim(SHA, { start: 0, end: null }) === `${SHA10}~0.`
)
check("empty trim encodes to null", encodeGalleryTrim(SHA, null) === null)
check(
  "both bounds unset encodes to null",
  encodeGalleryTrim(SHA, { start: null, end: null }) === null
)
// A prefix the parser would reject must never be written (junk in the URL,
// silently dropped trim)
check(
  "short sha encodes to null",
  encodeGalleryTrim("0a1b2c", { start: 2, end: null }) === null
)
check(
  "non-hex sha encodes to null",
  encodeGalleryTrim("not-a-sha-at-all", { start: 2, end: null }) === null
)

// ---- vt decode -------------------------------------------------------

function parsed(value) {
  const slot = parseGalleryTrim(value)
  return slot && [slot.sha10, slot.trim.start, slot.trim.end]
}

check(
  "decode both bounds",
  JSON.stringify(parsed(`${SHA10}~5k.7ps`)) ===
    JSON.stringify([SHA10, 2, 100]),
  JSON.stringify(parsed(`${SHA10}~5k.7ps`))
)
check(
  "decode start only",
  JSON.stringify(parsed(`${SHA10}~5k.`)) === JSON.stringify([SHA10, 2, null])
)
check(
  "decode end only",
  JSON.stringify(parsed(`${SHA10}~.5k`)) === JSON.stringify([SHA10, null, 2])
)
check(
  "decode freeze frame",
  JSON.stringify(parsed(`${SHA10}~5k.5k`)) === JSON.stringify([SHA10, 2, 2])
)
check(
  "decode long value",
  JSON.stringify(parsed(`${SHA10}~0.${encodeTime(7384.56)}`)) ===
    JSON.stringify([SHA10, 0, 7384.56])
)

// Round-trip through the param for a spread of trims
for (const trim of [
  { start: 0, end: null },
  { start: null, end: 0.07 },
  { start: 12.34, end: 12.34 },
  { start: 1.5, end: 7384.56 },
]) {
  const slot = parseGalleryTrim(encodeGalleryTrim(SHA, trim))
  check(
    `vt round-trip ${JSON.stringify(trim)}`,
    slot?.sha10 === SHA10 &&
      slot.trim.start === trim.start &&
      slot.trim.end === trim.end,
    JSON.stringify(slot)
  )
}

// ---- malformed input -------------------------------------------------

for (const bad of [
  null,
  "",
  "garbage",
  `${SHA10}1w.7ps`, // missing the ~ separator
  `${SHA10}~`, // no bounds at all
  `${SHA10}~.`, // both sides empty is the absent param, not a value
  `${SHA10}~1w`, // missing the . separator
  `${SHA10}~5k.7ps.8aa`, // a second separator
  `${SHA10}~5K.7ps`, // uppercase is outside the base36 alphabet used
  `${SHA10}~5k.2$`, // not base36 at all
  "0a1b2c~5k.2s", // prefix too short
  `${SHA}~5k.7ps`, // full sha, not the 10-char prefix
  "zzzzzzzzzz~5k.2s", // prefix is not hex
  // Uppercase hex would be well-formed yet compare case-sensitively against
  // always-lowercase item shas — permanently inert; rejected instead
  `${SHA10.toUpperCase()}~5k.7ps`,
]) {
  check(`malformed -> null: ${JSON.stringify(bad)}`, parseGalleryTrim(bad) === null)
}

// The h field's `t` group prefix is NOT rejected here and must never be
// written: "t" is a base36 digit, so "t5k" is a legal (huge) time rather
// than a marked-up one — the ambiguity the h field's uppercase suffix
// prefixes exist to avoid.
check(
  "a `t` prefix reads as base36, not as a marker",
  parseGalleryTrim(`${SHA10}~t5k.`)?.trim.start === parseInt("t5k", 36) / 100
)

// ---- sha matching ----------------------------------------------------

const slot = parseGalleryTrim(`${SHA10}~5k.7ps`)
check("trim applies to its own item", trimForSha(slot, SHA)?.start === 2)
check("trim is inert for another item", trimForSha(slot, OTHER) === null)
check("no slot means no trim", trimForSha(null, SHA) === null)

// ---- h-field bridge --------------------------------------------------

const field = newPinHField(37, SHA, slot)
const packed = parseHField(field)
// The h field is frozen wire format: pin the literal bytes, not just a
// symmetric pack/parse round-trip (which would pass even if both sides of
// the codec drifted together)
check("packed record wire bytes", field === "37t5k.7ps", field)
check(
  "packed record keeps the height",
  packed.h === 37 && field.startsWith("37"),
  field
)
check(
  "packed record carries the trim",
  packed.trim?.start === 2 && packed.trim?.end === 100,
  JSON.stringify(packed.trim)
)
check(
  "packed record carries nothing else",
  packed.crop === null &&
    packed.autoCrop === null &&
    packed.lock === null &&
    packed.orient === null
)
check(
  "one-sided trim packs one bound",
  (() => {
    const one = parseHField(
      newPinHField(9, SHA, parseGalleryTrim(`${SHA10}~.5k`))
    )
    return one.h === 9 && one.trim?.start === null && one.trim?.end === 2
  })()
)

// A pin with no trim of its own must be byte-identical to what the writers
// produced before the bridge existed — a bare integer, no suffix.
check("no matching trim -> bare height", newPinHField(37, OTHER, slot) === "37")
check("no slot -> bare height", newPinHField(37, SHA, null) === "37")

console.log(all ? "\nALL PASS" : "\nFAILURES")
process.exit(all ? 0 : 1)
