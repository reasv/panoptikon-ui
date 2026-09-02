import { LogOut } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from "./ui/hover-card";
import { $api } from "@/lib/api";
import { useSelectedDBs } from "@/lib/state/database";
import { FilePathComponent } from "./imageButtons";
import { getFileURL } from "@/lib/utils";
import { useItemSimilaritySearch, useQueryOptions } from "@/lib/state/searchQuery/clientHooks";
import { exceedsDisplayLoopTrigger, isExtremeAspect } from "@/lib/thumbnailTier";
import { useDisplayLoopTrigger } from "@/lib/useClientConfig";

export function ImageSimilarityHeader() {
    const [dbs, ___] = useSelectedDBs()
    const [filter, setFilter] = useItemSimilaritySearch()
    const [options, setOptions] = useQueryOptions()
    const { data, refetch, isFetching, isError, error } = $api.useQuery(
        "get",
        "/api/items/item",
        {
            params: {
                query: {
                    ...dbs,
                    id: filter.target,
                    id_type: "sha256",
                },
            },
        }
    )
    const path = data?.files[0]?.path
    // See the <img> below: an animated target past the server's display-loop
    // bounds answers `video/mp4` at this size, which this element cannot show.
    const displayLoopTrigger = useDisplayLoopTrigger()
    // THE FALLBACK FOR THE ROW-DATA TEST'S DOCUMENTED RESIDUAL. The test below
    // reads size, dimensions and duration off the item row, and one shape of
    // row cannot be settled from it: no `size` on record, dimensions inside
    // the bounds, and a file that is nonetheless over `max_bytes`. That answers
    // "not a loop", the `<img>` requests video bytes, and the element fails to
    // decode them — silently, because an `<img>` has no error state a user can
    // read. So it says so through `onError`, and the element re-requests the
    // one URL that can never be video: `still=true`, which the endpoint
    // guarantees answers a picture (§5). The same construction LoopVideo's
    // poster fallback uses, for the same unpredictable case.
    //
    // KEYED BY TARGET and one-way inside it. A second failure at the still URL
    // would set the same value, which React bails out of, so this cannot loop.
    const [stillFallbackTarget, setStillFallbackTarget] = useState<string | null>(null)
    const forceStill = stillFallbackTarget === filter.target
    const onExitClick = () => {
        setOptions({ e_iss: false })
    }
    return (
        <div className="relative w-full flex items-center">
            <Button onClick={onExitClick} title="Leave Item Similarity Search" variant="ghost" size="icon" className="mr-2">
                <LogOut className="h-4 w-4" />
            </Button>
            {/* WHAT the results are similar to, as a picture. This bar
                replaces the search bar whenever similarity mode is on, and
                the query it stands for is an IMAGE — a truncated path is a
                poor stand-in for one, especially in the maximized board's
                dock where the item that started the search is usually no
                longer on screen. Hovering the bar shows the target itself.

                The whole bar is the trigger, not just the path: the path is
                hidden at some breakpoints (see the two <p> variants below),
                and a trigger that disappears with the viewport would make
                the preview unreachable exactly where it is most useful.

                Radix portals the content to <body>, which this needs: the
                dock mount sits inside a transformed, fixed-position panel,
                where a non-portaled popover would resolve against the
                transform instead of the viewport.

                Thumbnail, not the full file: this is a glance-sized
                confirmation of which item is being matched. `sha256` is the
                similarity target itself, so no file row has to resolve
                before the picture can load. */}
            <HoverCard openDelay={200}>
                <HoverCardTrigger asChild>
                    <div className="flex items-center justify-center rounded-lg sm:border h-10 p-2 mx-auto cursor-default">
                        <p className="mr-2 hidden sm:block lg:hidden xl:block">
                            Similarity Search for
                        </p>
                        <p className="mr-2 sm:hidden lg:block xl:hidden">
                            Similarity Search
                        </p>
                        <div className="w-1/4 hidden sm:block lg:hidden xl:block">
                            {path ? <FilePathComponent path={path} /> : <FilePathComponent path={filter.target || "[Missing]"} />}
                        </div>
                    </div>
                </HoverCardTrigger>
                {filter.target && (
                    <HoverCardContent
                        // Above the bar: in the dock this bar sits at the
                        // bottom of the screen, so a popover below it would
                        // have nowhere to go.
                        side="top"
                        className="w-auto p-2"
                    >
                        {/* A CONTAIN surface, so it never takes a grid tier
                            (§2): past aspect 2 a grid rendition is a CROP cut
                            for `object-cover`, and contained in this box it
                            would show a strip's first screenful instead of the
                            whole picture. Gated on the aspect through the same
                            helper the gallery and the peek layer use, off the
                            dimensions THIS component's own `/api/items/item`
                            query already carries — so a normal-aspect target
                            keeps the bare URL and shares its cache entry with
                            the gallery's picture of the same item, and only an
                            extreme-aspect one asks for `?size=display` by name:
                            same bytes, NEW URL, which is exactly what a browser
                            cache holding the pre-tier long-side-crushed
                            thumbnail cannot answer (F4).

                            RESIDUAL, and it is the one every contain surface
                            here carries: on a first hover the query may not
                            have resolved, `data` is undefined, the aspect test
                            answers false and the bare URL is used. The picture
                            is still the right one — the bare path IS the
                            display rendition — so only the cache-busting half
                            is missed, and only until the query settles. */}
                        <img
                            src={getFileURL(dbs, "thumbnail", "sha256", filter.target,
                                isExtremeAspect(data?.item?.width, data?.item?.height)
                                    ? "display" : undefined,
                                // `still=true` for an animated target past the
                                // display-loop bounds, and only then: its
                                // display request answers `video/mp4`
                                // (docs/thumbnail-format-implementation.md R3),
                                // which this <img> would render as a broken
                                // picture. A smaller animated target keeps the
                                // bare URL, animates as it does today, and
                                // keeps sharing its cache entry with the
                                // gallery. Same RESIDUAL as the aspect test
                                // above: before the query resolves there is no
                                // row to test, so the flag is off for one
                                // render.
                                forceStill || (data?.item
                                    ? exceedsDisplayLoopTrigger(data.item, displayLoopTrigger)
                                    : undefined))}
                            alt="Similarity search target"
                            className="max-h-[40vh] max-w-[min(24rem,80vw)] rounded object-contain"
                            // The residual the row-data test cannot settle —
                            // see `stillFallbackTarget` above.
                            onError={() => setStillFallbackTarget(filter.target)}
                        />
                        {path && (
                            <p className="mt-2 max-w-[min(24rem,80vw)] truncate text-xs text-muted-foreground" title={path}>
                                {path}
                            </p>
                        )}
                    </HoverCardContent>
                )}
            </HoverCard>
        </div>
    )
}
