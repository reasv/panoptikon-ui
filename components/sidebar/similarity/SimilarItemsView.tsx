
import { components } from "@/lib/panoptikon"
import { $api } from "@/lib/api"
import { keepPreviousData } from "@tanstack/react-query"
import { SearchResultImage } from "@/components/SearchResultImage"
import { getGalleryOptionsSerializer, useGalleryIndex } from "@/lib/state/gallery"
import { selectedDBsSerializer, useSelectedDBs } from "@/lib/state/database"
import { useItemSimilaritySearch, useItemSimilarityTextSource, useOrderArgs, useQueryOptions, useResetSearchQueryState } from "@/lib/state/searchQuery/clientHooks"
import { useItemSelection } from "@/lib/state/itemSelection"
import { useBookmarkNs, useInstantSearch } from "@/lib/state/zust"
import { COUNT_QUERY_PAGE_SIZE, prefetchRowsFor } from "@/lib/searchHooks"
import { SimilaritySideBarComponents } from "@/lib/state/searchQuery/searchQueryKeyMaps"
import { serializers } from "@/lib/state/searchQuery/serializers"
import { useMemo } from "react"
import { PartitionBy, partitionBySerializer, usePartitionBy } from "@/lib/state/partitionBy"


type ObjectWithDefaults<T> = {
    [K in keyof T]: { defaultValue: T[K] };
};

function setAllPropertiesToDefault<T extends object>(obj: ObjectWithDefaults<T>): T {
    return Object.keys(obj).reduce((acc, key) => {
        const prop = obj[key as keyof T];
        acc[key as keyof T] = prop.defaultValue;
        return acc;
    }, {} as T);
}

function setAllPropertiesToNull<T extends object>(obj: T): { [K in keyof T]: null } {
    return Object.keys(obj).reduce((acc, key) => {
        acc[key as keyof T] = null;
        return acc;
    }, {} as { [K in keyof T]: null });
}

