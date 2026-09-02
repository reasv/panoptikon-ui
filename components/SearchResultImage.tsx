"use client"
import Image from 'next/image'
import { BookmarkBtn, FileActionCluster, FilePathComponent } from "@/components/imageButtons"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { originalFileURL } from "@/lib/thumbnailURL";
import { ItemMetaLine } from "@/components/ItemMetaLine";
import { PlayableBadge } from "@/components/PlayableBadge";
import { OpenDetailsButton } from "@/components/OpenFileDetails";
import { PinButton } from './gallery/PinButton';
import { blurHashToDataURL, type PlaceholderDataURL } from '@/lib/state/blurHashDataURL';
import { useCellCallbacks, useCellFlags } from '@/lib/state/cellActions';
import { PIN_SHA_PREFIX_LENGTH } from '@/lib/pinboardCrop';
import {
    animatedCellMode,
    showsMotionBadge,
    type AnimateMode,
    type AnimatedFloor,
    type DisplayLoopTrigger,
    type ThumbnailTier,
} from '@/lib/thumbnailTier';
import {
    cellTierForRow,
    extremeCropArmsHover,
    planCellPicture,
    type CellCrop,
} from '@/lib/cellPicture';
import { isSmallCell } from '@/lib/gridCellSize';
import { LoopVideo } from '@/components/LoopVideo';
import { CELL_HOVER_ROOT_ATTR, useArmedHover } from '@/hooks/useArmedHover';

// The marker the extreme-aspect swap and the hover arming bind their listeners
// to. It is the element that carries `group`, so the JS hover regions and the
// CSS one are the same box by construction — see ExtremeAspectPicture and
// hooks/useArmedHover.ts, which defines it because the filmstrip's cards carry
// it too.
const HOVER_ROOT_ATTR = CELL_HOVER_ROOT_ATTR

/**
 * The still `<img>` every non-loop picture on this card is, spelled once.
 *
 * There is nothing clever here — it exists because the plain card, the
 * extreme-aspect crop and the loop's poster fallback were three verbatim
 * copies of the same `<Image fill placeholder unoptimized>`, and the settled
 * law below has to hold for all three.
 *
 * THE BLURHASH PNG DATA URL IS HANDED TO `placeholder` DIRECTLY.
 * `placeholder="blur"` is FORBIDDEN on this card and must not be
 * reintroduced: with it, next/image wraps the PNG in a ~6 KB
 * `data:image/svg+xml` document carrying a feGaussianBlur graph, UNIQUE per
 * item. Blink treats an SVG used as an image as its own isolated Document
 * (own style resolver, own layout tree), so a virtualized grid mints one
 * Document per cell mount — ~12/s at scroll speed, faster than GC reclaims
 * them. Measured (F3 investigation, 180 s stdtest scroll): live Documents
 * 31 -> 901 and bucket p90 8.4 -> 33.6 ms; with the data URL passed straight
 * through (plain `background-image: url(<png>)`, no SVG, no Document)
 * Documents hold at 1 and the curve is flat.
 *
 * The TYPE of `blurDataURL` (`data:image/png;base64,…` template literal) is
 * the real guard: next/image only validates the placeholder string in dev
 * builds — in production an invalid string silently becomes a garbage
 * background. `?? 'empty'` is equivalent to omitting the prop; it is kept as
 * documentation.
 */
function CellStillImage({
    src,
    alt,
    blurDataURL,
    className,
    elementRef,
}: {
    src: string
    alt: string
    /** Omitted (not null) where the layer underneath IS the placeholder. */
    blurDataURL?: PlaceholderDataURL
    className?: string
    elementRef?: (element: HTMLImageElement | null) => void
}) {
    return (
        <Image
            ref={elementRef}
            src={src}
            alt={alt}
            fill
            placeholder={blurDataURL ?? 'empty'}
            className={className}
            unoptimized
        />
    )
}

/**
 * Gate around the card's overlay chrome — the bookmark button (a query
 * observer plus a Radix context-menu root), the file-action cluster (three to
 * four button slots, each optionally wrapped in another context menu when a
 * relay is paired), the details button and the pin button. All of it renders
 * `opacity-0` until the card is hovered, yet it used to MOUNT on every cell
 * the scroll ever created — measured at one-third to one-half of per-mount
 * cost at the smallest cell size (the recorded ~280 mounts/s ceiling,
 * plan §"Lazy-mount cell overlay chrome").
 *
 * So it mounts on demand instead: the card arms the gate on the hover root's
 * first `pointerenter`/`focusin` (see the handlers on that div), and the gate
 * itself only forces the chrome in eagerly where a visibility flag has a
 * control PAINTED without any hover — a bookmarked card under "always show
 * bookmarks", or a pinned card's pin marker. Everything else about the
 * chrome (its own hover fades, focus behaviour, menus) is unchanged — it just
 * comes into existence at the moment it first could be seen.
 *
 * The flag subscription lives HERE, not in the card: the card's memo contract
 * is stable props/context only, and a `useCellFlags` read in the card body
 * would re-render every visible cell on any flag change. This component is a
 * few bytes of decision; re-rendering it on a pin/bookmark-settings change
 * costs nothing.
 *
 * KEYBOARD PARITY is load-bearing: `focusin` (React's bubbling `onFocus`)
 * fires on the root the moment the card's ANCHOR takes focus — one Tab stop
 * before any button slot — so by the time Tab could reach a button, the
 * buttons exist. Verified explicitly (focus the anchor, then count the
 * card's tab stops).
 *
 * ACCEPTED RESIDUAL: on a surface WITHOUT enriched results
 * (`bookmarked == null`), "always show bookmarks" cannot know a card is
 * bookmarked without mounting the query — those surfaces show the bookmark
 * pill on first hover rather than eagerly. The search grid, which is what
 * this gate is for, is enriched.
 */
