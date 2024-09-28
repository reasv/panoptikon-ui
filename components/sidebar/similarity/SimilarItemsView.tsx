
import { components } from "@/lib/panoptikon"
import { $api } from "@/lib/api"
import { keepPreviousData } from "@tanstack/react-query"
import { SearchResultImage } from "@/components/SearchResultImage"
import { getGalleryOptionsSerializer, useGalleryIndex, useGalleryName } from "@/lib/state/gallery"
import { selectedDBsSerializer, useSelectedDBs } from "@/lib/state/database"
import { SimilarityQueryType } from "@/lib/state/similarityQuery/similarityQueryKeyMaps"
import { useItemSimilaritySearch, useItemSimilarityTextSource, useOrderArgs, useQueryOptions, useResetSearchQueryState } from "@/lib/state/searchQuery/clientHooks"
import { useItemSelection } from "@/lib/state/itemSelection"
import { SimilaritySideBarComponents } from "@/lib/state/searchQuery/searchQueryKeyMaps"
import { useSearchParams } from "next/navigation"
import { serializers } from "@/lib/state/searchQuery/serializers"
import { useMemo } from "react"


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
    model,
    type,
    filterOptions,
    srcFilterOptions
}: {
    model: string
    sha256: string
    filterOptions: SimilaritySideBarComponents["CLIPSimilarity"] | SimilaritySideBarComponents["TextSimilarity"]
    srcFilterOptions: SimilaritySideBarComponents["CLIPTextSource"] | SimilaritySideBarComponents["TextSource"]
    query: components["schemas"]["PQLQuery"]
    type: SimilarityQueryType

}) {
    const [dbs, ___] = useSelectedDBs()
    const { data, error, isError, refetch, isFetching, isLoading } = $api.useQuery(
        "post",
        "/api/search/pql",
        {
            params: {
                query: dbs,
            },
            body: {
                ...query,
                results: true,
                count: false,
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
                results: false,
                count: true,
            },
        },
        {
            placeholderData: keepPreviousData,
        }
    )
    const setSelected = useItemSelection((state) => state.setItem)
    const [name, setName] = useGalleryName()
    const [index, setIndex] = useGalleryIndex(name)
    const resetSearch = useResetSearchQueryState()
    const [orderArgs, setOrderArgs] = useOrderArgs()
    const [filter, setFilter] = useItemSimilaritySearch()
    const [srcFilter, setSrcFilter] = useItemSimilarityTextSource()
    const [options, setOptions] = useQueryOptions()
    const onImageClick = (index: number) => {
        if (!data) return
        // Unset all search query parameters
        resetSearch()
        setOrderArgs({
            page: 1,
            page_size: query.page_size,
        }, { history: "push" })
        setIndex(index, { history: "push" })
        setFilter({
            ...filterOptions,
            target: sha256,
            model: model,
            distance_function: type == SimilarityQueryType.clip ? "COSINE" : "L2",
        }, {
            history: "push",
        })
        setSrcFilter(srcFilterOptions, {
            history: "push",
        })
        setOptions({
            e_iss: true,
        }, { history: "push" })

        setSelected(data.results[index] as any)
    }
    // Generate the link for the similarity mode

    const getSimilarityModeLink = (
        filter: SimilaritySideBarComponents["CLIPSimilarity"] | SimilaritySideBarComponents["TextSimilarity"],
        srcFilter: SimilaritySideBarComponents["CLIPTextSource"] | SimilaritySideBarComponents["TextSource"],
        page_size: number,
        simModel: string,
        target: string,
        queryType: SimilarityQueryType
    ) => {
        let fullURL = serializers.itemSimilaritySearch({
            ...filter,
            target,
            model: simModel,
            distance_function: queryType == SimilarityQueryType.clip ? "COSINE" : "L2",
        })
        fullURL = selectedDBsSerializer(fullURL, {
            index_db: dbs.index_db,
            user_data_db: dbs.user_data_db,
        })

        fullURL = serializers.itemSimilarityTextSource(fullURL, srcFilter as any)
        fullURL = serializers.orderArgs(fullURL, {
            page: 1,
            page_size: page_size,
        })
        return serializers.queryOptions(fullURL, { e_iss: true })
    }
    const getSimilarityModeImageLink = (base: string, index: number) => getGalleryOptionsSerializer(name)(base, { index })

    const indexToLinkMapping = useMemo(() => {
        const baseLink = getSimilarityModeLink(
            filter,
            srcFilter,
            query.page_size,
            model,
            sha256,
            type
        )
        return data?.results.map((_, index) => getSimilarityModeImageLink(baseLink, index))
    }, [data, query.page_size, filter, srcFilter, model, sha256, type])

    return (
        <div className="mt-4">
            {data && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 4xl:grid-cols-2 5xl:grid-cols-2 gap-4">
                    {data.results.map((result, index) => (
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