export function SimilarItemsView({
    sha256,
    query,
    displayCount,
    model,
    distance_function,
    filterOptions,
    srcFilterOptions
}: {
    model: string
    sha256: string
    filterOptions: SimilaritySideBarComponents["CLIPSimilarity"] | SimilaritySideBarComponents["TextSimilarity"]
    srcFilterOptions: SimilaritySideBarComponents["CLIPTextSource"] | SimilaritySideBarComponents["TextSource"]
    query: components["schemas"]["PqlQuery"]
    /**
     * How many of the fetched results to render. The panel's slider sets this
     * and nothing else: the query's page size tracks the main search's, so
     * that clicking a result can hand the identical request over and be
     * served from cache. See `similarityQueryPageSize`.
     */
    displayCount: number
    distance_function: "COSINE" | "L2"

}) {
    const [dbs, ___] = useSelectedDBs()
    const [partitionBy] = usePartitionBy()
    const bookmarkNs = useBookmarkNs((state) => state.namespace)
    const { data, error, isError, refetch, isFetching, isLoading } = $api.useQuery(
        "post",
        "/api/search/pql",
        {
            params: {
                query: {
                    ...dbs,
                    // Similar-item cards carry bookmark buttons; enrichment
                    // gives them status without per-item GETs, same as the
                    // main results grid.
                    include_bookmarks: true,
                    bookmarks_namespace: bookmarkNs,
                },
            },
            body: {
                // Every field here has to match what `useSearch` sends, down
                // to the prefetch budget: clicking a result swaps this exact
                // request into the main search, and react-query hashes the
                // whole body. A stray field is a cache miss, and a cache miss
                // is a second execution of a vector search that already ran.
                ...query,
                results: true,
                count: false,
                partition_by: partitionBy.partition_by,
                prefetch_rows: prefetchRowsFor(query.query),
            },
        },
        {
            placeholderData: keepPreviousData,
        }
    )
    const countQuery = $api.useQuery(
        "post",
        "/api/search/pql",
        {
            params: {
                query: dbs,
            },
            body: {
                ...query,
                page: 1,
                // Pinned to the same constant `useSearch` uses: the count is
                // compiled without pagination, so page size cannot change the
                // answer, and matching it keeps the swap from re-counting.
                page_size: COUNT_QUERY_PAGE_SIZE,
                results: false,
                count: true,
                partition_by: partitionBy.partition_by,
            },
        },
        {
            placeholderData: keepPreviousData,
        }
    )
    const setSelected = useItemSelection((state) => state.setItem)
    const [index, setIndex] = useGalleryIndex()
    const resetSearch = useResetSearchQueryState()
    const [orderArgs, setOrderArgs] = useOrderArgs()
    const [filter, setFilter] = useItemSimilaritySearch()
    const [srcFilter, setSrcFilter] = useItemSimilarityTextSource()
    const [options, setOptions] = useQueryOptions()
    const commit = useInstantSearch((state) => state.commit)
    const onImageClick = async (index: number) => {
        if (!data) return
        // Written in one tick so nuqs coalesces them into a single URL update,
        // then awaited together: `commit()` declares the query *now in the
        // URL* to be one worth running, so it has to run after the URL holds
        // it. Without that the update lock would swallow this navigation —
        // it is a committed query, not a query being edited.
        await Promise.all([
            // Unset all search query parameters
            resetSearch(),
            setOrderArgs({
                page: 1,
                // The page size the sidebar query ran at, which is the main
                // search's own unless the slider asked for more. Handing it
                // over is what keeps the two requests identical — and it can
                // only ever grow the main page, never shrink it to the
                // handful of results this panel happens to display.
                page_size: query.page_size,
            }, { history: "push" }),
            setFilter({
                ...filterOptions,
                target: sha256,
                model: model,
                distance_function,
            }, {
                history: "push",
            }),
            setSrcFilter(srcFilterOptions, {
                history: "push",
            }),
            setOptions({
                e_iss: true,
            }, { history: "push" }),
            setIndex(index, { history: "push" }),
        ])
        commit()

        //setSelected(data.results[index] as any)
    }
    // Generate the link for the similarity mode

    const getSimilarityModeLink = (
        filter: SimilaritySideBarComponents["CLIPSimilarity"] | SimilaritySideBarComponents["TextSimilarity"],
        srcFilter: SimilaritySideBarComponents["CLIPTextSource"] | SimilaritySideBarComponents["TextSource"],
        page_size: number,
        simModel: string,
        target: string,
        distance_function: "COSINE" | "L2",
        partition_by: PartitionBy
    ) => {
        let fullURL = serializers.itemSimilaritySearch({
            ...filter,
            target,
            model: simModel,
            distance_function,
        })
        fullURL = selectedDBsSerializer(fullURL, {
            index_db: dbs.index_db,
            user_data_db: dbs.user_data_db,
        })
        fullURL = partitionBySerializer(fullURL, {
            partition_by: partition_by.partition_by
        })

        fullURL = serializers.itemSimilarityTextSource(fullURL, srcFilter as any)
        fullURL = serializers.orderArgs(fullURL, {
            page: 1,
            page_size: page_size,
        })
        return serializers.queryOptions(fullURL, { e_iss: true })
    }
    const getSimilarityModeImageLink = (base: string, index: number) => getGalleryOptionsSerializer()(base, { gi: index })

    // The query fetches a full page; the panel shows the head of it. Sliced
    // before anything walks the list — at a large main page size the fetched
    // page can be hundreds of rows, none of which past `displayCount` are
    // rendered or linked.
    const shownResults = useMemo(
        () => (data?.results || []).slice(0, displayCount),
        [data, displayCount]
    )
    const indexToLinkMapping = useMemo(() => {
        const baseLink = getSimilarityModeLink(
            filter,
            srcFilter,
            query.page_size ?? 10,
            model,
            sha256,
            distance_function,
            partitionBy
        )
        return shownResults.map((_, index) => getSimilarityModeImageLink(baseLink, index))
    }, [shownResults, query.page_size, filter, srcFilter, model, sha256, distance_function, partitionBy])

    return (
        <div className="mt-4">
            {data && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 4xl:grid-cols-2 5xl:grid-cols-2 gap-4">
                    {shownResults.map((result, index) => (
                        <SearchResultImage
                            key={index}
                            result={result as any}
                            index={index}
                            dbs={dbs}
                            imageContainerClassName="h-96 xl:h-80 4xl:h-80 5xl:h-80"
                            onImageClick={() => onImageClick(index)}
                            showLoadingSpinner={isLoading || isFetching}
                            overrideURL={indexToLinkMapping ? indexToLinkMapping[index] : undefined}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}