function CellOverlay({
    active,
    sha256,
    bookmarked,
    children,
}: {
    /** The card's one-way latch: pointer or focus has reached the card. */
    active: boolean
    sha256: string
    /** `result.bookmarked` — the enriched search payload's answer. */
    bookmarked?: boolean | null
    children: React.ReactNode
}) {
    const { alwaysShowBookmark, pinnedPrefixes } = useCellFlags()
    const forced =
        (alwaysShowBookmark && !!bookmarked) ||
        pinnedPrefixes.has(sha256.slice(0, PIN_SHA_PREFIX_LENGTH))
    if (!active && !forced) return null
    return <>{children}</>
}

// Memoized: the virtualized grid re-renders on every scroll frame (tanstack
// virtual mutates state under "use no memo"), and without this each visible
// card re-executes per frame.
//
// THE PROPS / CONTEXT BOUNDARY, spelled once here because both sides of it are
// load-bearing and neither is obvious from a call site:
//
//   - PROPS are the HOST'S ONE ANSWER for every card it renders: its layout in
//     numbers (`cellWidth`, `boxHeightPx`, `dpr`, `imageHeightPx`, or a
//     `tier`), the server's two bounds objects, and the animate mode. They are
//     part of the memo contract, so a host that rebuilds one per render — an
//     inline literal, a fresh object straight out of the client-config query —
//     defeats this memo for every visible card on every scroll frame, which is
//     the exact per-frame re-execution it exists to stop. The layout ones are
//     plain strings and numbers rather than the style objects they stand for
//     precisely so they cannot be rebuilt by accident; `animatedFloor` and
//     `displayLoopTrigger` are the two OBJECT props, and react-query holding
//     their identity across refetches that change nothing is what makes
//     reading them at the host safe.
//   - `CellFlagsContext` (lib/state/cellActions.ts) is for REACTIVE values, and
//     THIS CARD NEVER SUBSCRIBES TO IT. A `useCellFlags` read in the body would
//     re-render every visible cell whenever a pin or a bookmark setting
//     changed. It is read only inside `CellOverlay`, behind the hover gate,
//     where it is a few bytes of decision — see that component's doc.
//
// `dbs` is deliberately a PROP even though every host reads `useSelectedDBs()`
// for itself: the card takes it as data so that it subscribes to nothing and
// stays memo-stable. The double read is the price of that, and it is cheap.
export const SearchResultImage = memo(function SearchResultImage({
    result,
    index,
    dbs,
    imageClassName,
    imageContainerClassName,
    className,
    onImageClick,
    galleryLink,
    overrideURL,
    showLoadingSpinner,
    tier,
    cellWidth,
    boxHeightPx,
    dpr,
    imageHeightPx,
    animatedFloor,
    displayLoopTrigger,
    animateMode = "always",
}: {
    result: SearchResult,
    index: number,
    dbs: { index_db: string | null, user_data_db: string | null }
    imageClassName?: string
    imageContainerClassName?: string
    className?: string
    onImageClick?: (index?: number) => void
    galleryLink?: boolean
    overrideURL?: string
    showLoadingSpinner?: boolean
    /**
     * Which stored rendition this card's picture box needs
     * (lib/thumbnailTier.ts), CHOSEN BY THE HOST for every one of its cards.
     *
     * For a host whose cards all cover the same box and whose width is a
     * nominal constant rather than a measurement — the similarity sidebar's
     * two — that is the whole answer, and it stays theirs. A host that knows
     * its box in numbers hands the numbers instead (`cellWidth` below), which
     * is strictly better because the tier then depends on the ROW as well.
     * Omitted with no numbers either means the legacy bare URL (the display
     * rendition).
     */
    tier?: ThumbnailTier
    /**
     * THE PICTURE BOX, IN NUMBERS — width and height in CSS pixels, plus the
     * device pixel ratio — from a host that measures it (the result grid).
     * Present, they REPLACE `tier`: the card chooses its own rendition from
     * them and its own dimensions, because the binding edge of an
     * `object-cover` box depends on the picture in it (see `coverBindingEdge`,
     * and the latch below for what the card then does with the answer).
     *
     * STILL NOT A MEASUREMENT IN HERE, which is the rule these three exist to
     * keep: they are the host's one layout answer, handed down as stable
     * primitives to hundreds of memoized cards. The card does arithmetic on
     * them, never a subscription.
     *
     * `cellWidth` absent (or 0, the grid's "not measured yet") is what makes
     * this whole branch stand down; `boxHeightPx` absent falls back to the
     * width, and `dpr` absent to 1.
     */
    cellWidth?: number
    /**
     * The picture box's HEIGHT in CSS pixels — whichever policy set it: the
     * breakpoint classes (`AUTO_IMAGE_BOX_HEIGHT_*`) or the explicit mode's
     * inline style. Distinct from `imageHeightPx` below, which is the STYLE
     * DIRECTIVE and exists only in the explicit mode; this one is the FACT,
     * and the auto mode has one too.
     */
    boxHeightPx?: number
    /** The host's device pixel ratio (hooks/useDevicePixelRatio.ts). */
    dpr?: number
    /**
     * The picture box's height in CSS pixels, for the explicit cell-size mode
     * where it derives from the slider's width rather than from a breakpoint
     * (design §9). Omitted keeps the breakpoint classes.
     */
    imageHeightPx?: number
    /**
     * The server's animated raw floor (`/api/client-config`), read ONCE by the
     * host next to the tier choice and passed down as a stable object — never
     * a hook in here, which is the subscription-per-card F1 removed.
     *
     * Omitted or null means "no loops exist", which is what an older Server
     * reports and what holds while the config request is in flight: every card
     * then renders exactly today's `<img>`, so a host that never passes this is
     * a host with no animated cells rather than a broken one.
     */
    animatedFloor?: AnimatedFloor | null
    /**
     * The server's display-loop bounds (`/api/client-config`,
     * lib/thumbnailTier.ts), read ONCE by the host next to the floor above and
     * passed down as a stable object — never a hook in here, on exactly the
     * rule that governs the floor and the tier.
     *
     * Only the EXTREME-ASPECT card reads it, and only to decide whether its
     * hover swap has a `display` rendition to swap TO: past these bounds that
     * request answers `video/mp4`. Omitted or null means "no display loop
     * exists", which is what an older Server reports and what holds while the
     * config is in flight — every card then behaves exactly as it did before
     * this prop existed.
     */
    displayLoopTrigger?: DisplayLoopTrigger | null
    /**
     * Whether a loop cell animates unprompted or only while the pointer dwells
     * on it (D2). Resolved ONCE by the host from the cell width and the user's
     * preference (hooks/useAnimateMode.ts) and handed down as a stable string,
     * on the same rule as the tier above: it is one answer for the whole grid,
     * and a preference subscription per card is what F1 removed.
     *
     * Omitted is `"always"`, which is today's behaviour — so a surface that
     * knows nothing about this feature keeps the cells it always had.
     */
    animateMode?: AnimateMode
}) {
    const fileUrl = overrideURL ? overrideURL : originalFileURL(dbs, result.sha256)
    // THE TIER, LATCHED AT MOUNT, and that is the whole of the no-flash rule
    // for a tier switch. Changing the size slider (or resizing across a tier
    // threshold) changes the answer for every visible card, and a changed `src`
    // on a mounted <img> drops the bitmap it is painting: the blurhash
    // placeholder would flash back in across the entire viewport for one
    // network round trip. So the new tier applies to NEWLY MOUNTED cells only —
    // which under virtualization is everything the user scrolls to next, and
    // under a column-count change is every cell on screen anyway (the rows are
    // keyed by index and their contents shift, so the cards remount).
    //
    // What is latched is this card's own answer for its own row, so two cells
    // side by side may hold different tiers — which is the point — but each
    // still holds the one it was born with.
    //
    // The residual: a resize that crosses a tier threshold WITHOUT changing the
    // column count leaves the cards on screen serving the old rendition until
    // they are scrolled past. Slightly soft (or slightly heavy) for those
    // cards, never a flash — which is the requirement.
    const tierRef = useRef(
        cellTierForRow(result, cellWidth, boxHeightPx, dpr, tier))
    // THE PICTURE, rebuilt every render from the latched tier and the LIVE
    // props (lib/cellPicture.ts). `animateMode` and the cell range are not
    // latched, and the difference is who changes them: the tier moves under a
    // window resize the user is not looking at the grid for, while these move
    // only on a deliberate act on the grid itself (the Always / On hover
    // toggle, the size slider crossing the threshold) whose whole point is that
    // the cells on screen change — a toggle that reached only the cells
    // scrolled to next read as doing nothing until a refresh (user QA,
    // 2026-09-02). The costs a latch would have avoided are one-shot and
    // user-triggered — a loop card swapping its `<video>` for the poster it
    // already carries, a video card fetching the other still — not the
    // viewport-wide blurhash flash a resize-driven tier change would be.
    //
    // ZERO-COST FOR NORMAL (§2) is structural: the plan is arithmetic over
    // fields the row already carries and two stable props, and a static card
    // leaves here with `"still"` having mounted no hook, no listener and no
    // second element — exactly as before any of this existed.
    const plan = planCellPicture(result, dbs, tierRef.current, {
        animatedFloor,
        displayLoopTrigger,
        // The card's own comparison, not a prop: one number against one
        // constant (lib/gridCellSize.ts), on a value it already has. A host
        // that measures its box has already said everything this needs.
        smallCell: isSmallCell(cellWidth),
    })
    // The badge rule's input, and the ONLY thing outside the plan that still
    // needs the three-way mode: `"still"` and `"static"` paint the same element
    // and differ only in what the badge means over them (D8).
    const animated = animatedCellMode(result, animatedFloor)
    // Deliberately NOT a `useSearchParams` of its own. This card used to hold
    // one and rebuild its gallery href behind a `useMemo` keyed on the params
    // object — i.e. it recomputed on EVERY URL write, for every visible card,
    // and the subscription alone re-rendered the card body regardless of the
    // memo. The href now comes from the page's one CellActionsHost through a
    // callbacks object whose identity never changes, so reading it costs this
    // card nothing (lib/state/cellActions.ts).
    const { galleryHref } = useCellCallbacks()
    const imageLink = galleryLink ? galleryHref(index) : fileUrl

    const onClick = useCallback(() => {
        if (onImageClick) {
            onImageClick(index)
        }
    }, [onImageClick, index])
    const blurDataURL = useMemo(() => result.blurhash ? blurHashToDataURL(result.blurhash) : undefined, [result.blurhash])
    // The one refresh for the anchor's href — see the comment on the anchor.
    const refreshHref = galleryLink
        ? (event: React.SyntheticEvent<HTMLAnchorElement>) => {
            event.currentTarget.href = galleryHref(index)
        }
        : undefined
    const handleDragStart = (event: React.DragEvent<HTMLImageElement | HTMLAnchorElement | HTMLDivElement>): void => {
        if (!fileUrl) return;
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/plain', result.sha256);
        event.dataTransfer.setData('text/uri-list', fileUrl);
    }
    // The CellOverlay gate's latch (see its doc): LOCAL state, one-way, armed
    // by the first pointer entry or focus on the hover root below. Local
    // because the card's memo holds only while it renders from stable
    // props/context — a store or flag subscription here would re-render every
    // visible card whenever it changed. Setting an already-true latch is a
    // React no-op, so repeated entries cost nothing.
    const [overlayActive, setOverlayActive] = useState(false)
    const armOverlay = () => setOverlayActive(true)
    return (
        <div className={cn("border rounded p-2", className)}>
            <div className={cn("overflow-hidden relative w-full pb-full mb-2",
                showLoadingSpinner ? "" : "group"
            )}
                // Always present, whether or not this card is extreme: the
                // attribute is static markup and costs a normal card nothing,
                // while making it conditional would put a prop-dependent
                // branch on every render of every card to save four bytes.
                {...{ [HOVER_ROOT_ATTR]: "" }}
                onDragStart={handleDragStart}
                draggable={true}
                // The overlay gate's two arming events. `pointerenter` (not
                // `mouseenter`: React has no bubbling mouseenter, and pointer
                // covers mice and pens alike) precedes every hover fade the
                // chrome paints; `focusin` (React's `onFocus` on a non-input
                // IS focusin — it bubbles) fires when the card's anchor takes
                // focus, one Tab stop before any button slot exists to need.
                onPointerEnter={armOverlay}
                onFocus={armOverlay}
            >
                <a
                    href={imageLink}
                    target="_blank"
                    // COMPUTED ONCE, refreshed only by the handlers below.
                    // `galleryHref` has a fixed identity and `index` is stable
                    // for a mounted card, so the value rendered here never
                    // recomputes on its own — the card deliberately does not
                    // re-render on a URL write (that is the whole point), and
                    // there is NO fallback recompute behind these handlers.
                    // Between them they cover every gesture that can consume an
                    // href: mouseenter (hover, which precedes middle click,
                    // "open in new tab", copy link address and drag), mousedown
                    // (a middle click after a wheel scroll that crossed no
                    // hover boundary — mousedown precedes the default action),
                    // contextmenu (including the keyboard menu key, which fires
                    // no mouse event) and focus (keyboard navigation). The
                    // plain left click never reads the href at all
                    // (preventDefault + onImageClick).
                    //
                    // ACCEPTED RESIDUAL: writing `currentTarget.href` is an
                    // imperative DOM write React does not know about, so a
                    // later render whose RENDERED href is unchanged may skip
                    // the attribute write and leave our value standing. Not
                    // reachable in practice — every navigation path is preceded
                    // by one of these handlers, each of which writes the
                    // current value.
                    onMouseEnter={refreshHref}
                    onMouseDown={refreshHref}
                    onContextMenu={refreshHref}
                    onFocus={refreshHref}
                    onClick={(e) => {
                        e.preventDefault()
                        onClick()
                    }}
                    // onDragStart={handleDragStart}
                    rel="noopener noreferrer"
                    // The breakpoint heights stand down when the host has
                    // measured a height for us (explicit cell size): the two
                    // are alternative policies for the same box, and leaving
                    // the classes in would have twMerge resolve a conflict
                    // that the inline style wins anyway.
                    //
                    // THESE THREE CLASSES ARE 384 / 480 / 608 CSS PX, and the
                    // grid reasons about those numbers: they are the auto
                    // layout's row height and, because the box is NOT square,
                    // usually the edge that binds its rendition tier. Named
                    // once as AUTO_IMAGE_BOX_HEIGHT_* in lib/gridCellSize.ts —
                    // Tailwind needs the literal here, so changing one means
                    // changing both.
                    className={cn("block relative mb-2",
                        imageHeightPx == null && "h-96 4xl:h-120 5xl:h-152",
                        imageContainerClassName)}
                    style={imageHeightPx == null ? undefined : { height: imageHeightPx }}
                >
                    {/* FOUR OUTCOMES, one per plan kind (lib/cellPicture.ts)
                        and nothing else: an extreme-aspect card (whose own
                        component then handles both kinds of crop), a loop, a
                        small video cell, or the still image every other card
                        is. The switch is exhaustive by type, so a fifth kind
                        cannot be added to the plan and forgotten here. */}
                    {plan.kind === "extreme" ? (
                        <ExtremeAspectPicture
                            crop={plan.crop}
                            displaySrc={plan.displaySrc}
                            alt={`Result ${result.path}`}
                            blurDataURL={blurDataURL}
                            imageClassName={imageClassName}
                            disabled={!!showLoadingSpinner}
                            animateMode={animateMode}
                        />
                    ) : plan.kind === "loop" ? (
                        <CellLoopPicture
                            src={plan.src}
                            poster={plan.poster}
                            alt={`Result ${result.path}`}
                            blurDataURL={blurDataURL}
                            mode={animateMode}
                            // The still card's classes, verbatim, so a loop
                            // cell is indistinguishable from the picture it
                            // replaces — including the CSS-only hover contain,
                            // which works on a <video> exactly as it does on an
                            // <img> (`object-fit` is not element-specific).
                            className={cn(
                                "object-cover object-top",
                                showLoadingSpinner ? "" : "group-hover:object-contain group-hover:object-center",
                                imageClassName)}
                        />
                    ) : plan.kind === "videoSmall" ? (
                        <VideoStillPicture
                            src={plan.frame}
                            mosaicSrc={plan.mosaic}
                            alt={`Result ${result.path}`}
                            blurDataURL={blurDataURL}
                            disabled={!!showLoadingSpinner}
                            className={cn(
                                "object-cover object-top",
                                showLoadingSpinner ? "" : "group-hover:object-contain group-hover:object-center",
                                imageClassName)}
                        />
                    ) : (
                        <CellStillImage
                            src={plan.src}
                            alt={`Result ${result.path}`}
                            blurDataURL={blurDataURL}
                            className={cn(
                                "object-cover object-top",
                                showLoadingSpinner ? "" : "group-hover:object-contain group-hover:object-center",
                                imageClassName)}
                        />
                    )}
                    {/* INSIDE the anchor, not beside it: the anchor is
                        exactly the picture box (`block relative h-96`, with
                        the Image filling it), while the wrapper around it is
                        taller by the anchor's own `mb-2` — centring on the
                        wrapper would sit the badge a few pixels low. (The
                        wrapper's `pb-full` is a dead class and generates no
                        CSS, so it is not squaring anything off either.)
                        Harmless inside the link because the badge takes no
                        pointer events, so the click and the drag still belong
                        to the anchor. */}
                    {showsMotionBadge(result, animated, animateMode)
                        && <PlayableBadge />}
                </a>
                {showLoadingSpinner && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white bg-opacity-50">
                        <Image
                            src="/spinner.svg"
                            alt="Loading..."
                            width={110}
                            height={110}
                        />
                    </div>
                )}
                <CellOverlay active={overlayActive} sha256={result.sha256} bookmarked={result.bookmarked}>
                    <BookmarkBtn sha256={result.sha256} bookmarked={result.bookmarked} />
                    <FileActionCluster sha256={result.sha256} path={result.path} anchor="bottom-right" />
                    <OpenDetailsButton item={result} variantButton />
                    <PinButton sha256={result.sha256} />
                </CellOverlay>
            </div>
            <FilePathComponent path={result.path} />
            <ItemMetaLine item={result} className="text-gray-500" />
        </div>
    )
})

