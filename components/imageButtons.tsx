"use client"
import { $api } from "@/lib/api";
import { useState } from "react";

export const BookmarkBtn = (
    { sha256, }: {
        sha256: string;
    }
) => {
    const params = {
        path: { namespace: "default", sha256: sha256 },
        query: {
            index_db: "default"
        }
    }
    const { data, error, isLoading, isError, status } = $api.useQuery(
        "get",
        "/api/bookmarks/ns/{namespace}/{sha256}",
        {
            params,
        },
    );

    const { mutate } = $api.useMutation(
        "put",
        "/api/bookmarks/ns/{namespace}/{sha256}",
    );

    const buttonLabel = (isLoading || !data) ? "Loading" : (data.exists ? "Remove bookmark" : "Add bookmark");
    const [isBookmarked, setIsBookmarked] = useState(false);
    const handleBookmarkClick = () => {
        setIsBookmarked(!isBookmarked);
    };

    return (
        <button
            title={isBookmarked ? "Remove bookmark" : "Add to bookmarks"}
            className="absolute top-2 right-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            onClick={handleBookmarkClick}
        >
            {isBookmarked ? (
                // Filled bookmark icon (when bookmarked)
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    className="w-6 h-6 text-gray-800"
                >
                    <path d="M5 3v18l7-5 7 5V3H5z" />
                </svg>
            ) : (
                // Outlined bookmark icon (when not bookmarked)
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    className="w-6 h-6 text-gray-800"
                >
                    <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
                </svg>
            )}
        </button>
    );
};

export const OpenFile = (
    { sha256, }: {
        sha256: string;
    }
) => {
    const { mutate } = $api.useMutation(
        "post",
        "/api/open/file/{sha256}",
    );

    return (
        <button
            onClick={() => mutate({ params: { path: { sha256 } } })}
            title="Open file with your system's default application"
            className="absolute bottom-3 left-1 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="currentColor"
                viewBox="0 0 24 24"
                className="w-6 h-6 text-gray-800"
            >
                <path d="M14 2H6C4.9 2 4 2.9 4 4v16c0 1.1 0.9 2 2 2h12c1.1 0 2-0.9 2-2V8l-6-6zm1 7V3.5L18.5 9H15z" />
            </svg>
        </button>
    );
};
export const OpenFolder = (
    { sha256, }: {
        sha256: string;
    }
) => {
    const { mutate } = $api.useMutation(
        "post",
        "/api/open/folder/{sha256}",
    );

    return (
        <button
            title="Show file in folder"
            onClick={() => mutate({ params: { path: { sha256 } } })}
            className="absolute bottom-3 left-12 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="currentColor"
                viewBox="0 0 24 24"
                className="w-6 h-6 text-gray-800"
            >
                <path d="M10 4H4c-1.1 0-2 0.9-2 2v12c0 1.1 0.9 2 2 2h16c1.1 0 2-0.9 2-2V8c0-1.1-0.9-2-2-2h-8l-2-2z" />
            </svg>
        </button>
    );
};