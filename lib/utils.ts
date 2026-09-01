import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
// Type-only: `./panoptikon` is a .d.ts, so a VALUE import of it is a runtime
// module the node test scripts cannot resolve (the same rule
// lib/videoTranscode.ts documents).
import type { components, paths } from "./panoptikon"
import type { ThumbnailTier } from "./thumbnailTier"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
/**
 * `size` selects a stored rendition tier (`lib/thumbnailTier.ts`) and applies
 * to `file_type: "thumbnail"` only — the original file has no tiers.
 *
 * OMITTING it is the legacy bare URL, which the endpoint answers with the
 * display rendition. Passing `"display"` explicitly is therefore the same
 * BYTES and a DIFFERENT URL, and both halves of that are deliberate wherever
 * a call site spells it out (§2, F4): it keeps the aspect rule visible at the
 * call site, and a new URL cannot be answered from a cache entry stamped
 * before the display tier's rule changed — which is what busts the stale
 * long-side-crushed thumbnail for exactly the extreme-aspect items the fix
 * was about.
 *
 * `still` forces the STATIC rendition of an animated item — at a grid tier an
 * animated item above the raw floor otherwise answers `video/mp4`, which an
 * `<img>` cannot show. The endpoint documents it as a no-op everywhere else
 * (static items, and animated items at or below the floor, are served the same
 * bytes either way), so a surface that cannot play video may set it from
 * `isAnimatedItem` alone — or unconditionally where it has no row to test
 * (lib/thumbnailTier.ts). It is a distinct URL, hence a distinct cache entry;
 * that is the whole cost of the no-op case.
 */
export function getFileURL(
  dbs: { index_db: string | null; user_data_db: string | null },
  file_type: "file" | "thumbnail",
  // Path-derived (not operations[...]): path strings are stable across
  // spec generators, operationIds are not.
  id_type: paths["/api/items/item"]["get"]["parameters"]["query"]["id_type"],
  id: string | number,
  size?: ThumbnailTier,
  still?: boolean
) {
  const index_db_param = dbs.index_db ? `&index_db=${dbs.index_db}` : ""
  const size_param = size ? `&size=${size}` : ""
  const still_param = still ? `&still=true` : ""
  return `/api/items/item/${file_type}?id=${id}&id_type=${id_type}${index_db_param}${size_param}${still_param}`
}

// Basename of an indexed path. Either separator: the index stores paths as
// the OS produced them.
export function fileNameFromPath(path: string): string {
  const lastSep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return path.slice(lastSep + 1)
}

// Name for a "save the original file" link. The indexed basename is the
// truth; an item with no path on record still gets a findable name from its
// hash plus the mime subtype, since a download with no extension is one the
// OS can't open.
export function downloadFileName(
  path: string | null | undefined,
  sha256: string,
  mime?: string | null,
): string {
  const name = fileNameFromPath(path ?? "")
  if (name) return name
  const stem = sha256.slice(0, 10)
  const subtype = mime?.split(";")[0].split("/")[1]
  return subtype ? `${stem}.${subtype}` : stem
}

export function prettyPrintBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  let unitIndex = 0

  while (bytes >= 1024 && unitIndex < units.length - 1) {
    bytes /= 1024
    unitIndex++
  }

  return `${bytes.toFixed(2)} ${units[unitIndex]}`
}

// The same number for a place that is GLANCED at rather than read: the
// gallery headers, where the size shares a line with the timestamp and every
// character it spends is one the path does not get.
//
// Its own function rather than a parameter on the one above, because the
// callers there want the opposite thing. A download link and an export toast
// are quoting a file size as a fact, and "42.13 MB" is the honest form; a
// header is answering "roughly how big is this?", where two decimals on a
// half-kilobyte thumbnail ("988.00 B") is noise in the one place there is no
// room for it.
//
// Precision by magnitude: whole units below MB (a byte count with a decimal
// point is spurious, and nobody needs 412.4 KB), one decimal above, trailing
// ".0" dropped so a round number stays short.
export function prettyPrintBytesCompact(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  const text =
    unitIndex < 2
      ? String(Math.round(value))
      : value.toFixed(1).replace(/\.0$/, "")
  return `${text} ${units[unitIndex]}`
}

export function prettyPrintVideoDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)

  const hoursStr = hours > 0 ? String(hours).padStart(2, "0") + ":" : ""
  const minutesStr = String(minutes).padStart(2, "0")
  const secondsStr = String(remainingSeconds).padStart(2, "0")

  return hoursStr + minutesStr + ":" + secondsStr
}