/**
 * The picture of a card whose item is a comic strip or a webtoon — aspect
 * greater than 2, so its grid rendition is a CROP (§2) and the CSS hover's
 * `object-contain` cannot be shown from it: contain over a top-strip crop
 * displays the strip's first 2×tier pixels shrunk, not the whole picture the
 * hover is for. This component's job is the swap to the `display` rendition,
 * and its existence is what keeps the normal card free of it.
 *
 * MOUNTED ONLY FOR EXTREME CARDS. Everything below — the hover state, the
 * listeners, the second <img> — is inside this component precisely so that a
 * normal-aspect card, which renders a plain <Image> instead, keeps today's
 * CSS-only hover with zero listeners and zero state. That is the invariant
 * verifier rounds check (§2), and it is structural here rather than a promise.
 *
 * NO FLASH, by layering rather than by swapping a `src`: the crop keeps
 * painting until the display rendition has fired its own `load`, and only then
 * does the crop fade out from under it. A hover that is released before the
 * larger image arrives simply never shows it. The display layer stays mounted
 * after the first hover so a second one is instant and costs no second
 * request.
 *
 * The crop deliberately keeps `object-cover object-top` in ALL states —
 * the contain view is the display layer's job, and letting the crop flip to
 * contain under a slow load is exactly the wrong picture shown at the moment
 * the user asked for the right one.
 */
