"use client"
import { fetchClient } from "@/lib/api"
import { useMutation } from "@tanstack/react-query"
import { useToast } from "@/components/ui/use-toast"
import { useSelectedDBs } from "@/lib/state/database"
import { useRelayConfigState } from "@/lib/state/relayConfig"

export function useRelayOpen() {
    const enabled = useRelayConfigState((state) => state.enabled)
    const [apiKey, apiURL] = useRelayConfigState((state) => [state.apiKey, state.relayURL])
    const { toast } = useToast()
    const dbs = useSelectedDBs()[0]
    async function getFilePath(sha256: string) {
        const itemData = await fetchClient.GET("/api/items/item", {
            params: {
                query: {
                    ...dbs,
                    id_type: "sha256",
                    id: sha256,
                }
            }
        })
        if (!itemData.data || itemData.data!.files.length === 0) {
            return
        }
        return itemData.data!.files[0].path
    }
    const openFileMutation = useMutation({
        mutationKey: ["relayOpen"],
        mutationFn: async ({ verb, path, sha256 }: {
            verb: "file" | "folder"
            path?: string
            sha256: string
        }) => {
            const requestURL = apiURL.endsWith("/") ? apiURL.slice(0, -1) : apiURL
            if (!path) {
                path = await getFilePath(sha256)
                if (!path) {
                    throw new Error("File path not found")
                }
            }
            const url = `${requestURL}/open?verb=${verb}&path=${encodeURIComponent(path)}`
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
            })
            if (!response.ok) {
                if (response.status === 400) {
                    throw new Error("No mapping found for the file path. Please check your relay configuration.")
                }
                throw new Error(`Failed to open: ${response.statusText}`)
            }
        },
        onSuccess: (data, { verb, path }) => {
            toast({
                title: `Opening ${verb === "file" ? "file" : "folder"}`,
                description: `Opening ${path} through your relay...`,
                variant: "default",
                duration: 2000,
            })
        },
        onError: (error) => {
            toast({
                title: "Error Opening File/Folder",
                description: error.message || "An error occurred while trying to open the file/folder.",
                variant: "destructive",
                duration: 2000,
            })
        },
    })
    return enabled ? openFileMutation : null
}