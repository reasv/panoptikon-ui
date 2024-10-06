import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { keepPreviousData, useQueryClient } from "@tanstack/react-query"
import {
    Group,
} from "@/components/table/columns/models"
import React from "react"
import { useToast } from "@/components/ui/use-toast"
import { components } from "@/lib/panoptikon"
import { ConfidenceFilter } from "@/components/sidebar/options/confidenceFilter"

export function ModelConfig(
    {
        modelConfig
    }: {
        modelConfig: components["schemas"]["JobSettings"],
    }
) {
    const [dbs] = useSelectedDBs()
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const changeSettings = $api.useMutation("put", "/api/jobs/config", {
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
            toast({
                title: "Settings Updated",
                description: "The changes have been applied",
            })
        },
    })
    const { refetch } = $api.useQuery(
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

    const setValues = async (batchSize: number | null | undefined, threshold: number | null | undefined) => {
        const { data } = await refetch()
        if (!data) return
        const systemConfig = data
        // The config without the current group
        const job_settings = systemConfig.job_settings !== undefined ? systemConfig.job_settings.filter((v) => !((v.group_name === modelConfig.group_name) && !v.inference_id)) : []
        // Add the new config
        changeSettings.mutate({
            body: {
                ...systemConfig,
                job_settings: [
                    ...job_settings,
                    {
                        group_name: modelConfig.group_name,
                        default_batch_size: batchSize,
                        default_threshold: threshold,
                    },
                ],
            },
            params: { query: dbs }
        })
    }

    return (
        <div className='grid gap-4 grid-cols-1 lg:grid-cols-2'>
            {modelConfig.default_batch_size !== undefined && modelConfig.default_batch_size !== null && <ConfidenceFilter
                label="Batch Size"
                description="Set to a lower value if you have little VRAM"
                min={1}
                max={256}
                step={1}
                confidence={modelConfig.default_batch_size}
                setConfidence={(value) => setValues(value, modelConfig.default_threshold)}
            />}
            {modelConfig.default_threshold !== undefined && modelConfig.default_threshold !== null && <ConfidenceFilter
                label="Confidence Threshold"
                description="Lower values will produce more data"
                min={0}
                max={1}
                confidence={modelConfig.default_threshold}
                setConfidence={(value) => setValues(modelConfig.default_batch_size, value)}
            />}
        </div>
    )
}


export function useModelConfig(group: Group) {
    const [dbs] = useSelectedDBs()
    const { data, error, isError, refetch, isFetching } = $api.useQuery(
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
    const config = data && data.job_settings !== undefined ? data.job_settings.filter((v) => (v.group_name === group.group_name) && !v.inference_id) : []
    return config.length > 0 ? config[0] : {
        group_name: group.group_name,
        default_batch_size: group.default_batch_size,
        default_threshold: group.default_threshold,
    }
}


export function useCronJobSchedule() {
    const [dbs] = useSelectedDBs()
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const changeSettings = $api.useMutation("put", "/api/jobs/config", {
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
            toast({
                title: "Settings Updated",
                description: "The changes have been applied",
            })
        },
    })
    const { refetch } = $api.useQuery(
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
    const addToSchedule = async (inference_ids: string[], batch_size?: number, threshold?: number) => {
        const { data } = await refetch()
        if (!data) return
        const systemConfig = data
        // The config without the jobs that are being added
        const jobs = systemConfig.cron_jobs !== undefined ? systemConfig.cron_jobs.filter((v) => {
            return !(inference_ids.includes(v.inference_id))
        }) : []

        const newJobs = inference_ids.map((inference_id) => {
            return {
                inference_id,
                batch_size,
                threshold,
            }
        })
        // Add the new config
        changeSettings.mutate({
            body: {
                ...systemConfig,
                cron_jobs: [
                    ...jobs,
                    ...newJobs,
                ],
            },
            params: { query: dbs }
        })
    }
    return addToSchedule
}