function ExtremeAspectPicture({
    crop,
    displaySrc,
    alt,
    blurDataURL,
    imageClassName,
    disabled,
    animateMode,
}: {
    /**
     * The stored grid rendition — a still crop, or the CROPPED LOOP when the
     * item is animated and above the raw floor. The crop rule is the same
     * geometry for both (§2 applies it in the encode), so the only thing that
     * changes here is which element paints it; the swap above it is identical.
     */
    crop: CellCrop
    /**
     * The whole-image rendition the hover swaps to, or NULL when there is no
     * picture at that URL to swap to — an animated item past the server's
     * display-loop bounds, whose `display` request answers `video/mp4`. Null
     * mounts no layer, binds no listeners and requests nothing: see the call
     * site, which is where the reason lives.
     */
    displaySrc: string | null
    alt: string
    blurDataURL: PlaceholderDataURL | undefined
    imageClassName?: string
    /** The loading-spinner state, where the card shows no hover at all. */
    disabled: boolean
    /** Passed through to the crop when it is a loop — see CellLoopPicture. */
    animateMode: AnimateMode
}) {
    // A CALLBACK ref rather than a typed object ref, because the crop layer is
    // an <img> for a still item and a <video> for an animated one and this only
    // ever needs "some element of ours, to find the hover root from". Stable
    // identity, so switching between the two (or the loop's own fallback to its
    // poster) never re-runs the listener effect below.
    const cropRef = useRef<HTMLElement | null>(null)
    const attachCrop = useCallback((element: HTMLElement | null) => {
        cropRef.current = element
    }, [])
    const [hovered, setHovered] = useState(false)
    // Sticky: once a hover has asked for the display rendition, the element
    // stays mounted. Unmounting it would make every re-hover a fresh <img>
    // (and, on a cold cache, a fresh decode with the crop showing through
    // again), and it is what makes "one hover, one request" true for the
    // network-log assertion.
    //
    // STICKY ONLY FOR A STILL CROP. What the layer holds for an animated item
    // is the ORIGINAL ANIMATED FILE, and a left-mounted one goes on decoding
    // and compositing every frame at opacity 0 for as long as the card lives —
    // a permanent cost per hovered cell, in the one place the whole feature is
    // about not paying for pictures nobody is looking at. A still's layer is
    // one decode sitting there, which is what the stickiness was weighed
    // against; an animation's is not the same trade. Re-hover stays cheap
    // because the file is in the browser cache by then.
    const stickyDisplay = crop.kind === "image"
    const [requested, setRequested] = useState(false)
    const [loaded, setLoaded] = useState(false)
    useEffect(() => {
        if (disabled) return
        // Nothing to swap to (see `displaySrc`), so there is no gesture to
        // listen for. Bailing here is what makes "no display layer" cost the
        // card two listeners and two state writes less than nothing, rather
        // than arming a swap that would then render null.
        if (!displaySrc) return
        // Bound to the card's `group` element, found from our own node, so
        // the swap's hover region is the SAME box as the CSS hover's. Binding
        // to this <img> instead would leave the swap out of step with the
        // stylesheet wherever the pointer is over the card but not over the
        // picture — the corner action buttons, which sit on top of it.
        //
        // mouseenter/mouseleave (which do not bubble, hence the listener on
        // the element itself) rather than pointerenter/leave: they are what
        // `:hover` follows, including the case of the pointer leaving through
        // a child that was removed under it.
        const root = cropRef.current?.closest(`[${HOVER_ROOT_ATTR}]`)
        if (!root) return
        const enter = () => {
            setHovered(true)
            setRequested(true)
        }
        const leave = () => {
            setHovered(false)
            // The non-sticky layer is about to unmount, so the next hover gets
            // a fresh element that has not fired its own `load` yet. Leaving
            // `loaded` set would make that next hover show an empty layer over
            // a crop already faded to nothing — the exact flash the load gate
            // exists to prevent.
            if (!stickyDisplay) setLoaded(false)
        }
        root.addEventListener("mouseenter", enter)
        root.addEventListener("mouseleave", leave)
        return () => {
            root.removeEventListener("mouseenter", enter)
            root.removeEventListener("mouseleave", leave)
        }
    }, [disabled, stickyDisplay, displaySrc])
    const showDisplay = hovered && loaded
    // Mounted while it is wanted. For a still that is "ever" (see the sticky
    // note); for an animation it is "while the pointer is here"; never at all
    // when there is no whole-image rendition to show.
    const displayMounted = displaySrc !== null && requested && (stickyDisplay || hovered)
    const cropClassName = cn(
        "object-cover object-top",
        // The fade OUT is a considered transition — the crop keeps painting
        // until the display rendition has loaded, then dissolves under it. The
        // way BACK is instant for an animation, because its display layer
        // unmounts in the same commit: a 150ms fade-in from an already-empty
        // box is a flash, not a transition. A still's layer stays mounted, so
        // its return can stay symmetrical exactly as it was.
        (stickyDisplay || showDisplay) && "transition-opacity duration-150",
        showDisplay ? "opacity-0" : "opacity-100",
        imageClassName)
    return (
        <>
            {crop.kind === "loop" ? (
                <CellLoopPicture
                    src={crop.src}
                    poster={crop.poster}
                    alt={alt}
                    blurDataURL={blurDataURL}
                    mode={animateMode}
                    className={cropClassName}
                    elementRef={attachCrop}
                    // Fully covered by the display layer, so its frames are
                    // being decoded and composited for nobody. The director
                    // takes it out of the playing set for as long as that
                    // holds, and gives its cap slot to a cell on screen.
                    occluded={showDisplay}
                    // ARMED EXACTLY WHEN NO SWAP OWNS THE HOVER. The rule
                    // itself is `extremeCropArmsHover` (lib/cellPicture.ts),
                    // named there because it is the plan's question and a pure
                    // one — scripts/hoveranimate.test.mjs pins it.
                    //
                    // WITH A SWAP (`displaySrc` non-null) THE HOVER IS ALREADY
                    // SPOKEN FOR: this card's own gesture swaps to the
                    // `display` rendition, which is the ORIGINAL FILE and
                    // animates natively in its <img>. Arming as well meant a
                    // cell that fetched a loop, mounted it, and then unmounted
                    // it again the moment the swap landed — a request and a
                    // decode session spent on a picture that was replaced by an
                    // animating one.
                    //
                    // WITH NO SWAP — an animated strip past the display-loop
                    // bounds, whose `displaySrc` is null (see the call site) —
                    // nothing else wants the gesture, so the crop loop ARMS and
                    // hover-plays through the same director, the same dwell and
                    // the same cap as every other loop cell. It is the only
                    // motion path such a card has: un-armed, the pointer did
                    // nothing whatever to a cell the grid had just badged as
                    // playable, while every ordinary animated cell beside it
                    // played. The swap's own mouseenter/mouseleave pair above
                    // bails on a null `displaySrc`, so the hover root belongs
                    // to the arming alone and no second listener competes for
                    // it.
                    //
                    // The badge rule is untouched (D8): the crop paints a
                    // static poster until something plays it — under a swap or
                    // under an arm alike — so it still says so, and an armed
                    // crop loop is just a hover-mode loop cell, which is the
                    // case the predicate already answers. ALWAYS mode is
                    // unaffected either way: the crop loop is the picture there
                    // and plays under the director like every other loop cell.
                    armable={extremeCropArmsHover(crop, displaySrc)}
                />
            ) : (
                <CellStillImage
                    elementRef={attachCrop}
                    src={crop.src}
                    alt={alt}
                    blurDataURL={blurDataURL}
                    className={cropClassName}
                />
            )}
            {displayMounted && (
                <Image
                    src={displaySrc}
                    alt={alt}
                    fill
                    // NO placeholder: the crop underneath is the placeholder,
                    // and a blurhash background behind a transparent layer
                    // would be the flash this whole construction avoids.
                    className={cn(
                        "object-contain object-center transition-opacity duration-150",
                        showDisplay ? "opacity-100" : "opacity-0",
                        imageClassName)}
                    // The layer must never eat the anchor's clicks or the
                    // card's drag — it exists to be looked at.
                    style={{ pointerEvents: "none" }}
                    onLoad={() => setLoaded(true)}
                    unoptimized
                />
            )}
        </>
    )
}

