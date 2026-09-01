"use client"
import Image from 'next/image'
import { BookmarkBtn, FileActionCluster, FilePathComponent } from "@/components/imageButtons"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn, getFileURL } from "@/lib/utils";
import { ItemMetaLine } from "@/components/ItemMetaLine";
import { PlayableBadge, isPlayableItem } from "@/components/PlayableBadge";
import { OpenDetailsButton } from "@/components/OpenFileDetails";
import { PinButton } from './gallery/PinButton';
import { blurHashToDataURL, type PlaceholderDataURL } from '@/lib/state/blurHashDataURL';
import { useCellCallbacks } from '@/lib/state/cellActions';
import {
    animatedCellMode,
    isExtremeAspect,
    type AnimatedFloor,
    type ThumbnailTier,
} from '@/lib/thumbnailTier';
import { observeAnimatedCell } from '@/lib/state/animatedPlayback';

// The marker the extreme-aspect swap binds its hover listeners to. It is the
// element that carries `group`, so the JS hover region and the CSS one are the
// same box by construction — see ExtremeAspectPicture.
const HOVER_ROOT_ATTR = "data-cell-hover-root"

/**
 * What next/image's `fill` writes as inline style, spelled as classes for the
 * one picture element that is not a next/image: the loop's `<video>`. It has to
 * occupy the card's picture box exactly as the `<img>` it stands in for does,
 * or the two cell kinds would not be interchangeable on screen.
 */
const FILL_CLASSES = "absolute inset-0 h-full w-full"

