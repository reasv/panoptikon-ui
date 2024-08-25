"use client"
import { $api } from "@/lib/api";
import { useBookmarkNs, useDatabase } from "@/lib/zust";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/use-toast"

export const BookmarkBtn = (
    { sha256, }: {
        sha256: string;
    }
) => {
    const query = useDatabase((state) => state);
    const namespace = useBookmarkNs((state) => state.namespace);
    const params = {
        path: { namespace, sha256 },
        query
    }
    const bookmarkPath = "/api/bookmarks/ns/{namespace}/{sha256}"
    const { data, error, isLoading, isError, status } = $api.useQuery(
        "get",
        bookmarkPath,
        {
            params,
        },
    );

    const addBookmark = $api.useMutation(
        "put",
        bookmarkPath,
    );

    const removeBookmark = $api.useMutation(
        "delete",
        bookmarkPath,
    );

    const queryClient = useQueryClient()
    const { toast } = useToast()

    const isBookmarked = data?.exists || false;

    const handleBookmarkClick = () => {
        const onSuccess = (deleted: boolean) => {
            queryClient.invalidateQueries({
                queryKey: [
                    "get",
                    bookmarkPath,
                    { params },
                ]
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
            removeBookmark.mutate({ params }, {
                onSuccess: () => onSuccess(true), onError(error, variables, context) {
                    onError(error)
                },
            });
        }
        else
            addBookmark.mutate({ params }, { onSuccess: () => onSuccess(false), onError: onError });
    };

    return (
        <button
            title={isBookmarked ? "Remove bookmark" : "Add to bookmarks"}
            className="hover:scale-105 absolute top-2 right-2 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
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
    { sha256, path }: {
        sha256: string;
        path?: string;
    }
) => {
    const query = useDatabase((state) => state);
    const { mutate } = $api.useMutation(
        "post",
        "/api/open/file/{sha256}",
    );
    const { toast } = useToast()
    const handleClick = () => {
        mutate({ params: { path: { sha256 }, query: { ...query, path: path } } }, {
            onError: (error: any) => {
                toast({
                    title: "Failed to open file",
                    description: error.message,
                    variant: "destructive",
                    duration: 2000,
                })
            },
            onSuccess: () => {
                toast({
                    title: "Opening file",
                    description: "File is being opened with your system's default application",
                    duration: 2000,
                })
            }
        })
    }

    return (
        <button
            onClick={() => handleClick()}
            title="Open file with your system's default application"
            className="hover:scale-105 absolute bottom-3 left-1 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
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
    { sha256, path }: {
        sha256: string
        path?: string;
    }
) => {
    const query = useDatabase((state) => state);
    const { mutate } = $api.useMutation(
        "post",
        "/api/open/folder/{sha256}",
    );

    const { toast } = useToast()
    const handleClick = () => {
        mutate({ params: { path: { sha256 }, query: { ...query, path: path } } }, {
            onError: (error: any) => {
                toast({
                    title: "Failed to open folder",
                    description: error.message,
                    variant: "destructive",
                    duration: 2000,
                })
            },
            onSuccess: () => {
                toast({
                    title: "Opening folder",
                    description: "Showing file in folder with your system's default file manager",
                    duration: 2000,
                })
            }
        })
    }
    return (
        <button
            title="Show file in folder"
            onClick={() => handleClick()}
            className="hover:scale-105 absolute bottom-3 left-12 bg-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
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

export const FilePathComponent = ({ path }: { path: string }) => {
    const { toast } = useToast()
    const handleCopyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            // Optionally, you can provide feedback to the user here
        }).catch((err) => {
            console.error('Failed to copy text: ', err);
        });
        toast({
            title: "Path copied to clipboard",
            description: text,
            duration: 2000,
        })
    };
    return (
        <p
            title={path}
            className="text-sm truncate cursor-pointer" // Added cursor-pointer for better UX
            style={{ direction: 'rtl', textAlign: 'left' }}
            onClick={() => handleCopyToClipboard(path)} // Copy path on click
        >
            {path}
        </p>
    );
};