/**
 * The picture of a card whose item MOVES and is above the raw floor, so its
 * grid rendition is an H.264 loop (§2) that only a `<video>` can show.
 *
 * MOUNTED ONLY FOR ANIMATED CARDS, on the same rule as ExtremeAspectPicture and
 * for the same reason: the playback registration, the fallback state and the
 * media element live in here, so a static card renders the plain `<Image>` it
 * always did and mounts none of it.
 *
 * WHAT THIS ADDS TO `LoopVideo`, which is everything else about the element
 * (why it never autoplays, why the poster fallback exists, what the browser's
 * video context menu does to a right-click) — read that component's doc for
 * all of it, and do not copy it back here:
 *
 *   - the ONE-WAY `failed` latch. LoopVideo reports that the response was not
 *     a video; deciding to stop asking is the card's, because the card is what
 *     survives the swap. `failed` never goes back, so a failure cannot loop,
 *     and the poster it lands on is already in cache — the `<video>` was
 *     showing it;
 *   - the `occluded` translation: a cell the extreme-aspect layer covers
 *     deregisters rather than pausing, so the director gives its cap slot away;
 *   - the blurhash, by the same direct-data-URL mechanism next/image's
 *     `placeholder` uses on every other picture in this card.
 */
function AnimatedCellPicture({
    src,
    poster,
    alt,
    blurDataURL,
    className,
    elementRef,
    occluded,
}: LoopPictureProps) {
    const [failed, setFailed] = useState(false)
    if (failed) {
        return (
            <CellStillImage
                elementRef={elementRef}
                src={poster}
                alt={alt}
                blurDataURL={blurDataURL}
                className={className}
            />
        )
    }
    return (
        <LoopVideo
            src={src}
            poster={poster}
            alt={alt}
            // The blurhash, by the same direct-data-URL mechanism next/image's
            // `placeholder` uses on every other picture in this card — so a
            // loop cell has the same something-shaped-like-the-picture behind
            // it as its neighbours in the moment before the poster paints.
            // Never an SVG wrapper: see the settled law on CellStillImage.
            blurDataURL={blurDataURL}
            className={className}
            elementRef={elementRef}
            registered={!occluded}
            onFailed={() => setFailed(true)}
        />
    )
}