// Memoized: the virtualized grid re-renders on every scroll frame (tanstack
// virtual mutates state under "use no memo"), and without this each visible
// card re-executes per frame. Callers must keep object/function props
// referentially stable for the memo to hold — which is why the two layout
// props below are a plain string and a plain number rather than the style
// object each of them stands for.
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
    // ONE COMPARISON ON ROW DATA, exactly like `extreme` below and under the
    // same rule (§2's zero-cost-for-normal invariant): the fields are already
    // in the search payload, the floor is a prop, and a static card leaves
    // here with `"static"` having mounted nothing. The three modes are
    // documented on `animatedCellMode`; what they buy this card is which of
    // two picture elements it renders and whether its `<img>` has to spell out
    // `still=true` — a grid tier answers an animated item above the floor with
    // `video/mp4`, which an `<img>` would show as a broken picture.
    const animated = animatedCellMode(result, animatedFloor)
    const thumbnailUrl = getFileURL(dbs, "thumbnail", "sha256", result.sha256, tierRef.current,
        animated === "still")
    // Only built for a loop card; for every other card these are the same
    // string as above and nothing reads them.
    const loopPosterUrl = animated === "loop"
        ? getFileURL(dbs, "thumbnail", "sha256", result.sha256, tierRef.current, true)
        : thumbnailUrl
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
    // ONE COMPARISON ON ROW DATA (§2's zero-cost-for-normal invariant). It
    // decides which of two picture components is rendered, so the hover
    // swap's state and listeners exist only inside the extreme-aspect one —
    // a normal card mounts no hook, no listener and no second <img>, exactly
    // as before this feature existed.
    const extreme = isExtremeAspect(result.width, result.height)
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
                    {extreme ? (
                        <ExtremeAspectPicture
                            crop={animated === "loop"
                                ? { kind: "loop", src: thumbnailUrl, poster: loopPosterUrl }
                                : { kind: "image", src: thumbnailUrl }}
                            displaySrc={getFileURL(dbs, "thumbnail", "sha256", result.sha256, "display")}
                            alt={`Result ${result.path}`}
                            blurDataURL={blurDataURL}
                            imageClassName={imageClassName}
                            disabled={!!showLoadingSpinner}
                        />
                    ) : animated === "loop" ? (
                        <AnimatedCellPicture
                            src={thumbnailUrl}
                            poster={loopPosterUrl}
                            alt={`Result ${result.path}`}
                            blurDataURL={blurDataURL}
                            // The static card's classes, verbatim, so a loop
                            // cell is indistinguishable from the picture it
                            // replaces — including the CSS-only hover contain,
                            // which works on a <video> exactly as it does on an
                            // <img> (`object-fit` is not element-specific).
                            className={cn(
                                "object-cover object-top",
                                showLoadingSpinner ? "" : "group-hover:object-contain group-hover:object-center",
                                imageClassName)}
                        />
                    ) : (
                        <Image
                            src={thumbnailUrl}
                            alt={`Result ${result.path}`}
                            fill
                            // The blurhash PNG data URL is handed to `placeholder`
                            // DIRECTLY. `placeholder="blur"` is FORBIDDEN on this
                            // card and must not be reintroduced: with it, next/image
                            // wraps the PNG in a ~6 KB `data:image/svg+xml` document
                            // carrying a feGaussianBlur graph, UNIQUE per item.
                            // Blink treats an SVG used as an image as its own
                            // isolated Document (own style resolver, own layout
                            // tree), so a virtualized grid mints one Document per
                            // cell mount — ~12/s at scroll speed, faster than GC
                            // reclaims them. Measured (F3 investigation, 180 s
                            // stdtest scroll): live Documents 31 -> 901 and bucket
                            // p90 8.4 -> 33.6 ms; with the data URL passed straight
                            // through (plain `background-image: url(<png>)`, no SVG,
                            // no Document) Documents hold at 1 and the curve is flat.
                            // The type of `blurDataURL` (`data:image/png;base64,…`
                            // template literal) is the real guard here: next/image
                            // only validates the placeholder string in dev builds —
                            // in production an invalid string silently becomes a
                            // garbage background. `?? 'empty'` is equivalent to
                            // omitting the prop; it is kept as documentation.
                            placeholder={blurDataURL ?? 'empty'}
                            // draggable={true}
                            className={cn(
                                "object-cover object-top",
                                showLoadingSpinner ? "" : "group-hover:object-contain group-hover:object-center",
                                imageClassName)}
                            unoptimized
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
                    {isPlayableItem(result) && <PlayableBadge />}
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
                <BookmarkBtn sha256={result.sha256} bookmarked={result.bookmarked} />
                <FileActionCluster sha256={result.sha256} path={result.path} />
                <OpenDetailsButton item={result} variantButton />
                <PinButton sha256={result.sha256} />
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
        const leave = () => setHovered(false)
        root.addEventListener("mouseenter", enter)
        root.addEventListener("mouseleave", leave)
        return () => {
            root.removeEventListener("mouseenter", enter)
            root.removeEventListener("mouseleave", leave)
        }
    }, [disabled])
    const showDisplay = hovered && loaded
    const cropClassName = cn(
        "object-cover object-top transition-opacity duration-150",
        showDisplay ? "opacity-0" : "opacity-100",
        imageClassName)
    return (
        <>
            {crop.kind === "loop" ? (
                <AnimatedCellPicture
                    src={crop.src}
                    poster={crop.poster}
                    alt={alt}
                    blurDataURL={blurDataURL}
                    className={cropClassName}
                    elementRef={attachCrop}
                />
            ) : (
                <Image
                    ref={attachCrop}
                    src={crop.src}
                    alt={alt}
                    fill
                    // Same rule as the plain card's: the blurhash PNG goes to
                    // `placeholder` directly, never `placeholder="blur"`.
                    placeholder={blurDataURL ?? 'empty'}
                    className={cropClassName}
                    unoptimized
                />
            )}
            {requested && (
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
 * Which of the two picture elements a card's grid rendition needs. `"loop"`
 * carries both URLs because the loop and its poster are the same request with
 * and without `still=true`, and the fallback below needs the second one in hand
 * the moment the first one fails.
 */
type CellPictureSource =
    | { kind: "image"; src: string }
    | { kind: "loop"; src: string; poster: string }

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
 * showing it.
 */
function AnimatedCellPicture({
    src,
    poster,
    alt,
    blurDataURL,
    className,
    elementRef,
}: {
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
}) {
    const [failed, setFailed] = useState(false)
    const videoRef = useRef<HTMLVideoElement | null>(null)
    // The concurrency policy in one line: the director owns the observer, the
    // scroll listener and the cap, and this cell owns nothing but its
    // membership (lib/state/animatedPlayback.ts). Re-runs on the fallback, where
    // React has already nulled the ref for the unmounted <video>, so the
    // registration is dropped exactly when the element stops existing.
    useEffect(() => {
        const video = videoRef.current
        if (!video) return
        return observeAnimatedCell(video)
    }, [failed])
    if (failed) {
        return (
            <Image
                ref={elementRef}
                src={poster}
                alt={alt}
                fill
                // Same rule as every other picture on this card: the blurhash
                // PNG goes to `placeholder` directly, never `placeholder="blur"`.
                placeholder={blurDataURL ?? 'empty'}
                className={className}
                unoptimized
            />
        )
    }
    return (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
            ref={(element) => {
                videoRef.current = element
                elementRef?.(element)
            }}
            src={src}
            // Shown until the first frame decodes, and shown for good if the
            // response turns out not to be a video at all — so the cell paints
            // a correct picture from its first frame in every case.
            poster={poster}
            aria-label={alt}
            // `muted` is intrinsic rather than a setting: a grid of cells that
            // could make noise is not a grid, and it is also what makes
            // autoplay permissible without a user gesture in every browser.
            muted
            autoPlay
            loop
            playsInline
            disablePictureInPicture
            onError={() => setFailed(true)}
            className={cn(FILL_CLASSES, className)}
        />
    )
}
