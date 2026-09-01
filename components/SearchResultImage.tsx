"use client"
import Image from 'next/image'
import { BookmarkBtn, FileActionCluster, FilePathComponent } from "@/components/imageButtons"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn, getFileURL } from "@/lib/utils";
import { ItemMetaLine } from "@/components/ItemMetaLine";
import { PlayableBadge } from "@/components/PlayableBadge";
import { OpenDetailsButton } from "@/components/OpenFileDetails";
import { PinButton } from './gallery/PinButton';
import { blurHashToDataURL, type PlaceholderDataURL } from '@/lib/state/blurHashDataURL';
import { useCellCallbacks, useCellFlags } from '@/lib/state/cellActions';
import { PIN_SHA_PREFIX_LENGTH } from '@/lib/pinboardCrop';
import {
    animatedCellMode,
    isExtremeAspect,
    showsMotionBadge,
    type AnimateMode,
    type AnimatedFloor,
    type ThumbnailTier,
} from '@/lib/thumbnailTier';
import { observeAnimatedCell } from '@/lib/state/animatedPlayback';
import { CELL_HOVER_ROOT_ATTR, useArmedHover } from '@/hooks/useArmedHover';

// The marker the extreme-aspect swap and the hover arming bind their listeners
// to. It is the element that carries `group`, so the JS hover regions and the
// CSS one are the same box by construction — see ExtremeAspectPicture and
// hooks/useArmedHover.ts, which defines it because the filmstrip's cards carry
// it too.
const HOVER_ROOT_ATTR = CELL_HOVER_ROOT_ATTR

/**
 * What next/image's `fill` writes as inline style, spelled as classes for the
 * one picture element that is not a next/image: the loop's `<video>`. It has to
 * occupy the card's picture box exactly as the `<img>` it stands in for does,
 * or the two cell kinds would not be interchangeable on screen.
 */
const FILL_CLASSES = "absolute inset-0 h-full w-full"

/**
 * Which of the two picture elements a card's grid rendition needs. `"loop"`
 * carries both URLs because the loop and its poster are the same request with
 * and without `still=true`, and AnimatedCellPicture's fallback needs the second
 * one in hand the moment the first one fails.
 *
 * COMPUTED ONCE PER CARD (see `source` below) and then dispatched on, so the
 * `animated === "loop"` question is asked in one place rather than once per
 * JSX branch that happens to care.
 */
