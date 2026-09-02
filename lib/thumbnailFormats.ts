// THE PER-DB THUMBNAIL FORMAT POLICY, as the settings page reads and writes it
// (docs/thumbnail-format-implementation.md R5).
//
// Its own module, out of components/scan/Config.tsx, because none of it is a
// component: it is four total functions over a stored value that may have been
// written by a newer Server or hand-edited into a TOML, and
// scripts/thumbnailformats.test.mjs executes them under plain node. Import-free
// for exactly that reason.

// The formats the scan is ALLOWED to write renditions in
// (docs/thumbnail-format-implementation.md R5). A CONSTRAINT on the
// per-content-class policy, never the policy itself: with `webp` dropped every
// WebP verdict becomes JPEG (alpha flattened, as before the format work), and
// with `jpeg` dropped every JPEG verdict becomes WebP — the storage-constrained
// deployment, which knowingly pays the slower decode the grid is bound by.
export const THUMBNAIL_FORMAT_OPTIONS = [
    { value: "jpeg", label: "JPEG" },
    { value: "webp", label: "WebP" },
]

// What the server applies for a database that has never written the key, and
// therefore what the control must show for one. The server reads an EMPTY list
// as this same default (with a warning) rather than rejecting the save, so the
// only thing the UI owes it is not to OFFER an empty selection.
export const THUMBNAIL_FORMATS_DEFAULT = ["jpeg", "webp"]

// Is this stored entry one of the two formats this control knows how to draw?
export function isKnownThumbnailFormat(entry: unknown): entry is string {
    return typeof entry === "string"
        && THUMBNAIL_FORMAT_OPTIONS.some((option) => option.value === entry)
}

// TAKES `unknown`, and that is about the CONFIG OBJECT rather than about the
// spec: the per-DB config carries an index signature for keys the UI does not
// model, so a value read off it is only ever as trustworthy as the file it came
// from — and a config written by a Server that predates this key is genuinely
// absent, not merely untyped.
//
// WHAT THE CONTROL SHOWS AS CHECKED: the KNOWN entries of the stored list, and
// nothing else. The default stands in for exactly the two cases where the
// server itself applies the default — the key absent (or not a list at all)
// and the list empty — and for no other. In particular a stored `["avif"]`
// shows NEITHER box checked, which is the truth about what this UI can see;
// showing the default there would be a claim about the stored value that the
// very next toggle would then make true by overwriting it (see
// `mergeThumbnailFormats`, which is why it no longer can).
export function effectiveThumbnailFormats(value: unknown): string[] {
    if (!Array.isArray(value) || value.length === 0) return THUMBNAIL_FORMATS_DEFAULT
    return value.filter(isKnownThumbnailFormat)
}

// WHAT A TOGGLE WRITES. The settings page round-trips the WHOLE config object
// on every save, so anything this control drops from the list is deleted from
// the user's database — and the list may legitimately hold values this build
// of the UI does not model (a newer Server's format, a hand-edited TOML).
//
// So the write is a MERGE, not a replacement: every stored STRING the control
// cannot draw is carried through in its stored position untouched, every known
// entry survives iff it is still selected, and newly selected ones are
// appended. A UI that only knows two formats can therefore be used on a
// database that stores three without silently discarding the third.
//
// ONLY STRINGS SURVIVE, and that is what makes the length of the result mean
// something. The setting is a `Vec<String>`, so anything else in there is junk
// — a hand-edited TOML with a number in the list, a `null` — and carrying it
// would (a) write junk back and (b) let it COUNT as a format: the caller's
// "at least one must stay selected" refusal is measured against this list, and
// a stored `[null]` would otherwise let both boxes be cleared into a list the
// server reads as empty. Dropping it is the only reading under which the
// refusal is honest.
export function mergeThumbnailFormats(value: unknown, selected: string[]): string[] {
    const stored: unknown[] = Array.isArray(value) ? value : []
    const kept = stored.filter((entry): entry is string =>
        typeof entry === "string"
        && (!isKnownThumbnailFormat(entry) || selected.includes(entry)))
    const added = selected.filter((format) => !kept.includes(format))
    return [...kept, ...added]
}
