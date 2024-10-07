import { useEmbedArgs } from "@/lib/state/searchQuery/clientHooks"
import { $api } from "@/lib/api"
import { splitByFirstSlash } from "@/components/SearchTypeSelector"
import { useToast } from "@/components/ui/use-toast"

export function useEnableEmbeddingSearch({
  setEnable,
  model,
  setModel,
  models,
  type,
}: {
  setEnable: (value: boolean) => void
  model: string
  setModel: (value: string) => void
  models: string[]
  type: "image" | "text"
}) {
  const [embedArgs, setEmbedArgs] = useEmbedArgs()
  const loadModel = $api.useMutation(
    "put",
    "/api/inference/load/{group}/{inference_id}"
  )
  const { refetch } = $api.useQuery("get", "/api/inference/cache")
  const { toast } = useToast()
  const onEnableChange = async (value: boolean) => {
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
      const { data } = await refetch()
      if (data && data.cache[currentModel]) {
        setEnable(true)
        toast({
          title: "Enabled",
          description: `Semantic ${
            type === "image" ? "Image" : "Text"
          } Search is now enabled`,
        })
        return
      }
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
              description: `Semantic ${
                type === "image" ? "Image" : "Text"
              } Search is now enabled`,
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
      toast({
        title: "Disabled",
        description: `Semantic ${
          type === "image" ? "Image" : "Text"
        } Search is now disabled`,
      })
      setEnable(false)
    }
  }
  return [onEnableChange, loadModel.isPending] as const
}
