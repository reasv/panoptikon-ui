"use client"

import { useMemo, useRef, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import { $api } from "@/lib/api"
import { toast } from "@/components/ui/use-toast"
import { useBookmarkNs } from "@/lib/state/zust"
import { useSelectedDBs } from "@/lib/state/database"
import { useAlwaysShowBookmarkBtn } from "@/lib/state/alwaysShowBookmarks"
import { updateBookmarkStatusInSearchCache } from "@/lib/bookmarkSearchCache"
import { useFileOpenRunner } from "@/hooks/fileOpen"
import { useFileShareRunner } from "@/hooks/fileShare"
import { useItemSelection } from "@/lib/state/itemSelection"
import { useSearchOverlayReveal } from "@/lib/state/searchOverlayReveal"
import { useSideBarOpen, useSideBarTab } from "@/lib/state/sideBar"
import {
    getGalleryOptionsSerializer,
    useGalleryHidePinBoard,
    useGalleryIndex,
    useGalleryTrim,
    useSidebarOverlayOpen,
} from "@/lib/state/gallery"
import { usePinBoard } from "@/lib/state/pinboard"
import { usePinboardCarry } from "@/lib/state/pinboardCarry"
import { markPinboardPendingEdit } from "@/lib/pinboardNavigation"
import { newPinHField } from "@/lib/galleryTrim"
import { PIN_SHA_PREFIX_LENGTH } from "@/lib/pinboardCrop"
import { v1ScaleFactors } from "@/lib/pinboardGrid"
import { placeNewPin } from "@/lib/pinboardPlace"
import type { FileActionTarget } from "@/lib/relayContext"
import {
    CellCallbacksContext,
    CellFlagsContext,
    type CellCallbacks,
    type CellFileRef,
    type CellFlags,
} from "@/lib/state/cellActions"

/** The per-item Data View is tab 1 of whichever sidebar is mounted. */
const DATA_VIEW_TAB = 1

const BOOKMARK_PATH = "/api/bookmarks/ns/{namespace}/{sha256}"


/**
 * THE one owner of every URL/store subscription the per-row components used to
 * hold themselves — see lib/state/cellActions.ts for what that was costing and
 * why the split into stable callbacks and reactive flags is the shape of the
 * fix. Mounted once, by SearchPageContent, above BOTH the results panel and
 * the sidebar (the two subtrees that mount rows).
 *
 * `"use no memo"` and a render-assigned ref: the callbacks object is created
 * ONCE (`useMemo` with an empty dep list) so that consuming it can never
 * re-render a row, which means its methods have to reach the current values
 * through a mutable box. Assigning that box in the render body rather than an
 * effect is deliberate — `galleryHref` is read during a card's RENDER, and an
 * effect-assigned box is empty on the first paint of a deep-linked load.
 * Writing a ref during render is what the compiler must not be asked to
 * reason about, hence the directive. Opting out costs nothing here: the
 * compiler's own memoization has nothing to bite on, since the host's whole
 * output is one `children` element it never re-creates. (The explicit
 * `useMemo`s below are unaffected — they are hand-written value caches whose
 * identities the context contract depends on, not compiler output.)
 */
export function CellActionsHost({
    pinboardMaximized,
    children,
}: {
    /**
     * Whether the pinboard owns the whole view. Passed in rather than derived
     * here because SearchPageContent already computes it for its own render,
     * and the predicate reads `pinboard` — the app's longest URL parameter.
     */
    pinboardMaximized: boolean
    children: ReactNode
}) {
    "use no memo"

    // ---- bookmarks
    const [dbsState] = useSelectedDBs()
    const namespace = useBookmarkNs((state) => state.namespace)
    const alwaysShowBookmark = useAlwaysShowBookmarkBtn()[0]
    const queryClient = useQueryClient()
    const addBookmark = $api.useMutation("put", BOOKMARK_PATH)
    const removeBookmark = $api.useMutation("delete", BOOKMARK_PATH)

    // ---- open / reveal / share
    const fileOpen = useFileOpenRunner()
    const share = useFileShareRunner()

    // ---- the details pane's routing (was usePaneRouting, one instance per
    // grid card and per pin). Same three short keys, same rule: `pinboard` is
    // never read from here.
    const [sidebarOpen, setSidebarOpen] = useSideBarOpen()
    const [sidebarTab, setSidebarTab] = useSideBarTab()
    const [overlayPinned, setOverlayPinned] = useSidebarOverlayOpen()
    const overlayOpen = useSearchOverlayReveal((s) => s.sidebarRevealed)
    const setOverlayOpen = useSearchOverlayReveal((s) => s.setSidebarRevealed)
    const setSelectedItem = useItemSelection((state) => state.setItem)

    // ---- pinboard
    const { records, updateRecords } = usePinBoard()
    const galleryOpen = useGalleryIndex()[0] !== null
    const setHidePinBoard = useGalleryHidePinBoard()[1]
    const galleryTrim = useGalleryTrim()

    // ---- gallery links
    const searchParams = useSearchParams()

    const paneOpen = pinboardMaximized
        ? overlayOpen || overlayPinned
        : sidebarOpen
    const dataViewOpen = paneOpen && sidebarTab === DATA_VIEW_TAB

    // The pinned test, precomputed for the whole board instead of once per
    // pin button per render (PinButton used to filter the record array itself).
    const pinnedPrefixes = useMemo(() => {
        const set = new Set<string>()
        for (let i = 0; i < records.length; i += 5) {
            set.add(records[i].slice(0, PIN_SHA_PREFIX_LENGTH))
        }
        return set
    }, [records])

    // Referentially stable while the two values are unchanged, so the flags
    // object below does not change identity on a URL write that touched
    // neither. Built from the primitives rather than memoized on the nuqs
    // object, which is minted per render.
    const indexDb = dbsState.index_db
    const userDataDb = dbsState.user_data_db
    const dbs = useMemo(
        () => ({ index_db: indexDb, user_data_db: userDataDb }),
        [indexDb, userDataDb]
    )

    // Everything the callbacks read at invocation time. Reassigned on every
    // render, so a callback held since mount still sees the current URL.
    const snapshot = {
        dbs,
        namespace,
        queryClient,
        addBookmark,
        removeBookmark,
        fileOpen,
        share,
        pinboardMaximized,
        overlayPinned,
        setSidebarOpen,
        setSidebarTab,
        setOverlayPinned,
        setOverlayOpen,
        setSelectedItem,
        records,
        updateRecords,
        galleryOpen,
        setHidePinBoard,
        galleryTrim,
        searchParams,
    }
    const latest = useRef(snapshot)
    // Written in the render body, so an abandoned concurrent render can leave
    // its snapshot in the box: safe because every write a callback performs
    // goes through a functional update, and the one pre-commit READ (togglePin's
    // precomputation) only reads values that render itself was rendering with.
    latest.current = snapshot

    const callbacks = useMemo<CellCallbacks>(() => {
        const setPaneOpen = (open: boolean) => {
            const s = latest.current
            if (!s.pinboardMaximized) {
                void s.setSidebarOpen(open)
                return
            }
            s.setOverlayOpen(open)
            // Closing means GONE, so the pin goes with it: otherwise "Close
            // Data View" over a pinned sidebar is a dead button, because
            // `pinned` alone still satisfies `shown`.
            if (!open && s.overlayPinned) void s.setOverlayPinned(false)
        }
        return {
            toggleBookmark(sha256, isBookmarked) {
                const s = latest.current
                const query = s.dbs
                const namespace = s.namespace
                const params = { path: { namespace, sha256 }, query }
                const onSuccess = (deleted: boolean) => {
                    // The mutation result is authoritative — patch every cached
                    // search response so this card (and any other card showing
                    // the same item) flips instantly without a refetch.
                    updateBookmarkStatusInSearchCache(
                        s.queryClient,
                        query.user_data_db,
                        sha256,
                        namespace,
                        !deleted
                    )
                    s.queryClient.invalidateQueries({
                        queryKey: ["get", BOOKMARK_PATH, { params }],
                    })
                    s.queryClient.invalidateQueries({
                        queryKey: ["get", "/api/bookmarks/item/{sha256}", {
                            params: { path: { sha256 }, query },
                        }],
                    })
                    toast({
                        title: `Bookmark ${deleted ? "removed" : "added"}`,
                        description: `File has been ${deleted ? "removed from" : "added to"} the ${namespace} group`,
                        duration: 2000,
                    })
                }
                const onError = (error: any) => {
                    toast({
                        title: "Failed to update bookmark",
                        description: error.message,
                        variant: "destructive",
                        duration: 2000,
                    })
                }
                if (isBookmarked) {
                    s.removeBookmark.mutate({ params }, {
                        onSuccess: () => onSuccess(true),
                        onError,
                    })
                } else {
                    s.addBookmark.mutate({ params }, {
                        onSuccess: () => onSuccess(false),
                        onError,
                    })
                }
            },
            openFile(file: CellFileRef) {
                latest.current.fileOpen.openFile(file)
            },
            showInFolder(file: CellFileRef) {
                latest.current.fileOpen.showInFolder(file)
            },
            setActionTarget(target: FileActionTarget) {
                latest.current.fileOpen.setActionTarget(target)
            },
            pairRelay() {
                return latest.current.fileOpen.pairRelay()
            },
            shareFile(file: CellFileRef) {
                return latest.current.share.execute(file)
            },
            downloadFile(file: CellFileRef) {
                return latest.current.share.download(file)
            },
            openDataView(item?: SearchResult) {
                const s = latest.current
                // Unconditional: the selection store's own setItem bails when
                // the incoming item is itemEquals to the current one.
                if (item) s.setSelectedItem(item)
                setPaneOpen(true)
                void s.setSidebarTab(DATA_VIEW_TAB)
                toast({
                    title: "Opening File Details",
                    description: "You can find all data associated with the item here",
                    duration: 3000,
                })
            },
            closeDataView() {
                setPaneOpen(false)
            },
            togglePin(sha256, opts) {
                const s = latest.current
                const layoutKey = opts?.layoutKey
                // Shift+click on a gallery-side pin button picks the image up
                // instead of pinning it: a sticky carry that rides the cursor
                // until dropped on the board with a click (see
                // pinboardCarry.ts). Only when a board is mounted to land on —
                // and never for the board-bound unpin buttons, which keep
                // their exact-copy removal.
                if (opts?.shiftKey && layoutKey === undefined
                    && usePinboardCarry.getState().boardMounted) {
                    usePinboardCarry.getState().start(sha256)
                    return
                }
                // This button also renders where the board is unmounted
                // (search grid, gallery image tab): leave a mark so the
                // auto-layout trigger picks the edit up on the board's next
                // mount. A mounted board consumes it in the same pass its
                // count trigger fires, so it never double-layouts.
                markPinboardPendingEdit()
                // A first pin from OUTSIDE the gallery CREATES the board while
                // the user is browsing results: opening the gallery later must
                // show the image they clicked, not the board — so the board
                // starts hidden on the gallery side (ghp), until they switch
                // to it on purpose. Same-tick with the record write below —
                // nuqs merges both into one history entry.
                if (s.records.length === 0 && !s.galleryOpen) {
                    void s.setHidePinBoard(true)
                }
                // Bound to a specific copy: splice out that exact record by
                // its offset
                if (layoutKey !== undefined) {
                    s.updateRecords((prev) => {
                        const offset = parseInt(layoutKey.split("-")[0])
                        const next = [...prev]
                        next.splice(offset, 5)
                        return next
                    })
                    return
                }
                const galleryTrim = s.galleryTrim
                s.updateRecords((prev, grid) => {
                    const pins: [string, number][] = prev
                        .filter((_, i) => i % 5 === 0)
                        .map((id, index) => [id, index])
                    const isPinnedIndex = pins.findIndex(([id]) =>
                        id.slice(0, PIN_SHA_PREFIX_LENGTH) === sha256.slice(0, PIN_SHA_PREFIX_LENGTH))
                    if (isPinnedIndex !== -1) {
                        const index = pins[isPinnedIndex][1]
                        const next = [...prev]
                        next.splice(index * 5, 5)
                        return next
                    }
                    // Default new-pin size is 10x10 in v1 units, scaled to the
                    // board's grid; the pin lands in the first free slot found
                    // scanning starting at the bottom row (see
                    // pinboardPlace.ts), never on top of anything
                    const { sx, sy } = v1ScaleFactors(grid)
                    const w = Math.round(10 * sx)
                    const h = Math.round(10 * sy)
                    const { x, y } = placeNewPin(prev, grid, w, h)
                    return [
                        ...prev,
                        sha256.slice(0, PIN_SHA_PREFIX_LENGTH),
                        x.toString(),
                        y.toString(),
                        w.toString(),
                        newPinHField(h, sha256, galleryTrim),
                    ]
                })
            },
            galleryHref(index: number) {
                return getGalleryOptionsSerializer()(
                    latest.current.searchParams,
                    { gi: index }
                )
            },
        }
    }, [])

    const flags = useMemo<CellFlags>(() => ({
        dbs,
        bookmarkNamespace: namespace,
        alwaysShowBookmark,
        disableBackendOpen: fileOpen.disableBackendOpen,
        relayDetected: fileOpen.relayDetected,
        relayPaired: fileOpen.relayPaired,
        relayPairing: fileOpen.relayPairing,
        relayPairingPending: fileOpen.relayPairingPending,
        actionTarget: fileOpen.actionTarget,
        canCopy: share.primaryVerb === "copy",
        paneOpen,
        dataViewOpen,
        pinnedPrefixes,
    }), [
        dbs,
        namespace,
        alwaysShowBookmark,
        fileOpen.disableBackendOpen,
        fileOpen.relayDetected,
        fileOpen.relayPaired,
        fileOpen.relayPairing,
        fileOpen.relayPairingPending,
        fileOpen.actionTarget,
        share.primaryVerb,
        paneOpen,
        dataViewOpen,
        pinnedPrefixes,
    ])

    return (
        <CellCallbacksContext.Provider value={callbacks}>
            <CellFlagsContext.Provider value={flags}>
                {children}
            </CellFlagsContext.Provider>
        </CellCallbacksContext.Provider>
    )
}
