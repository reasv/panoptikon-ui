import React, { useMemo } from 'react'
import { Square, SquareCheckBig } from 'lucide-react'
import { useItemSelection } from '@/lib/state/itemSelection'
import { useShallow } from 'zustand/react/shallow'
import { components } from '@/lib/panoptikon'
import { useDataViewPane } from '@/components/OpenFileDetails'

export function SelectButton({
    sha256, // This is usually just the prefix of the sha256 hash
    item,
    files,
}: {
    sha256: string,
    item?: components["schemas"]["ItemRecordResponse"],
    /**
     * THREE STATES, and the third one is the whole point of the `| null`.
     *
     *   - an array: the rows are known, so file identity decides everything
     *     below;
     *   - `undefined`: this call site HAS no files and never will (it renders
     *     from a sha alone), so the content test is the only test available;
     *   - `null`: the files are still LOADING at a call site that does have
     *     them. Neither test may run — the array test cannot (there is
     *     nothing to compare) and the content test must not (see isReClick).
     *
     * Callers with a query behind them must pass `data?.files ?? null`, never
     * `data?.files`: collapsing pending into "no files here" is what put the
     * duplicate bug back inside the loading window.
     */
    files?: components["schemas"]["FileRecordResponse"][] | null
}) {
    const [selected, setSelected] = useItemSelection(useShallow((state) => [state.getSelected(), state.setItem]))
    // THE GLYPH's test: the sha256 prefix, which is all this component is
    // given for the rows it renders without an `item`/`files` pair. It says
    // "the selection is this CONTENT", which is what a checkbox on a picture
    // reads as.
    const isSelected = useMemo(() => selected?.sha256.startsWith(sha256), [selected, sha256])
    // THE RE-CLICK's test, and it is deliberately a DIFFERENT one: file
    // identity, the same rule the selection store itself uses (itemEquals in
    // components/OpenFileDetails.tsx compares file_id). Panoptikon indexes
    // per FILE, so a copy or a hardlink is an ordinary second row with the
    // same sha256 — and with the content test driving the branch, selecting
    // item A and then clicking its byte-identical duplicate B took the
    // re-click path and opened the Data View on **A**, while B could never
    // be selected from its own checkbox at all. Harmless while the re-click
    // was a no-op; an actively wrong record once it opened a pane.
    //
    // Falls back to the content test only where there is no file to compare
    // AND never will be — `undefined`, a call site rendering from a sha
    // alone. Those cannot select anything either (the branch below needs
    // `item && files`), so the re-click is the only thing they can do.
    //
    // `null` is PENDING and is neither: the fallback used to swallow it, so
    // on a board holding a duplicate or hardlink of the selected file,
    // pressing that pin's checkbox before its metadata landed took the
    // re-click path on the CONTENT test and opened the Data View on the
    // OTHER row — with a toast announcing it. The whole reason the re-click
    // test is file identity is that content identity picks the wrong row
    // here; leaving a window where content identity runs anyway left the bug
    // live, just harder to hit. Pending is therefore a NO-OP press: not a
    // re-click, and not a select either (there is no file to select). The
    // window is the pin's own metadata query, usually a cache hit.
    //
    // ACCEPTED: a pin whose metadata query ERRORS stays pending forever, so
    // its checkbox is permanently dead rather than falling back to the
    // content test. That is the safe direction — the fallback's only
    // available verb on such a pin was the re-click, i.e. the one that opens
    // a record, and opening the WRONG record is worse than opening none.
    // Selecting was never possible without files (see the branch below).
    const filesPending = files === null
    const isReClick = filesPending
        ? false
        : files && files.length > 0
            ? selected?.file_id === files[0].id
            : isSelected
    // WHICH details pane this second press opens is not this component's
    // business: the hook routes to the maximized board's sidebar overlay or
    // to the page's own <SideBar/>, exactly as the Data View button does
    // (components/OpenFileDetails.tsx).
    //
    // The full pane hook, not the open-only one, because the third press
    // CLOSES (see handlePinClick). That costs this button the pane's shown
    // state as a render input, so every pin on the board re-renders when the
    // pane opens or closes. Accepted, and cheaper than it reads: the routing
    // hook already holds a useQueryStates over `sb`/`gsb`/`sbt`, so a pin
    // already re-rendered on the URL half of that state; the addition is the
    // ephemeral open flag. What must NOT come back is a per-row read of
    // `pinboard` — see the hook's key budget.
    const { dataViewOpen, openDataView, closeDataView } = useDataViewPane()

    // TWO PRESSES, TWO VERBS: select, then open the Data View. The second
    // press used to be a no-op, which is what made this the natural place
    // for the gesture — and doing it as the RE-CLICK rule rather than an
    // onDoubleClick handler is deliberate. A double-click on an unselected
    // item already delivers both clicks, so the gesture the user asked for
    // (double-click a pin to inspect it) falls out for free; adding
    // onDoubleClick instead would fire ON TOP of the two clicks that
    // produced it, selecting and then opening and then opening again.
    //
    // The already-selected press does NOT re-select: the item under this
    // button IS the selection, so the pane simply paints what is already
    // there.
    //
    // And the second verb TOGGLES. `isReClick && dataViewOpen` is precisely
    // "the Data View is open ON THIS ITEM" — isReClick already means this
    // pin's file IS the selection, and the pane always paints the current
    // selection — so a further press closing it is the same gesture the
    // Data View button in the viewer header offers, reached from the board.
    // Without it the button was a one-way door: the press that opened the
    // pane did nothing at all when repeated, which reads as a dead control
    // sitting on the very item being inspected.
    const handlePinClick = () => {
        // Pending: neither verb is available yet (see isReClick). Explicit
        // rather than relying on `item && files` below to be falsy, because
        // that guard is about a call site having no files at all.
        if (filesPending) return
        if (isReClick) {
            if (dataViewOpen) closeDataView()
            else openDataView()
            return
        }
        if (item && files) {
            if (files.length === 0) return
            const file = files[0]
            setSelected({
                file_id: file.id,
                path: file.path,
                sha256: item.sha256,
                item_id: item.id,
                last_modified: file.last_modified,
                type: item.type,
                width: item.width,
                height: item.height,
                // Same payload the pin's double-click builds
                // (GalleryPinBoard's selectAsCurrentItem) — the gallery's
                // player reads this snapshot for outro skip whenever the
                // item is not in the current result page, so a field missing
                // here would make corner-select and double-click behave
                // differently on the very same pin. `duration` travels with
                // it: without it the cut point falls back to its
                // start-anchored approximation for this selection path.
                duration: item.duration,
                content_end_ms: item.content_end_ms,
            })
        }
    }
    return <button
        // data-opens-data-view: the docks' outside-click dismissal exempts
        // this selector (NOT_OUTSIDE in app/search/dockChrome.tsx). Without
        // it, pressing this button while the maximized board's sidebar
        // overlay is up counted as an outside click — the panel unmounted,
        // losing accordion state and scroll and re-firing the tab's fetches,
        // and this handler re-opened it in the same commit, so inspecting the
        // same pin twice flashed the sidebar out and back every press.
        // Deliberately its own attribute rather than `data-search-overlay`,
        // which means "is part of the search chrome" and is also consumed by
        // the board's marquee starter and click-outside deselect — a pin's
        // corner button belongs in neither of those exemptions.
        data-opens-data-view
        // The TITLE tracks the re-click test, because it describes what this
        // press is about to DO. The glyph below tracks the content test,
        // because it describes what is on screen. They can disagree on
        // exactly one row — a duplicate of the selected file — where the
        // check mark says "this picture is the selection" and the tooltip
        // says "select this image". Both are true of that row.
        title={
            filesPending
                ? "Loading this item's file details…"
                : isReClick
                    ? (dataViewOpen
                        ? "This image is selected — click again to close the Data View"
                        : "This image is selected — click again to open it in the Data View")
                    : "Select this image (click again to open it in the Data View)"
        }
        className={"hover:scale-105 absolute top-2 right-2 bg-white rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.35)] p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"}
        onClick={handlePinClick}
    >
        {isSelected ? (
            <SquareCheckBig className="w-6 h-6 text-gray-800 " />

        ) : (
            <Square className="w-6 h-6 text-gray-800" />
        )}
    </button>
}
