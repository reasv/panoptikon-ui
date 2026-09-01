/**
 * The bounds of what the search URL's two size parameters may hold.
 *
 * These are not slider ends that happen to be reused — they are the domain of
 * `page_size` and `cs`, and four separate modules have to agree on them: the
 * controls that produce a value (the sidebar's Page Size slider, the results
 * header's cell-size slider), the arithmetic that derives one from another
 * (lib/gridCellSize.ts's page-size co-write), and the creation-defaults layer
 * that decides whether a value out of localStorage may be STAMPED into a URL
 * (lib/searchDefaults.ts). Each of them used to restate the pair with a
 * comment apologizing for restating it; a stamp allowing what a control cannot
 * produce, or a co-write clamping to a different ceiling, is the bug that
 * shape invites.
 *
 * NOTHING BUT CONSTANTS LIVES HERE, and that is what makes the single source
 * possible: two of the consumers are deliberately import-free so the node test
 * suites can strip types off them under plain node, and a module with no
 * imports and no runtime behaviour costs them nothing to depend on. Do not add
 * a helper, a React hook or a type that needs one.
 */

/** The page-size domain, and the ends of the sidebar's Page Size slider. */
export const MIN_PAGE_SIZE = 1
export const MAX_PAGE_SIZE = 10000

/**
 * The explicit cell-width domain in CSS pixels, and the ends of the results
 * header's size slider. "Auto" is the parameter's ABSENCE, not a value in this
 * range (see lib/gridCellSize.ts).
 */
export const MIN_CELL_WIDTH = 140
export const MAX_CELL_WIDTH = 1200