export function getLocale(date: Date) {
  return date.toLocaleString("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const MINUTE_MS = 60_000
// Past this age, relative times ("38d ago") read worse than a plain date.
const RELATIVE_CUTOFF_MS = 7 * 24 * 60 * MINUTE_MS

function relativeShort(date: Date, now: Date): string | null {
  const diff = now.getTime() - date.getTime()
  if (diff < 0 || diff >= RELATIVE_CUTOFF_MS) return null
  const minutes = Math.floor(diff / MINUTE_MS)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// Compact date for card/row footers: relative while recent, then a short
// absolute date. Pair with dateTitle() on hover for the full timestamp.
export function compactDate(date: Date, now: Date = new Date()): string {
  return (
    relativeShort(date, now) ??
    date.toLocaleDateString("en", {
      month: "short",
      day: "numeric",
      ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
    })
  )
}

// Hover text pairing the full timestamp with a relative age, so whichever
// form a compactDate() displays, the other is one hover away.
export function dateTitle(date: Date, now: Date = new Date()): string {
  const diff = date.getTime() - now.getTime()
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 24 * 3600e3],
    ["month", 30 * 24 * 3600e3],
    ["week", 7 * 24 * 3600e3],
    ["day", 24 * 3600e3],
    ["hour", 3600e3],
    ["minute", 60e3],
  ]
  const [unit, ms] = units.find(([, ms]) => Math.abs(diff) >= ms) ?? [
    "second",
    1e3,
  ]
  // trunc, not round: "2h55m ago" must read "2 hours ago" to agree with
  // the floored short form compactDate shows next to it
  return `${getLocale(date)} (${rtf.format(Math.trunc(diff / ms), unit)})`
}

// The DOM markers of a genuinely OPEN popup layer: a dialog, or any Radix
// popper-positioned surface (dropdown and context menus, selects, popovers,
// hover cards — all of which render inside that wrapper). Every `window`
// keyboard scope in the app stands down while one is up, because the layer
// owns the keyboard over whatever it covers and its own Esc / arrow keys must
// not double as the surface underneath's.
//
// TRAP — `[role="listbox"]` was on this list and must never come back. cmdk
// renders that role on Command.List UNCONDITIONALLY, and the tag autocomplete
// (components/tagInput.tsx) keeps its list mounted and merely `hidden`-classed
// whether or not the dropdown is open, as does every inline multiCombobox
// (`omitWrapper`). On any tag-indexed database with completion enabled — the
// default, and the normal case — the selector therefore matched ALWAYS, and
// every guard built on it degenerated into an unconditional `return`: the
// gallery's arrow keys, its Ctrl+C share and the viewer's Esc were all dead.
// Nothing is lost by dropping it: the listbox that IS an open layer is Radix
// Select's, which lives inside [data-radix-popper-content-wrapper] and is
// still matched, and a cmdk list that is genuinely open has focus in its own
// <input>, which each of these guards already excludes by event target.
const OPEN_LAYER_SELECTOR =
  '[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]'

/**
 * Is a popup layer open right now? Matched against the document rather than
 * against a subtree because Radix portals its content to <body>. `extra`
 * appends surface-specific markers (the board's modal gestures, say) to the
 * shared list.
 */
export function hasOpenLayer(extra?: string): boolean {
  return document.querySelector(
    extra ? `${OPEN_LAYER_SELECTOR}, ${extra}` : OPEN_LAYER_SELECTOR
  ) !== null
}

// Widgets whose OWN keyboard contract includes the arrow keys, so a focused
// one must not also step the surface underneath.
//
// This is a DIFFERENT question from hasOpenLayer's, and the two must not be
// merged. "Is a layer open" is about the DOCUMENT (a portalled Radix popper
// is nowhere near the event target) and it suspends a whole key scope for as
// long as the layer is up. "Does this control consume arrows" is about the
// EVENT TARGET (matched with closest, never a document query) and it suspends
// only the keys that control actually claims. Widening the open-layer
// selector to cover these would be the wrong lever twice over: a tab strip is
// not a popup, and matching one anywhere in the document would kill every
// window key everywhere — the exact shape of the `[role="listbox"]` trap
// documented above.
//
// The list is what this repo actually renders, verified rather than guessed:
//
//   - [role="tablist"] — Radix Tabs (components/ui/tabs.tsx), whose List is a
//     RovingFocusGroup and whose Root defaults to activationMode="automatic",
//     so `←`/`→` on a focused trigger SWITCH TABS. Rendered right beside the
//     gallery's picture (PinboardTabs in the gallery header) and in the
//     results header (SearchPage). Matched on the LIST, not on [role="tab"]:
//     the keydown target is the trigger, and the trigger is inside it.
//   - [role="slider"] — the Radix Slider thumb (components/ui/slider.tsx),
//     whose arrows step the value: the page-size and confidence controls,
//     which sit in the sidebar beside the gallery and inside the maximized
//     workspace's sidebar overlay.
//
// Deliberately NOT here: role="toolbar" and role="radiogroup" (nothing in
// this repo renders either — Radix's menu radio groups are role="group"
// inside a role="menu" that hasOpenLayer already matches), and the video
// surface's volume control, which is an <input type=range> and is already
// excluded by every scope's INPUT test.
const ARROW_CONSUMER_SELECTOR = '[role="tablist"], [role="slider"]'

/**
 * Does the event target belong to a control that owns the arrow keys? Callers
 * bail out of their own arrow/stepping branches on it and keep the rest of
 * their scope live — a tab trigger consumes `←`/`→`, it does not consume `m`.
 */
export function consumesArrowKeys(target: EventTarget | null): boolean {
  const el = target as Element | null
  return !!el?.closest?.(ARROW_CONSUMER_SELECTOR)
}
