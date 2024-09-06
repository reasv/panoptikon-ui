
import { components } from "@/lib/panoptikon"
import { $api } from "@/lib/api"
import { keepPreviousData } from "@tanstack/react-query"
import { SearchResultImage } from "@/components/SearchResultImage"
import { useItemSelection } from "@/lib/state/itemSelection"
import { Gallery, galleryNameSerializer, getGalleryOptionsSerializer, useGalleryIndex, useGalleryName } from "@/lib/state/gallery"
import { useSelectedDBs } from "@/lib/state/database"
import { Mode, searchModeSerializer, useSearchMode } from "@/lib/state/searchMode"
import { useItemSimilarityOptions, useItemSimilaritySource } from "@/lib/state/similarityQuery/clientHooks"
import { similarityQuerySourceKeymap, SimilarityQueryType } from "@/lib/state/similarityQuery/similarityQueryKeyMaps"
import { similaritySerializers } from "@/lib/state/similarityQuery/serializers"
import { useSearchParams } from "next/navigation"
import { useMemo } from "react"
import * as def from "nuqs/server"

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
    type,
}: {
    sha256: string
    query: components["schemas"]["SimilarItemsRequest"]
    type: SimilarityQueryType
}) {
    const [dbs, ___] = useSelectedDBs()
    const { data, isLoading, isFetching } = $api.useQuery("post", "/api/search/similar/{sha256}", {
        params: {
            query: {
                ...dbs
            },
            path: {
                sha256: sha256,
            }
        },
        body: {
            ...query,
            full_count: true,
        }
    }, {
        placeholderData: keepPreviousData
    })

    const [options, setOptions] = useItemSimilarityOptions()
    const [source, setSource] = useItemSimilaritySource()

    const setSelected = useItemSelection((state) => state.setItem)
    const [name, setName] = useGalleryName()
    const [index, setIndex] = useGalleryIndex(Gallery.similarity)
    const [searchMode, setSearchmode] = useSearchMode()


    const onImageClick = (index: number) => {
        if (!data) return
        setOptions({
            ...{
                ...query,
                src_text: undefined,
                full_count: true,
            },
            item: sha256,
            page: 1,
            type: type,
        }, {
            history: "push",
        })
        setSource({
            ...query.src_text,
        }, {
            history: "push",
        })
        setName(Gallery.similarity)
        setSearchmode(Mode.ItemSimilarity)
        setIndex(index)
        setSelected(data.results[index])
    }
    // Generate the link for the similarity mode
    const params = useSearchParams()

    const getSimilarityModeLink = (currentParams: URLSearchParams, simQuery: components["schemas"]["SimilarItemsRequest"]) => {
        const queryParameters = new URLSearchParams(currentParams.toString())
        let fullURL = similaritySerializers.similarityOptions(queryParameters, {
            ...{
                ...simQuery,
                src_text: undefined,
                full_count: true,
            },
            item: sha256,
            page: 1,
            type: type,
        })
        let src_update
        if (simQuery.src_text === undefined || simQuery.src_text === null) {
            src_update = setAllPropertiesToDefault(similarityQuerySourceKeymap(def))
        } else {
            src_update = { ...simQuery.src_text } as any
        }
        fullURL = similaritySerializers.similaritySource(fullURL, src_update)
        fullURL = galleryNameSerializer(fullURL, { g: Gallery.similarity })
        return searchModeSerializer(fullURL, { mode: Mode.ItemSimilarity })
    }
    const getSimilarityModeImageLink = (base: string, index: number) => getGalleryOptionsSerializer(Gallery.similarity)(base, { index })

    const indexToLinkMapping = useMemo(() => {
        const baseLink = getSimilarityModeLink(params, query)
        return data?.results.map((_, index) => getSimilarityModeImageLink(baseLink, index))
    }, [data, params, query])

    return (
        <div className="mt-4">
            {data && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 4xl:grid-cols-2 5xl:grid-cols-2 gap-4">
                    {data.results.map((result, index) => (
                        <SearchResultImage
                            key={index}
                            result={result}
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