import { useQueryState, parseAsBoolean, parseAsInteger } from "nuqs"

// The parser objects are exported alongside the hooks because the details
// pane's consolidated reader (useDataViewPane, components/OpenFileDetails.tsx)
// folds these two keys into one `useQueryStates` together with the board
// flags. Sharing the objects rather than restating them is what keeps the
// wire format from drifting between the two ways of reading the same param.
export const sideBarOpenParser = parseAsBoolean.withDefault(false).withOptions({
  history: "push",
  clearOnDefault: true,
})

export const sideBarTabParser = parseAsInteger.withDefault(0).withOptions({
  history: "push",
  clearOnDefault: true,
})

export const useSideBarOpen = () => useQueryState(`sb`, sideBarOpenParser)

export const useSideBarTab = () => useQueryState(`sbt`, sideBarTabParser)
