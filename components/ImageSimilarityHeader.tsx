import { LogOut } from "lucide-react";
import { Button } from "./ui/button";
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from "./ui/hover-card";
import { $api } from "@/lib/api";
import { useSelectedDBs } from "@/lib/state/database";
import { FilePathComponent } from "./imageButtons";
import { StillFallbackImage } from "@/components/StillFallbackImage";
import { useItemSimilaritySearch, useQueryOptions } from "@/lib/state/searchQuery/clientHooks";
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
                            whole picture. The bare URL IS the display
                            rendition, for every item and whatever its aspect,
                            so this shares its cache entry with the gallery's
                            and the peek layer's picture of the same item.
                            (Extreme-aspect targets used to name `?size=display`
                            to dislodge a pre-tier cache entry; `r=2` dislodges
                            it for every display request now.) */}
                        {/* `still=true` rides in for an animated target past
                            the display-loop bounds, and only then, with the
                            one retry the row-data rule needs
                            (components/StillFallbackImage.tsx).

                            RESIDUAL: on a first hover the query may not have
                            resolved, `type` is undefined, the rule answers
                            "static" and the bare URL is used for one render.
                            The key is the retry's reset — a new target starts
                            from the row's own answer again. */}
                        <StillFallbackImage
                            key={filter.target}
                            dbs={dbs}
                            item={{
                                sha256: filter.target,
                                type: data?.item?.type,
                                duration: data?.item?.duration,
                                size: data?.item?.size,
                                width: data?.item?.width,
                                height: data?.item?.height,
                            }}
                            trigger={displayLoopTrigger}
                            alt="Similarity search target"
                            className="max-h-[40vh] max-w-[min(24rem,80vw)] rounded object-contain"
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
