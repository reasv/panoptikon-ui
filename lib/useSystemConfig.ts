import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { useToast } from "@/components/ui/use-toast"
import { keepPreviousData, useQueryClient } from "@tanstack/react-query"
import { components } from "@/lib/panoptikon"

export type SystemConfig = components["schemas"]["SystemConfig"]

// Shared read/modify/write access to the per-DB scan configuration.
// changeConfig refetches the latest config before applying the change so
// concurrent edits from other components don't get clobbered.
export function useSystemConfig() {
    const [dbs] = useSelectedDBs()
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const query = $api.useQuery(
        "get",
        "/api/jobs/config",
        {
            params: {
                query: dbs,
            },
        },
        {
            placeholderData: keepPreviousData,
        },
    )
    const mutation = $api.useMutation("put", "/api/jobs/config", {
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: [
                    "get",
                    "/api/jobs/config",
                    {
                        params: {
                            query: dbs,
                        },
                    }
                ],
            })
            // Config-derived status queries (any DB selection).
            queryClient.invalidateQueries({
                queryKey: ["get", "/api/jobs/cronjob/schedule"],
            })
            queryClient.invalidateQueries({
                queryKey: ["get", "/api/jobs/continuous/status"],
            })
            toast({
                title: "Settings Updated",
                description: "The changes have been applied",
            })
        },
        // The gateway validates at save time (e.g. rejects unparseable cron
        // strings with a 400 {detail}); surface that instead of failing silently.
        onError: (error) => {
            const detail = (error as { detail?: string } | null)?.detail
            toast({
                title: "Failed to update settings",
                description: detail || "The server rejected the change",
                variant: "destructive",
            })
        },
    })
    const changeConfig = async (modifyConfig: (currentConfig: SystemConfig) => SystemConfig) => {
        const latestConfig = await query.refetch()
        if (latestConfig.data) {
            mutation.mutate({ body: modifyConfig(latestConfig.data), params: { query: dbs } })
        }
    }
    // The GET response always serializes every field; the schema leaves them
    // optional only because the same SystemConfig shape is the PUT input,
    // where omitted fields fall back to server defaults.
    const config = query.data as Required<SystemConfig> | undefined
    return { config, changeConfig, query, mutation }
}