/**
 * The same card, in HOVER mode (D2/D7): a static poster that mounts the loop
 * only once the pointer has DWELT on the card, and drops it again when the
 * pointer leaves.
 *
 * WHY A SEPARATE COMPONENT rather than a branch inside the one above. The two
 * modes want opposite things from the same element — always mode's `<video>`
 * IS the picture and must exist for the director to schedule, while hover
 * mode's is a layer over a picture that is already correct without it — and
 * the poster `<img>` underneath is what makes the whole thing free: leaving
 * and re-entering paints nothing new, because the layer that went away was
 * never the thing being looked at. Keeping them apart also means always mode
 * is exactly the code it was before this feature existed.
 *
 * NO FLASH IN EITHER DIRECTION, by layering rather than by swapping a `src` —
 * the same construction ExtremeAspectPicture uses, for the same reason. The
 * loop fades in on its own `playing` event (the first decoded frame, not the
 * first byte) and simply unmounts on leave, which is instant and lands on the
 * poster that never stopped painting. Re-hovering is cheap because the loop's
 * URL is immutable and in the browser cache by then.
 *
 * The `error` latch is the one above's, unchanged in meaning: a response that
 * is not a video (backfill pending, or the settled keep-the-original edge)
 * stops this cell arming again for the rest of its life, and the poster it
 * was already showing is the correct picture.
 */