type CellPictureSource =
    | { kind: "image"; src: string }
    | { kind: "loop"; src: string; poster: string }

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
// card re-executes per frame. Callers must keep object/function props
// referentially stable for the memo to hold — which is why the two layout
// props below are a plain string and a plain number rather than the style
// object each of them stands for.
//
// `animatedFloor` is the one OBJECT prop, and the memo contract depends on the
// host holding its identity: a floor rebuilt per render (an inline literal, or
// a fresh object out of the client-config query) defeats this memo for every
// visible card on every scroll frame — the exact per-frame re-execution it
// exists to stop. See its own prop doc below for where the host reads it.
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
    imageHeightPx,
    animatedFloor,
    animateMode = "always",
    smallCell = false,
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
     * (lib/thumbnailTier.ts). Chosen by the HOST from the cell width it
     * measures — never per card, which would be a measurement and a
     * subscription in every cell — and passed down as a stable string.
     * Omitted means the legacy bare URL (the display rendition).
     */
    tier?: ThumbnailTier
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
    /**
     * Is this cell in the SMALL range (lib/thumbnailTier.ts
     * `SMALL_CELL_THRESHOLD_PX`)? Decides which of a VIDEO's two stored
     * thumbnails the card requests (D9) — measured by the host, like the tier,
     * because a measurement in the card is a measurement in every card.
     */
    smallCell?: boolean
}) {
    const fileUrl = overrideURL ? overrideURL : getFileURL(dbs, "file", "sha256", result.sha256)
    // LATCHED AT MOUNT, and that is the whole of F4's no-flash rule for a tier
    // switch. Changing the size slider (or resizing across a tier threshold)
    // changes this prop for every visible card, and a changed `src` on a
    // mounted <img> drops the bitmap it is painting: the blurhash placeholder
    // would flash back in across the entire viewport for one network round
    // trip. So the new tier applies to NEWLY MOUNTED cells only — which under
    // virtualization is everything the user scrolls to next, and under a
    // column-count change is every cell on screen anyway (the rows are keyed
    // by index and their contents shift, so the cards remount).
    //
    // The residual: a resize that crosses a tier threshold WITHOUT changing
    // the column count leaves the cards on screen serving the old rendition
    // until they are scrolled past. Slightly soft (or slightly heavy) for
    // those cards, never a flash — which is the requirement, and the simpler
    // of the two constructions the plan allows.
    const tierRef = useRef(tier)
    // LATCHED AT MOUNT for the same reason the tier is, and it is the same
    // failure both times: `smallCell` moves the video cell's `src`, so a
    // slider drag across the threshold would drop the bitmap every mounted
    // video card is painting. `animateMode` moves nothing on its own, but a
    // loop card whose mode changed under it would swap an animating `<video>`
    // for a poster (or the reverse) while the user is looking at it — the
    // preference is a decision about what the NEXT cells do, exactly as the
    // tier is. Both apply to newly mounted cells, which under virtualization
    // is everything the user scrolls to next.
    const smallCellRef = useRef(smallCell)
    const animateModeRef = useRef(animateMode)
    // ONE COMPARISON ON ROW DATA (§2's zero-cost-for-normal invariant). It
    // decides which of the picture components is rendered, so the hover
    // swap's state and listeners exist only inside the extreme-aspect one —
    // a normal card mounts no hook, no listener and no second <img>, exactly
    // as before this feature existed.
    const extreme = isExtremeAspect(result.width, result.height)
    // ONE COMPARISON ON ROW DATA, exactly like `extreme` above and under the
    // same rule (§2's zero-cost-for-normal invariant): the fields are already
    // in the search payload, the floor is a prop, and a static card leaves
    // here with `"static"` having mounted nothing. The three modes are
    // documented on `animatedCellMode`; what they buy this card is which of
    // two picture elements it renders and whether its `<img>` has to spell out
    // `still=true` — a grid tier answers an animated item above the floor with
    // `video/mp4`, which an `<img>` would show as a broken picture.
    const animated = animatedCellMode(result, animatedFloor)
    // D9: at small sizes a video's 2×2 frame mosaic is four thumbnails' worth
    // of detail in a box too small to read any of them, so the cell asks for
    // the single frame instead and swaps to the mosaic on an armed hover
    // (VideoStillPicture). NOT applied to an extreme-aspect video, whose card
    // already owns a hover swap of its own — two layers competing for the same
    // gesture is one too many, and a strip-shaped video is rare enough that
    // keeping today's rendition there costs nothing.
    const smallVideo = smallCellRef.current && !extreme
        && !!result.type?.startsWith("video/")
    const thumbnailUrl = getFileURL(dbs, "thumbnail", "sha256", result.sha256, tierRef.current,
        animated === "still", smallVideo ? false : undefined)
    // THE ANSWER TO "what is this card's picture", computed once. Everything
    // below dispatches on `source` rather than re-asking `animated === "loop"`
    // — the extreme branch used to build this same object inline while the
    // normal branch asked the question again, so the two could drift. The
    // poster URL is the same request with `still=true`, and it is built only
    // for a loop card.
    const source: CellPictureSource = animated === "loop"
        ? {
            kind: "loop",
            src: thumbnailUrl,
            poster: getFileURL(dbs, "thumbnail", "sha256", result.sha256, tierRef.current, true),
        }
        : { kind: "image", src: thumbnailUrl }
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
                    className={cn("block relative mb-2",
                        imageHeightPx == null && "h-96 4xl:h-120 5xl:h-152",
                        imageContainerClassName)}
                    style={imageHeightPx == null ? undefined : { height: imageHeightPx }}
                >
                    {/* FOUR OUTCOMES, dispatched on `source` and on the two
                        latched host decisions and nothing else: an
                        extreme-aspect card (whose own component then handles
                        both kinds of crop), a loop, a small video cell, or the
                        still image every other card is. */}
                    {extreme ? (
                        <ExtremeAspectPicture
                            crop={source}
                            displaySrc={getFileURL(dbs, "thumbnail", "sha256", result.sha256, "display")}
                            alt={`Result ${result.path}`}
                            blurDataURL={blurDataURL}
                            imageClassName={imageClassName}
                            disabled={!!showLoadingSpinner}
                            animateMode={animateModeRef.current}
                        />
                    ) : source.kind === "loop" ? (
                        <CellLoopPicture
                            src={source.src}
                            poster={source.poster}
                            alt={`Result ${result.path}`}
                            blurDataURL={blurDataURL}
                            mode={animateModeRef.current}
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
                    ) : smallVideo ? (
                        <VideoStillPicture
                            src={source.src}
                            mosaicSrc={getFileURL(dbs, "thumbnail", "sha256", result.sha256, tierRef.current)}
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
                            src={source.src}
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
                    {showsMotionBadge(result, animatedFloor, animateModeRef.current)
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
                    <FileActionCluster sha256={result.sha256} path={result.path} />
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
    crop: CellPictureSource
    displaySrc: string
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
    }, [disabled, stickyDisplay])
    const showDisplay = hovered && loaded
    // Mounted while it is wanted. For a still that is "ever" (see the sticky
    // note); for an animation it is "while the pointer is here".
    const displayMounted = requested && (stickyDisplay || hovered)
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
 * Styled to be INDISTINGUISHABLE from that `<img>`: the caller hands down the
 * card's own object-fit classes verbatim, and `FILL_CLASSES` reproduces what
 * next/image's `fill` writes as inline style. `object-fit`/`object-position`
 * apply to a replaced element whatever its kind, so the CSS hover-contain and
 * the rounded corners work here untouched.
 *
 * THE POSTER FALLBACK IS THE POINT, not defensive polish. Two states answer a
 * grid-tier request for an animated item above the floor with the item's own
 * IMAGE bytes, and the client cannot tell either apart in advance:
 *
 *   - the backfill has not written the loop yet — transitional, and answered
 *     `no-cache` so it resolves the moment the scan lands;
 *   - no H.264 encode of this source came out smaller than the source, so the
 *     settled keep-the-original edge serves the file itself — PERMANENT, and
 *     answered immutable, so this fallback is the only thing that will ever
 *     render those items.
 *
 * A cell that only ever mounted `<video>` shows an empty box in both. The swap
 * hangs off the element's own `error` event — NO PROBE REQUEST, which would
 * double the request count for the common case to save one wasted fetch in the
 * rare one — and lands on `still=true`, a stored poster for every item above
 * the floor. It is a one-way latch: `failed` never goes back, so a failure
 * cannot loop, and the poster is already in cache because the `<video>` was
 * showing it. With `preload="none"` the failing response is not even fetched
 * until the director first plays this cell, so the swap now happens on the
 * first play of a visible cell rather than at mount — the poster is what the
 * cell was showing until then either way.
 *
 * NOTHING IS FETCHED UNTIL IT IS PLAYED. `preload="none"` and no `autoplay`:
 * the loop's bytes are requested by the director's own `play()`, and the
 * director only plays cells that are at least half on screen and inside the
 * cap. An earlier build carried `autoplay` and let the element decide, which
 * fetched and fully buffered EVERY mounted loop — measured at 16/16 buffered
 * with 14 of them off screen, ~4 MB nobody saw. The poster paints immediately
 * and the blurhash sits behind it, so a cell that has not been played yet is a
 * still picture rather than an empty box.
 *
 * KNOWN, ACCEPTED UX DELTA: right-clicking an animated cell gets the browser's
 * VIDEO context menu (Loop, Show controls, Save video as…) rather than the
 * image one. Inherent to being a real media element; flagged for user QA.
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
}: LoopPictureProps) {
    const [failed, setFailed] = useState(false)
    // Not armed while a hover layer already covers this picture: the pointer
    // is on the card, but what it is looking at is the layer.
    const hover = useArmedHover(!failed && !occluded)
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
 * THE loop element, spelled once for both modes.
 *
 * Styled to be INDISTINGUISHABLE from the `<img>` it stands in for: the caller
 * hands down the card's own object-fit classes verbatim, and `FILL_CLASSES`
 * reproduces what next/image's `fill` writes as inline style.
 * `object-fit`/`object-position` apply to a replaced element whatever its
 * kind, so the CSS hover-contain and the rounded corners work here untouched.
 *
 * NOTHING IS FETCHED UNTIL IT IS PLAYED. `preload="none"` and no `autoplay`:
 * the loop's bytes are requested by the director's own `play()`, and the
 * director only plays cells that are at least half on screen and inside the
 * cap. An earlier build carried `autoplay` and let the element decide, which
 * fetched and fully buffered EVERY mounted loop — measured at 16/16 buffered
 * with 14 of them off screen, ~4 MB nobody saw. The poster paints immediately
 * and the blurhash sits behind it, so a cell that has not been played yet is a
 * still picture rather than an empty box.
 *
 * KNOWN, ACCEPTED UX DELTA: right-clicking an animated cell gets the browser's
 * VIDEO context menu (Loop, Show controls, Save video as…) rather than the
 * image one. Inherent to being a real media element; flagged for user QA.
 */
function LoopVideo({
    src,
    poster,
    alt,
    blurDataURL,
    className,
    elementRef,
    registered,
    fadeIn,
    onFailed,
}: {
    src: string
    poster: string
    alt: string
    blurDataURL: PlaceholderDataURL | undefined
    className?: string
    elementRef?: (element: HTMLElement | null) => void
    /** False while something covers this cell — see LoopPictureProps.occluded. */
    registered: boolean
    /**
     * Start transparent and fade in on the first DECODED frame. For a layer
     * over a poster: without it the element paints its own `poster` attribute
     * first, which is the same picture at a different moment — a visible blink
     * where there should be no transition at all.
     */
    fadeIn?: boolean
    /**
     * The response was not a video. THE POSTER FALLBACK IS THE POINT, not
     * defensive polish: two states answer a grid-tier request for an animated
     * item above the floor with the item's own IMAGE bytes, and the client
     * cannot tell either apart in advance —
     *
     *   - the backfill has not written the loop yet — transitional, and
     *     answered `no-cache` so it resolves the moment the scan lands;
     *   - no H.264 encode of this source came out smaller than the source, so
     *     the settled keep-the-original edge serves the file itself —
     *     PERMANENT, and answered immutable, so the fallback is the only thing
     *     that will ever render those items.
     *
     * A cell that only ever mounted `<video>` shows an empty box in both. The
     * swap hangs off the element's own `error` event — NO PROBE REQUEST, which
     * would double the request count for the common case to save one wasted
     * fetch in the rare one — and every caller latches it one-way, so a failure
     * cannot loop.
     */
    onFailed: () => void
}) {
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const [live, setLive] = useState(false)
    // The concurrency policy in one line: the director owns the observer, the
    // scroll listener, the cap and every play/pause call, and this cell owns
    // nothing but its membership (lib/state/animatedPlayback.ts). Dropped on
    // the occlusion flag, which is what pauses a loop the hover layer has
    // covered — and, in hover mode, when the element unmounts on leave, which
    // is what D7's "pause + unmount" is made of.
    useEffect(() => {
        const video = videoRef.current
        if (!video || !registered) return
        return observeAnimatedCell(video)
    }, [registered])
    return (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
            ref={(element) => {
                videoRef.current = element
                elementRef?.(element)
            }}
            src={src}
            // Shown until the director plays this cell and the first frame
            // decodes, and shown for good if the response turns out not to be a
            // video at all — so the cell paints a correct picture throughout.
            poster={poster}
            // A <video> has no implicit ARIA role, so a screen reader would
            // announce nothing here where the card it replaces announces its
            // `alt`. `role="img"` plus the label is that parity: this element
            // is a picture that happens to move, not a media player (it has no
            // controls, no sound and no timeline the user can reach).
            role="img"
            aria-label={alt}
            // `muted` is intrinsic rather than a setting: a grid of cells that
            // could make noise is not a grid, and it is also what keeps the
            // director's `play()` permissible without a user gesture in every
            // browser.
            muted
            loop
            playsInline
            disablePictureInPicture
            // NOT `autoplay`, and deliberately: see the note on this component.
            // The director decides what plays, and `preload="none"` is what
            // makes that decision cover the network too rather than only the
            // decode.
            preload="none"
            onError={onFailed}
            onPlaying={fadeIn ? () => setLive(true) : undefined}
            style={blurDataURL ? {
                backgroundImage: `url("${blurDataURL}")`,
                backgroundSize: "cover",
                backgroundPosition: "50% 0%",
                backgroundRepeat: "no-repeat",
            } : undefined}
            className={cn(FILL_CLASSES,
                fadeIn && cn("transition-opacity duration-150",
                    live ? "opacity-100" : "opacity-0"),
                className)}
        />
    )
}

/**
 * The picture of a VIDEO card in a SMALL cell (D9): the single frame, with the
 * 2×2 frame mosaic layered over it once the pointer dwells.
 *
 * WHY THE SWAP AT ALL. The mosaic is four frames in one box, and it is what
 * tells a video apart from a still at a glance — at 150px that reading is four
 * thumbnails of about 70px each, which is no reading at all, so the small cell
 * shows one frame it can actually resolve. The mosaic is still the more
 * INFORMATIVE picture, though, so a deliberate look brings it back: the hover
 * is armed by the same rule as a loop's (D6), so sweeping the grid swaps
 * nothing.
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
    const hover = useArmedHover(!disabled)
    const [requested, setRequested] = useState(false)
    const [loaded, setLoaded] = useState(false)
    useEffect(() => {
        if (hover.active) setRequested(true)
    }, [hover.active])
    const showMosaic = hover.active && loaded
    return (
        <>
            <CellStillImage
                elementRef={hover.attach}
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
