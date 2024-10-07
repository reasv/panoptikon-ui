import { useEmbedArgs } from "@/lib/state/searchQuery/clientHooks"
import { $api } from "@/lib/api"
import { splitByFirstSlash } from "@/components/SearchTypeSelector"
import { useToast } from "@/components/ui/use-toast"

export function useEnableEmbeddingSearch({
  setEnable,
  model,
  setModel,
  models,
}: {
  setEnable: (value: boolean) => void
  model: string
  setModel: (value: string) => void
  models: string[]
}) {
  const [embedArgs, setEmbedArgs] = useEmbedArgs()
  const loadModel = $api.useMutation(
    "put",
    "/api/inference/load/{group}/{inference_id}"
  )
  const { toast } = useToast()
  const onEnableChange = (value: boolean) => {
    if (models.length === 0) {
      return
    }
    let currentModel = model
    if (model.length === 0) {
      setModel(models[0])
      currentModel = models[0]
    }
    if (currentModel.length === 0) {
      setEnable(false)
      return
    }
    if (value) {
      if (loadModel.isPending) {
        return
      }
      toast({
        title: "Loading Model...",
        description: "Embedding model is being loaded into memory...",
      })
      loadModel.mutate(
        {
          params: {
            path: {
              group: splitByFirstSlash(currentModel)[0],
              inference_id: splitByFirstSlash(currentModel)[1],
            },
            query: {
              ...embedArgs,
            },
          },
        },
        {
          onSuccess: () => {
            setEnable(true)
            toast({
              title: "Model Loaded",
              description: "Semantic Search is now enabled",
            })
          },
          onError: (error) => {
            toast({
              title: "Error loading model",
              description: (error as any).message || "Unknown error",
              variant: "destructive",
            })
          },
        }
      )
    } else {
      setEnable(false)
    }
  }
  return [onEnableChange, loadModel.isPending] as const
}
