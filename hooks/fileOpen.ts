"use client"
import { $api } from "@/lib/api"
import { useToast } from "@/components/ui/use-toast"
import { getFileURL } from "@/lib/utils"
import { useSelectedDBs } from "@/lib/state/database"
import { useClientConfig } from "@/lib/useClientConfig"
import { useRelayOpen } from "@/hooks/relayOpen"

// Shared "open file" / "show in folder" actions, so the floating image
// buttons (OpenFile/OpenFolder) and the pinboard context menu resolve the
// relay -> restricted -> backend branch identically and can't drift apart.
//
// `disableBackendOpen` is the public-instance flag (from the gateway's
// /api/client-config: `disable_backend_open` in the policy's
// [policies.client] table, or an open_files capability the ruleset would
// reject anyway): local file access is off,
// so the plain open/folder actions degrade (Open File -> new browser tab;
// Show in Folder -> in-app FindButton, handled by the caller). The relay
// (companion app) always takes precedence and performs a real open even in
// that mode.
export function useFileOpenActions({ sha256, path }: { sha256: string, path?: string }) {
    const query = useSelectedDBs()[0]
    const { toast } = useToast()
    const clientConfig = useClientConfig()
    const relayOpenMutation = useRelayOpen()

    const { mutate: mutateFile } = $api.useMutation("post", "/api/open/file/{sha256}")
    const { mutate: mutateFolder } = $api.useMutation("post", "/api/open/folder/{sha256}")

    const disableBackendOpen = clientConfig?.data?.disableBackendOpen || false
    const relayEnabled = !!relayOpenMutation

    const openFileInBrowser = () => {
        const url = getFileURL(query, "file", "sha256", sha256)
        window.open(url, "_blank")
    }

    const openFile = () => {
        if (relayOpenMutation) {
            relayOpenMutation.mutate({ verb: "file", path, sha256 })
            return
        }
        if (disableBackendOpen) {
            openFileInBrowser()
            return
        }
        mutateFile({ params: { path: { sha256 }, query: { ...query, path } } }, {
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

    const showInFolder = () => {
        if (relayOpenMutation) {
            relayOpenMutation.mutate({ verb: "folder", path, sha256 })
            return
        }
        mutateFolder({ params: { path: { sha256 }, query: { ...query, path } } }, {
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

    return { openFile, showInFolder, openFileInBrowser, disableBackendOpen, relayEnabled }
}