function HoverLoopPicture({
    src,
    poster,
    alt,
    blurDataURL,
    className,
    elementRef,
    occluded,
    armable = true,
}: LoopPictureProps) {
    const [failed, setFailed] = useState(false)
    // Not armed while a hover layer already covers this picture (the pointer
    // is on the card, but what it is looking at is the layer), and never at
    // all on a card whose hover belongs to a swap of its own — see `armable`.
    const hover = useArmedHover(armable && !failed && !occluded)
    const attach = useCallback((element: HTMLElement | null) => {
        hover.attach(element)
        elementRef?.(element)
    }, [hover.attach, elementRef])
    return (
        <>
            <CellStillImage
                elementRef={attach}
                src={poster}
                alt={alt}
                blurDataURL={blurDataURL}
                className={className}
            />
            {hover.active && (
                <LoopVideo
                    src={src}
                    poster={poster}
                    alt={alt}
                    // NO blurhash background: the poster underneath is the
                    // placeholder, and a blur behind a layer fading in over a
                    // painted picture is the flash this construction avoids.
                    blurDataURL={undefined}
                    className={className}
                    fadeIn
                    registered
                    onFailed={() => setFailed(true)}
                />
            )}
        </>
    )
}

/** What both loop pictures are handed; see AnimatedCellPicture. */
interface LoopPictureProps {
    /** The grid tier URL — `video/mp4` when a loop exists for this item. */
    src: string
    /** The same tier with `still=true`: the loop's poster, and the fallback. */
    poster: string
    alt: string
    blurDataURL: PlaceholderDataURL | undefined
    /** The card's object-fit/opacity classes, applied to whichever paints. */
    className?: string
    /** The extreme-aspect swap's anchor, when this loop is inside one. */
    elementRef?: (element: HTMLElement | null) => void
    /**
     * Something is painting over this cell completely — today the
     * extreme-aspect hover layer. Deregisters rather than pausing through a
     * second code path: an unregistered element is paused by the director on
     * the way out and stops competing for the cap, which is the whole of what
     * "occluded" should mean.
     */
    occluded?: boolean
    /**
     * May this cell arm a hover play at all? False on an extreme-aspect card
     * whose hover already means something else — the swap to the whole-image
     * rendition; see `extremeCropArmsHover` and the site there. Distinct from
     * `occluded`, which is about a moment; this is about the card.
     */
    armable?: boolean
}

/**
 * WHICH of the two loop pictures this card gets. One dispatch, so the question
 * "is this cell in hover mode" is asked in one place rather than at each of the
 * two sites that render a loop (the plain card and the extreme-aspect crop).
 */
function CellLoopPicture({ mode, ...props }: LoopPictureProps & { mode: AnimateMode }) {
    return mode === "hover"
        ? <HoverLoopPicture {...props} />
        : <AnimatedCellPicture {...props} />
}

/**
 * The picture of a VIDEO card in a SMALL cell (D9): the single frame, with the
 * 2×2 frame mosaic layered over it while the card is hovered.
 *
 * WHY THE SWAP AT ALL. The mosaic is four frames in one box, and it is what
 * tells a video apart from a still at a glance — at 150px that reading is four
 * thumbnails of about 70px each, which is no reading at all, so the small cell
 * shows one frame it can actually resolve. The mosaic is still the more
 * INFORMATIVE picture, though, so hovering brings it back.
 *
 * ON PLAIN HOVER, NOT THE ARMED ONE. The card already changes on `:hover` —
 * the picture goes from cover to contain — and the mosaic has to be part of
 * that same moment. Behind the loop's arming rule and dwell it arrived as a
 * second event after the zoom-out, which read as the card changing its mind
 * (user QA, 2026-09-02). So this follows `:hover` exactly, bound the way the
 * extreme-aspect swap is: mouseenter/mouseleave on the card's group root. A
 * stationary pointer under a scrolling grid does swap these, and that is
 * fine — a still image swapping for another still image is one request and
 * one decode, nothing like a loop starting.
 *
 * LATCH-UNTIL-LOADED and STICKY, both copied from ExtremeAspectPicture and for
 * its reasons: the single frame keeps painting until the mosaic has fired its
 * own `load`, so a slow response shows the picture the cell already had rather
 * than an empty box; and the mosaic stays mounted afterwards, so a second look
 * is instant and costs no second request. Both layers are still images, which
 * is what makes the stickiness free here (unlike an animation's — see the note
 * on the extreme-aspect layer).
 */
function VideoStillPicture({
    src,
    mosaicSrc,
    alt,
    blurDataURL,
    className,
    disabled,
}: {
    /** The single frame — `big=false` at this cell's tier. */
    src: string
    /** The 2×2 mosaic: the same tier with the parameter left off. */
    mosaicSrc: string
    alt: string
    blurDataURL: PlaceholderDataURL | undefined
    className?: string
    /** The loading-spinner state, where the card shows no hover at all. */
    disabled: boolean
}) {
    const frameRef = useRef<HTMLElement | null>(null)
    const attachFrame = useCallback((element: HTMLElement | null) => {
        frameRef.current = element
    }, [])
    const [hovered, setHovered] = useState(false)
    const [requested, setRequested] = useState(false)
    const [loaded, setLoaded] = useState(false)
    useEffect(() => {
        if (disabled) return
        // The group root, not this <img>: the corner buttons sit over the
        // picture, and the swap must track the stylesheet's hover region (see
        // ExtremeAspectPicture for the full reasoning, and why mouseenter).
        const root = frameRef.current?.closest(`[${HOVER_ROOT_ATTR}]`)
        if (!root) return
        const enter = () => {
            setHovered(true)
            setRequested(true)
        }
        const leave = () => setHovered(false)
        root.addEventListener("mouseenter", enter)
        root.addEventListener("mouseleave", leave)
        return () => {
            root.removeEventListener("mouseenter", enter)
            root.removeEventListener("mouseleave", leave)
        }
    }, [disabled])
    const showMosaic = hovered && loaded
    return (
        <>
            <CellStillImage
                elementRef={attachFrame}
                src={src}
                alt={alt}
                blurDataURL={blurDataURL}
                className={cn(
                    (requested || showMosaic) && "transition-opacity duration-150",
                    showMosaic ? "opacity-0" : "opacity-100",
                    className)}
            />
            {requested && (
                <Image
                    src={mosaicSrc}
                    alt={alt}
                    fill
                    // NO placeholder: the single frame underneath is it.
                    className={cn("transition-opacity duration-150",
                        showMosaic ? "opacity-100" : "opacity-0",
                        className)}
                    // The layer must never eat the anchor's clicks or the
                    // card's drag — it exists to be looked at.
                    style={{ pointerEvents: "none" }}
                    onLoad={() => setLoaded(true)}
                    unoptimized
                />
            )}
        </>
    )
}
